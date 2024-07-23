use log::{error, info};
use tokio_util::io::ReaderStream;
use tokio::{fs::File, sync::mpsc::{Receiver, Sender}, task::JoinHandle, time::{sleep, Duration}};
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use std::sync::Arc;
use std::error::Error;
use dashmap::DashMap;

use crate::{
  constants, storage::file_store::{FileStoreHandleId, FileStoreManager, StorageVolumeId}
};

#[derive(Clone)]
pub struct ActiveDownload {
  pub handle_id: FileStoreHandleId
}

pub struct DownloadManager {
  file_store: Arc<FileStoreManager>,
  
  /// Maps a file's handle string to an active download
  active_downloads_map: Arc<DashMap<String, ActiveDownload>>,

  /// Maps a file's handle to a timeout task which is responsible for closing a download
  download_expiry_task_map: Arc<DashMap<String, JoinHandle<()>>>,

  /// Download expiry message sender
  download_expiry_tx: Sender<String>,

  /// Download expiry receiver
  download_expiry_rx: Arc<Mutex<Receiver<String>>>,

  /// The inactivity detector thread's join handle
  inactivity_detector_join_handle: Option<JoinHandle<()>>
}

impl DownloadManager {
  pub fn new(file_store: Arc<FileStoreManager>) -> Self	{
    let (tx, rx) = mpsc::channel(constants::DOWNLOADS_EXPIRY_MPSC_CHANNEL_BUFFER_SIZE);

    Self {
      file_store,
      active_downloads_map: Arc::new(DashMap::new()),
      download_expiry_task_map: Arc::new(DashMap::new()),
      download_expiry_tx: tx,
      download_expiry_rx: Arc::new(Mutex::new(rx)),
      inactivity_detector_join_handle: None
    }
  }

  /// Starts the while loop that listens to the internal receiver for expiring active downloads
  /// which are no longer being used by a user.
  pub fn start_inactivity_detector(&mut self) {
    let rx = self.download_expiry_rx.clone();
    let downloads_map_clone = self.active_downloads_map.clone();
    let expiry_task_map_clone = self.download_expiry_task_map.clone();
    let file_store_clone = self.file_store.clone();

    let handle = tokio::spawn(async move {
      let mut rx_guard = rx.lock().await;

      while let Some(handle) = rx_guard.recv().await {
        expiry_task_map_clone.remove(&handle)
          .expect("No download expiry task found when trying to remove it!");

        let download = downloads_map_clone.remove(&handle)
          .expect("No active download found when trying to remove it!");

        let download_handle_id = download.1.handle_id;

        if let Err(err) = file_store_clone.stop_reading(download_handle_id).await {
          error!("Failed to expire and stop reading file with handle: {}. Error: {}", u64::from(download_handle_id), err);
        }
      }
    });

    self.inactivity_detector_join_handle = Some(handle);
  }

  pub async fn set_download_for_expiry(&self, handle: String) {
    let tx = self.download_expiry_tx.clone();
    let handle_clone = handle.clone();

    let task_handle = tokio::spawn(async move {
      sleep(Duration::from_millis(constants::ACTIVE_DOWNLOAD_EXPIRY_TIME_MS as u64)).await;
      let _ = tx.send(handle_clone).await;
    });

    if let Some(old_task) = self.download_expiry_task_map.insert(handle, task_handle) {
      old_task.abort(); // Abort old task
    }
  }

  /// Opens a file for download
  pub async fn open_file_for_download(&self, volume_id: StorageVolumeId, user_id: u64, handle: &String, file_store: &FileStoreManager) -> Result<(), Box<dyn Error>> {
    let download_handle_id = file_store.start_reading(handle.clone(), volume_id, user_id).await?;

    let download = ActiveDownload {
      handle_id: download_handle_id
    };

    self.active_downloads_map.insert(handle.clone(), download);

    // Set download for expiry
    self.set_download_for_expiry(handle.clone()).await;

    Ok(())
  }

  async fn get_download_or_start(&self, user_id: u64, handle: &String, volume_id: StorageVolumeId, file_store: &FileStoreManager) -> Result<ActiveDownload, Box<dyn Error>> {
    // Try get download from the map and return it
    if let Some(download) = self.active_downloads_map.get(handle) {
      return Ok(download.clone());
    }

    // Start new download
    self.open_file_for_download(
      volume_id,
      user_id,
      handle,
      file_store
    ).await?;

    // Try get download from the map again
    if let Some(download) = self.active_downloads_map.get(handle) {
      return Ok(download.clone());
    } else {
      return Err("Failed to start a download! This shouldn't happen!".into());
    }
  }

  /// Tries to read a chunk from an active download. If the provided handle doesn't point to any 
  /// active download, then it will try and start one.
  pub async fn try_read_chunk_as_stream(&self, user_id: u64, handle: &String, volume_id: StorageVolumeId, chunk_id: u64, file_store: &FileStoreManager) 
    -> Result<ReaderStream<tokio::io::Take<File>>, Box<dyn Error>> 
  {
    // Try get download from the map
    let download = self.get_download_or_start(user_id, handle, volume_id, file_store).await?;

    // Read chunk as stream
    let stream = file_store.read_chunk_as_stream(download.handle_id, chunk_id).await?;

    // Set download for expiry (resets timer)
    self.set_download_for_expiry(handle.clone()).await;

    Ok(stream)
  }
}

impl Drop for DownloadManager {
  fn drop(&mut self) {
    // On drop, abort the inactivity detector thread
    if let Some(handle) = &self.inactivity_detector_join_handle {
      info!("Download manager inactivity detector thread aborted as the manager was dropped.");
      handle.abort();
    }
  }
}
