use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufWriter, SeekFrom};
use tokio::fs::File;
use tokio::sync::Mutex;
use tokio_util::io::ReaderStream;
use std::error::Error;
use std::collections::BTreeMap;
use async_trait::async_trait;
use dashmap::DashMap;
use log::{debug, error, info};

use crate::core::constants;

#[derive(PartialEq, Eq, Clone)]
pub enum StorageVolumeType {
  Disk
}

#[derive(PartialEq, Eq)]
pub enum FileHandleType {
  ReadOnly,
  WriteOnly
}

#[derive(PartialEq, Eq, Hash, Copy, Clone)]
pub struct FileStoreHandleId(u64);

impl From<FileStoreHandleId> for u64 {
  fn from(value: FileStoreHandleId) -> Self {
    value.0
  }
}

#[derive(PartialEq, Eq, Hash, Copy, Clone)]
pub struct StorageVolumeId(pub u64);

impl From<StorageVolumeId> for u64 {
  fn from(value: StorageVolumeId) -> Self {
    value.0
  }
}

#[derive(PartialEq, Eq, Hash, Copy, Clone)]
pub struct StorageVolumeHandleId(u64);

impl From<StorageVolumeHandleId> for u64 {
  fn from(value: StorageVolumeHandleId) -> Self {
    value.0
  }
}

#[async_trait]
pub trait StorageVolume: Send + Sync {
  /// WARNING: **file_name** must be unique!
  /// 
  /// 'reserved_size' is how many bytes is reserved for this upload. It's not strict and more 
  /// data can be written to the upload. However it ensures that a volume isn't completely 
  /// full before starting new uploads.
  async fn start_writing(&self, file_name: String, owner_id: u64, reserved_size: u64) -> Result<StorageVolumeHandleId, Box<dyn Error>>;
  async fn stop_writing(&self, handle: StorageVolumeHandleId, finalise: bool) -> Result<(), Box<dyn Error>>;
  async fn append_bytes(&self, handle: StorageVolumeHandleId, bytes: &[u8]) -> Result<(), Box<dyn Error>>;

  async fn start_reading(&self, file_name: String, owner_id: u64) -> Result<StorageVolumeHandleId, Box<dyn Error>>;
  async fn stop_reading(&self, handle: StorageVolumeHandleId) -> Result<(), Box<dyn Error>>;
  async fn read_chunk_as_stream(&self, handle: StorageVolumeHandleId, chunk_id: u64) -> Result<ReaderStream<tokio::io::Take<File>>, Box<dyn Error>>;

  async fn get_next_handle_id(&self) -> StorageVolumeHandleId;

  fn allocation_size(&self) -> u64;
  fn used_bytes(&self) -> u64;
  fn volume_type(&self) -> StorageVolumeType;
  fn name(&self) -> &String;

  /// Returns the total size of reserved uploads in bytes
  fn upload_reservations_size(&self) -> u64;
}

pub struct DiskFileHandle {
  pub handle_type: FileHandleType,

  pub owner_id: u64,

  /// The size of the file in read only mode or the reservation size in write only mode
  pub size: u64,

  /// Used for write only handle types
  pub buf_writer: Option<BufWriter<File>>,

  /// Used for read only handle types
  pub file: Option<File>,

  /// The path of the file
  pub path: PathBuf
}

pub struct DiskStorageVolume {
  pub volume_name: String,

  pub allocation_size: u64,

  pub used_bytes: AtomicU64,

  /// Stores all the open file handles where the key is the handle's id
  pub open_handles: DashMap<StorageVolumeHandleId, DiskFileHandle>,

  pub upload_reservation_size: AtomicU64,

  /// The root directory of the storage volume
  pub root_path: PathBuf,

  pub handle_id_counter: AtomicU64,

  pub storage_volume_type: StorageVolumeType
}

#[async_trait]
impl StorageVolume for DiskStorageVolume {
  async fn start_writing(&self, file_name: String, owner_id: u64, reserved_size: u64) -> Result<StorageVolumeHandleId, Box<dyn Error>> {
    let handle_id = self.get_next_handle_id().await;

    // Add to reservation size
    self.upload_reservation_size.fetch_add(reserved_size, Ordering::SeqCst);

    // Create filesystem path for the file
    let path = self.root_path.join(file_name + constants::TREASURY_FILE_EXTENSION);

    debug!("Started writing [{}] at: {:?}", handle_id.0, path);

    // Create file and buf writer
    let file = File::create(&path).await?;
    let buf_writer = BufWriter::new(file);

    // Create handle and insert into map
    let handle = DiskFileHandle {
      handle_type: FileHandleType::WriteOnly,
      owner_id,
      size: reserved_size,
      buf_writer: Some(buf_writer),
      file: None,
      path
    };

    self.open_handles.insert(handle_id, handle);

    Ok(handle_id)
  }

