use log::debug;
use tokio_util::io::ReaderStream;
use std::io::SeekFrom;
use std::path::PathBuf;
use tokio::{fs::File, io::{AsyncReadExt, AsyncSeekExt}, sync::mpsc::{Receiver, Sender}, task::JoinHandle, time::{sleep, Duration}};
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use std::sync::Arc;
use std::collections::HashMap;
use std::error::Error;

use crate::{
  config::Config, constants
};

#[derive(Clone)]
pub struct ActiveDownload {
  pub file_size: u64,
  pub file: Arc<File>
}

pub struct DownloadsManager {
  user_files_root_directory: PathBuf,

  /// Maps a file's handle string to an active download
  active_downloads_map: Arc<Mutex<HashMap<String, ActiveDownload>>>,

  /// Maps a file's handle to a timeout task which is responsible for closing a download
  download_expiry_task_map: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,

  // Download expiry signals
  download_expiry_tx: Sender<String>,
  download_expiry_rx: Arc<Mutex<Receiver<String>>>
}

impl DownloadsManager {
  pub fn new(config: &Config) -> Self	{
    let (tx, rx) = mpsc::channel(constants::DOWNLOADS_EXPIRY_MPSC_CHANNEL_BUFFER_SIZE);

    Self {
      user_files_root_directory: PathBuf::from(config.user_files_root_directory.clone()),
      active_downloads_map: Arc::new(Mutex::new(HashMap::new())),
      download_expiry_task_map: Arc::new(Mutex::new(HashMap::new())),
      download_expiry_tx: tx,
      download_expiry_rx: Arc::new(Mutex::new(rx))
    }
  }

  /// Starts the while loop that listens to the internal receiver for expiring active downloads
  /// which are no longer being used by a user.
  pub fn start_inactivity_detector(&mut self) {
    let rx = self.download_expiry_rx.clone();
    let downloads_map = self.active_downloads_map.clone();
    let expiry_map = self.download_expiry_task_map.clone();

    tokio::spawn(async move {
      let mut rx_guard = rx.lock().await;

      while let Some(handle) = rx_guard.recv().await {
        debug!("Expired download: {}", handle);

        let mut downloads_map = downloads_map.lock().await;
        downloads_map.remove(&handle);

        let mut expiry_map = expiry_map.lock().await;
        expiry_map.remove(&handle);
      }
    });
  }

  pub async fn set_download_for_expiry(&mut self, handle: String) {
    let tx = self.download_expiry_tx.clone();
    let handle_clone = handle.clone();

    let task_handle = tokio::spawn(async move {
      sleep(Duration::from_millis(constants::ACTIVE_DOWNLOAD_EXPIRY_TIME_MS as u64)).await;
      let _ = tx.send(handle_clone).await;
    });

    if let Some(old_task) = self.download_expiry_task_map.lock().await.insert(handle, task_handle) {
      old_task.abort(); // Abort old task
    }
  }

  /// Opens a file for download
  pub async fn open_file_for_download(&mut self, user_id: u64, handle: &String) -> Result<(), Box<dyn Error>> {
    // Create the file path
    let file_name = handle.clone() + constants::TREASURY_FILE_EXTENSION;
    let path = self.user_files_root_directory.join(file_name);

    let file = File::open(&path).await?;
    let metadata = tokio::fs::metadata(&path).await?;
    
    let download = ActiveDownload {
      file_size: metadata.len(),
      file: Arc::new(file)
    };

    let map = self.active_downloads_map.clone();
    let mut map = map.lock().await;
    map.insert(handle.clone(), download);

    // Set download for expiry
    self.set_download_for_expiry(handle.clone()).await;

    debug!("Opened download: {}", handle);

    Ok(())
  }

  async fn get_download_or_start(&mut self, user_id: u64, handle: &String) -> Result<ActiveDownload, Box<dyn Error>> {
    // Try get download from the map and return it
    { 
      let mut map = self.active_downloads_map.lock().await;

      if let Some(download) = map.get_mut(handle) {
        return Ok(download.clone());
      }
    }

    // Start new download
    self.open_file_for_download(user_id, handle).await?;

    // Try get download from the map again
    { 
      let mut map = self.active_downloads_map.lock().await;

      if let Some(download) = map.get_mut(handle) {
        return Ok(download.clone());
      } else {
        return Err("Failed to start a download! This shouldn't happen!".into());
      }
    }
  }

  /// Tries to read a chunk from an active download. If the provided handle doesn't point to any 
  /// active download, then it will try and start one.
  pub async fn try_read_chunk_as_stream(&mut self, user_id: u64, handle: &String, chunk_id: u64) 
    -> Result<ReaderStream<tokio::io::Take<File>>, Box<dyn Error>> 
  {
    // Try get download from the map
    let download = self.get_download_or_start(user_id, handle).await?;

    // Calculate read size and offset which ignores the chunk header
    let enc_chunk_size_u64 = constants::ENCRYPTED_CHUNK_SIZE as u64;
    let enc_file_header_size_u64 = constants::ENCRYPTED_FILE_HEADER_SIZE as u64;
    let read_offset = chunk_id * enc_chunk_size_u64 + enc_file_header_size_u64;
    let read_size = std::cmp::min(enc_chunk_size_u64, download.file_size - read_offset);
    
    // Validate read offset
    if read_offset > download.file_size { 
      return Err(
        format!(
          "Chunk id {} is too high since resulting read offset is {} which is greater than requested 
          file's size of {} bytes.",
          chunk_id,
          read_offset,
          download.file_size
        ).into()
      );
    }

    // Create read stream from the file at the location
    let file = download.file.clone();
    let mut file = file.as_ref().try_clone().await?;
    file.seek(SeekFrom::Start(read_offset)).await?;
    let stream = ReaderStream::new(file.take(read_size));

    // Set download for expiry (resets timer)
    self.set_download_for_expiry(handle.clone()).await;

    Ok(stream)
  }
}