  async fn stop_writing(&self, handle: StorageVolumeHandleId, finalise: bool) -> Result<(), Box<dyn Error>> {
    if let Some((_open_handle_id, open_handle)) = self.open_handles.remove(&handle) {
      // Ensure handle is the correct type
      if open_handle.handle_type == FileHandleType::ReadOnly {
        return Err("Handle is read only which mean's it's not an upload!".into());
      }

      // Shutdown the buf writer
      open_handle.buf_writer
        .unwrap()
        .shutdown()
        .await?;

      // Subtract reservation size
      self.upload_reservation_size.fetch_sub(open_handle.size, Ordering::SeqCst);
      
      // If not finalising, aka cancelling, then delete the file
      if finalise {
        // Increment used bytes
        self.used_bytes.fetch_add(open_handle.size, Ordering::SeqCst);

        debug!("Finalised upload: {}", handle.0);
      } else {
        debug!("Deleting because not finalising: {:?}", open_handle.path);

        tokio::fs::remove_file(&open_handle.path).await?;
      }

      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  async fn append_bytes(&self, handle: StorageVolumeHandleId, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    if let Some(mut open_handle) = self.open_handles.get_mut(&handle) {
      if open_handle.handle_type == FileHandleType::WriteOnly {
        // Write bytes
        open_handle.buf_writer
          .as_mut()
          .unwrap()
          .write_all(bytes)
          .await?;
        
        Ok(())
      } else {
        Err("Handle is not writeable!".into())
      }
    } else {
      Err("Handle is invalid".into())
    }
  }

  async fn start_reading(&self, file_name: String, owner_id: u64) -> Result<StorageVolumeHandleId, Box<dyn Error>> {
    let handle_id = self.get_next_handle_id().await;

    // Create filesystem path for the file
    let file_name = file_name + constants::TREASURY_FILE_EXTENSION;
    
    debug!("Opened {}: {:?}", handle_id.0, file_name);

    let path = self.root_path.join(file_name);

    // Open file
    let file = File::open(&path).await?;
    let metadata = file.metadata().await?;

    // Create handle and insert into map
    let handle = DiskFileHandle {
      handle_type: FileHandleType::ReadOnly,
      owner_id,
      size: metadata.len(),
      buf_writer: None,
      file: Some(file),
      path
    };

    self.open_handles.insert(handle_id, handle);

    Ok(handle_id)
  }

  async fn stop_reading(&self, handle: StorageVolumeHandleId) -> Result<(), Box<dyn Error>> {
    if let Some((_open_handle_id, mut open_handle)) = self.open_handles.remove(&handle) {
      // Ensure handle is the correct type
      if open_handle.handle_type == FileHandleType::WriteOnly {
        return Err("Handle is write only! Call 'stop_writing' instead!".into());
      }

      // Shutdown the file
      open_handle.file
        .as_mut()
        .unwrap()
        .shutdown()
        .await?;

      debug!("Closed {}", handle.0);

      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  async fn read_chunk_as_stream(&self, handle: StorageVolumeHandleId, chunk_id: u64) -> Result<ReaderStream<tokio::io::Take<File>>, Box<dyn Error>> {
    if let Some(open_handle) = self.open_handles.get(&handle) {
      // Ensure handle type is correct
      if open_handle.handle_type == FileHandleType::WriteOnly {
        return Err("Handle is write only! Cannot read chunks from it!".into());
      }

      // Calculate read size and offset which ignores the chunk header
      let enc_chunk_size_u64 = constants::ENCRYPTED_CHUNK_SIZE as u64;
      let read_offset = chunk_id * enc_chunk_size_u64;
      let read_size = std::cmp::min(enc_chunk_size_u64, open_handle.size - read_offset);

      // Validate read offset
      if read_offset > open_handle.size { 
        return Err(
          format!(
            "Chunk id {} is too high since resulting read offset is {} which is greater than requested 
            file's size of {} bytes.",
            chunk_id,
            read_offset,
            open_handle.size
          ).into()
        );
      }

      // Create read stream from the file at the location
      let mut file = open_handle.file.as_ref().unwrap().try_clone().await?;
      file.seek(SeekFrom::Start(read_offset)).await?;
      let stream = ReaderStream::new(file.take(read_size));

      Ok(stream)
    } else {
      Err("Handle is invalid".into())
    }
  }

  async fn get_next_handle_id(&self) -> StorageVolumeHandleId {
    StorageVolumeHandleId(self.handle_id_counter.fetch_add(1, Ordering::SeqCst))
  }

  fn allocation_size(&self) -> u64 {
    self.allocation_size
  }

  fn used_bytes(&self) -> u64 {
    self.used_bytes.load(Ordering::SeqCst)
  }

  fn volume_type(&self) -> StorageVolumeType {
    self.storage_volume_type.clone()
  }

  fn name(&self) -> &String {
    &self.volume_name
  }

  fn upload_reservations_size(&self) -> u64 {
    self.upload_reservation_size.load(Ordering::SeqCst)
  }
}

pub struct FileStoreHandle {
  pub handle_type: FileHandleType,

  /// The id of the volume where the file is stored
  pub volume_id: StorageVolumeId,

  /// The id of the handle in the volume where the file is stored
  pub volume_handle_id: StorageVolumeHandleId
}

pub struct FileStoreManager {
  /// Maps a storage volume's id to the storage volume
  volumes: DashMap<StorageVolumeId, Box<dyn StorageVolume>>,

  /// Maps a priority level to the id of a storage volume
  volume_priority_levels: BTreeMap<u64, StorageVolumeId>,

  open_handles: DashMap<FileStoreHandleId, FileStoreHandle>,

  handle_id_counter: Mutex<FileStoreHandleId>
}

pub struct StorageVolumeStats {
  pub priority_level: u64,
  pub id: u64,
  pub name: String,
  pub size: u64,
  pub usage: u64,
  pub upload_reservation_size: u64
}

impl FileStoreManager {
  pub fn new() -> Self {
    Self {
      volumes: DashMap::new(),
      volume_priority_levels: BTreeMap::new(),
      open_handles: DashMap::new(),
      handle_id_counter: Mutex::new(FileStoreHandleId(0))
    }
  }

  async fn get_next_handle_id(&self) -> FileStoreHandleId {
    let mut counter_guard = self.handle_id_counter.lock().await;
    let handle_id = counter_guard.0;
    
    // Increment
    counter_guard.0 += 1;

    FileStoreHandleId(handle_id)
  }

  pub async fn close(&self) -> Result<(), Box<dyn Error>> {
    // Close all open handles
    for open_handle in self.open_handles.iter() {
      let volume = self.volumes.get(&open_handle.volume_id).unwrap();
      let volume_handle_id = open_handle.volume_handle_id;

      if open_handle.handle_type == FileHandleType::ReadOnly {
        if let Err(err) = volume.stop_reading(volume_handle_id).await {
          error!("Failed to stop reading when closing file manager. Error: {}", err);
        };
      } else if open_handle.handle_type == FileHandleType::WriteOnly {
        if let Err(err) = volume.stop_writing(volume_handle_id, false).await {
          error!("Failed to stop writing when closing file manager. Error: {}", err);
        };
      }
    }

    Ok(())
  }

  /// Returns metadata about all the storage volumes in the file store
  pub async fn get_all_volume_stats(&self) -> Vec<StorageVolumeStats> {
    let mut stats: Vec<StorageVolumeStats> = Vec::new();

    for volume in self.volumes.iter() {
      let volume_id = volume.key();

      stats.push(StorageVolumeStats {
        priority_level: self.volume_priority_levels.get(&volume_id.0).unwrap().0,
        id: volume_id.0,
        name: volume.name().clone(),
        size: volume.allocation_size(),
        usage: volume.used_bytes(),
        upload_reservation_size: volume.upload_reservations_size()
      })
    }

    stats
  }

  pub async fn register_filesystem_volume(
    &mut self,
    volume_id: StorageVolumeId,
    name: String,
    priority_level: u64,
    allocation_size: u64,
    used_bytes: u64,
    root_path: PathBuf
  ) -> Result<(), Box<dyn Error>> {
    let volume = DiskStorageVolume {
      volume_name: name,
      allocation_size,
      used_bytes: AtomicU64::new(used_bytes),
      open_handles: DashMap::new(),
      upload_reservation_size: AtomicU64::new(0),
      root_path,
      handle_id_counter: AtomicU64::new(0),
      storage_volume_type: StorageVolumeType::Disk
    };

    // If it doesn't exist, then error
    if !volume.root_path.try_exists().expect("Existance of filesystem volume path cannot be determined.") {
      return Err("Root path of directory doesn't exist in the filesystem!".into());
    }

    // Ensure id is not a duplicate
    if self.volumes.contains_key(&volume_id) {
      return Err("Volume ID is already used!".into());
    }

    // Ensure priority level is not a duplicate
    if self.volume_priority_levels.contains_key(&priority_level) {
      return Err("Priority level is already used!".into());
    }

    debug!("Registered filesystem volume of
    id: {},
    priority level: {},
    allocation size: {},
    used bytes: {},
    root_path: {:?}", volume_id.0, priority_level, allocation_size, used_bytes, volume.root_path);

    // Add volume
    self.volumes.insert(volume_id, Box::new(volume));
    self.volume_priority_levels.insert(priority_level, volume_id);

    Ok(())
  }

  /// Finds the first volume that has enough space to hold 'size' bytes
  async fn find_free_volume(&self, size: u64) -> Result<StorageVolumeId, Box<dyn Error>> {
    for (_volume_priority, volume_id) in self.volume_priority_levels.iter() {
      let volume = self.volumes.get(&volume_id).unwrap();
      let volume_allocation_size = volume.allocation_size();

      // Check if there is enough space
      let used_space = volume.used_bytes();
      let upload_reservation_size = volume.upload_reservations_size();

      // debug!("Checking volume: {} - Reservation size: {}", volume_id.0, upload_reservation_size);

      if used_space + upload_reservation_size + size as u64 <= volume_allocation_size {
        // debug!("Free volume id is {} with free bytes: {}", volume_id.0, volume_allocation_size - used_space);

        return Ok(*volume_id);
      }
    }

    Err(format!("No volumes can fit a file of size: {}", size).into())
  }

  /// Starts an upload and returns the handle id of the upload
  pub async fn start_writing(&self, file_name: String, owner_id: u64, reserved_size: u64) -> Result<(FileStoreHandleId, StorageVolumeId), Box<dyn Error>> {
    let handle_id = self.get_next_handle_id().await;

    // Find free volume
    let free_volume_id = self.find_free_volume(reserved_size).await?;
    let volume = self.volumes.get(&free_volume_id).unwrap();

    // Start upload
    let volume_handle_id = volume.start_writing(file_name, owner_id, reserved_size).await?;

    // Create new handle for upload
    let file_store_handle = FileStoreHandle {
      handle_type: FileHandleType::WriteOnly,
      volume_id: free_volume_id,
      volume_handle_id
    };

    self.open_handles.insert(handle_id, file_store_handle);

    Ok((handle_id, free_volume_id))
  }

  pub async fn stop_writing(&self, handle: FileStoreHandleId, finalise: bool) -> Result<(), Box<dyn Error>> {
    if let Some((_open_handle_id, open_handle)) = self.open_handles.remove(&handle) {
      // Get the volume where the upload is stored
      let volume = self.volumes.get(&open_handle.volume_id).unwrap();

      // Stop writing
      volume.stop_writing(open_handle.volume_handle_id, finalise).await?;
      
      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  pub async fn append_bytes(&self, handle: FileStoreHandleId, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    if let Some(open_handle) = self.open_handles.get(&handle) {
      // Get the volume where the upload is stored
      let volume = self.volumes.get(&open_handle.volume_id).unwrap();

      // Append bytes
      volume.append_bytes(open_handle.volume_handle_id, bytes).await?;
      
      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  pub async fn start_reading(&self, file_name: String, volume_id: StorageVolumeId, owner_id: u64) -> Result<FileStoreHandleId, Box<dyn Error>> {
    if let Some(volume) = self.volumes.get(&volume_id) {
      let volume_handle_id = volume.start_reading(file_name, owner_id).await?;
      
      let file_store_handle = FileStoreHandle {
        handle_type: FileHandleType::ReadOnly,
        volume_id,
        volume_handle_id
      };
      
      let handle_id = self.get_next_handle_id().await;
      self.open_handles.insert(handle_id, file_store_handle);

      Ok(handle_id)
    } else {
      Err("Volume id is invalid".into())
    }
  }

  pub async fn stop_reading(&self, handle: FileStoreHandleId) -> Result<(), Box<dyn Error>> {
    // Get open handle by handle id
    if let Some(open_handle) = self.open_handles.get(&handle) {
      // Get volume where file is stored
      if let Some(volume) = self.volumes.get(&open_handle.volume_id) {
        volume.stop_reading(open_handle.volume_handle_id).await?;

        // Prevent a deadlock
        drop(open_handle);

        // Remove open handle once reading has stopped
        self.open_handles.remove(&handle);

        Ok(())
      } else {
        Err("Couldn't get volume!".into())
      }
    } else {
      Err("Handle is invalid".into())
    }
  }

  pub async fn read_chunk_as_stream(&self, handle: FileStoreHandleId, chunk_id: u64) -> Result<ReaderStream<tokio::io::Take<File>>, Box<dyn Error>> {
    // Get open handle by handle id
    if let Some(open_handle) = self.open_handles.get(&handle) {
      // Get volume where file is stored
      if let Some(volume) = self.volumes.get(&open_handle.volume_id) {
        let stream = volume.read_chunk_as_stream(open_handle.volume_handle_id, chunk_id).await?;

        Ok(stream)
      } else {
        Err("Couldn't get volume!".into())
      }
    } else {
      Err("Handle is invalid".into())
    }
  }
}
