use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufWriter, SeekFrom};
use tokio::fs::File;
use std::error::Error;
use std::collections::BTreeMap;
use async_trait::async_trait;
use dashmap::DashMap;
use log::{debug, error};

use crate::util::formats::{calc_chunk_location, calc_file_chunk_count, calc_raw_file_size};
use crate::{
  core::constants,
  storage::util::get_local_disk_file_path
};

use super::chunk_id_map::ChunkIdMap;

#[derive(PartialEq, Eq, Clone)]
pub enum StorageVolumeType {
  Disk
}

/*
#[derive(PartialEq, Eq)]
pub enum FileHandleType {
  ReadOnly,
  WriteOnly
}
*/

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
pub struct StorageVolumeWriterId(u64);

impl From<StorageVolumeWriterId> for u64 {
  fn from(value: StorageVolumeWriterId) -> Self {
    value.0
  }
}

pub struct StorageVolumeStats {
  pub priority_level: u64,
  pub id: u64,
  pub name: String,
  pub size: u64,
  pub usage: u64,
  pub upload_reservation_size: u64
}

/**
 * A trait used for local disk storage volumes
 * TODO: document more
 */
#[async_trait]
pub trait LocalDiskStorageVolume: Send + Sync {
  /// WARNING: **file_name** must be unique!
  /// 
  /// 'reserved_size' is how many bytes is reserved for this upload. It's not strict and more 
  /// data can be written to the upload. However it ensures that a volume isn't completely 
  /// full before starting new uploads.
  async fn start_writing(&self, handle: String, owner_id: u64, reserved_size: u64) -> Result<StorageVolumeWriterId, Box<dyn Error>>;
  async fn stop_writing(&self, handle: StorageVolumeWriterId, finalise: bool) -> Result<(), Box<dyn Error>>;
  async fn append_bytes(&self, handle: StorageVolumeWriterId, bytes: &[u8]) -> Result<(), Box<dyn Error>>;

  async fn read_chunk(&self, handle: String, owner_id: u64, chunk_id: u32, chunk_id_map: Option<ChunkIdMap>) -> Result<Vec<u8>, Box<dyn Error>>;

  async fn get_next_writer_id(&self) -> StorageVolumeWriterId;

  fn allocation_size(&self) -> u64;
  fn used_bytes(&self) -> u64;
  fn volume_type(&self) -> StorageVolumeType;
  fn name(&self) -> &String;

  /// Returns the total size of reserved uploads in bytes
  fn upload_reservations_size(&self) -> u64;
}

pub struct DiskFileWriter {
  pub owner_id: u64,

  /// The expected number of bytes that will be written to this writer
  pub size: u64,

  /// Used for write only handle types
  pub buf_writer: Option<BufWriter<File>>,

  /// Used for read only handle types
  pub file: Option<File>,

  /// The path of the file
  pub path: PathBuf
}

/**
 * A storage volume that is based on a locally mounted disk.
 * TODO: document more
*/
pub struct DiskStorageVolume {
  pub volume_name: String,

  pub allocation_size: u64,

  pub used_bytes: AtomicU64,

  /// Stores all the open file writer handles where the key is the handle's id
  pub open_writers: DashMap<StorageVolumeWriterId, DiskFileWriter>,

  pub upload_reservation_size: AtomicU64,

  /// The root directory of the storage volume
  pub root_path: PathBuf,

  pub handle_id_counter: AtomicU64,

  pub storage_volume_type: StorageVolumeType
}

#[async_trait]
impl LocalDiskStorageVolume for DiskStorageVolume {
  async fn start_writing(&self, handle: String, owner_id: u64, reserved_size: u64) -> Result<StorageVolumeWriterId, Box<dyn Error>> {
    let writer_id = self.get_next_writer_id().await;

    // Add to reservation size
    self.upload_reservation_size.fetch_add(reserved_size, Ordering::SeqCst);

    // Create filesystem path for the file
    let path = self.root_path.join(handle + constants::TREASURY_FILE_EXTENSION);

    debug!("Started writing [{}] at: {:?}", writer_id.0, path);

    // Create file and buf writer
    let file = File::create(&path).await?;
    let buf_writer = BufWriter::new(file);

    // Create writer handle and insert into map
    let writer_handle = DiskFileWriter {
      owner_id,
      size: reserved_size,
      buf_writer: Some(buf_writer),
      file: None,
      path
    };

    self.open_writers.insert(writer_id, writer_handle);

    Ok(writer_id)
  }

  async fn stop_writing(&self, handle: StorageVolumeWriterId, finalise: bool) -> Result<(), Box<dyn Error>> {
    if let Some((_open_handle_id, writer)) = self.open_writers.remove(&handle) {
      // Shutdown the buf writer
      writer.buf_writer
        .unwrap()
        .shutdown()
        .await?;

      // Subtract reservation size
      self.upload_reservation_size.fetch_sub(writer.size, Ordering::SeqCst);
      
      // If not finalising, aka cancelling, then delete the file
      if finalise {
        // Increment used bytes
        self.used_bytes.fetch_add(writer.size, Ordering::SeqCst);

        debug!("Finalised upload: {}", handle.0);
      } else {
        debug!("Deleting because not finalising: {:?}", writer.path);

        tokio::fs::remove_file(&writer.path).await?;
      }

      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  async fn append_bytes(&self, handle: StorageVolumeWriterId, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    if let Some(mut writer) = self.open_writers.get_mut(&handle) {
      // Write bytes
      writer.buf_writer
        .as_mut()
        .unwrap()
        .write_all(bytes)
        .await?;
      
      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  async fn read_chunk(&self, handle: String, owner_id: u64, chunk_id: u32, chunk_id_map: Option<ChunkIdMap>) -> Result<Vec<u8>, Box<dyn Error>> {
    // Get file path of local disk file
    let path = get_local_disk_file_path(&self.root_path, handle);
    
    // Open file
    let mut file = File::open(path).await?;

    // Get file size
    let metadata = file.metadata().await?;
    let encrypted_file_size = metadata.len();
    let raw_file_size = calc_raw_file_size(encrypted_file_size);

    // Calculate read location
    let (read_offset, read_size) = calc_chunk_location(chunk_id, encrypted_file_size, chunk_id_map);

    // Validate chunk id
    let chunk_count = calc_file_chunk_count(raw_file_size);
    let max_chunk_id = (chunk_count - 1) as u32;

    if chunk_id > max_chunk_id { 
      return Err(format!("Chunk id {} is greater than the max chunk id of {}.", chunk_id, max_chunk_id).into());
    }
    
    // Create chunk bytes buffer
    let mut chunk: Vec<u8> = vec![0; read_size as usize];
    
    // Seek to read offset
    file.seek(SeekFrom::Start(read_offset)).await?;

    // Read bytes into the chunk
    let read_bytes = file.read_exact(&mut chunk).await?;

    if read_bytes != read_size as usize {
      error!("Expected {} bytes read, but only {} were read for chunk {}", read_size, read_bytes, chunk_id);
    }

    Ok(chunk)
  }

  async fn get_next_writer_id(&self) -> StorageVolumeWriterId {
    StorageVolumeWriterId(self.handle_id_counter.fetch_add(1, Ordering::SeqCst))
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

pub struct FileStoreWriter {
  /// The id of the volume where the file is stored
  pub volume_id: StorageVolumeId,

  /// The id of the writer in the volume where the file is stored
  pub volume_handle_id: StorageVolumeWriterId
}

pub struct FileStoreManager {
  /// Maps a storage volume's id to a local disk storage volume
  local_disk_volumes: DashMap<StorageVolumeId, Box<dyn LocalDiskStorageVolume>>,

  /// Maps a priority level to the id of a storage volume
  volume_priority_levels: BTreeMap<u64, StorageVolumeId>,

  open_writers: DashMap<FileStoreHandleId, FileStoreWriter>,

  handle_id_counter: AtomicU64
}

impl FileStoreManager {
  pub fn new() -> Self {
    Self {
      local_disk_volumes: DashMap::new(),
      volume_priority_levels: BTreeMap::new(),
      open_writers: DashMap::new(),
      handle_id_counter: AtomicU64::new(0)
    }
  }

  fn get_next_handle_id(&self) -> FileStoreHandleId {
    FileStoreHandleId(self.handle_id_counter.fetch_add(1, Ordering::SeqCst))
  }

  pub async fn close(&self) -> Result<(), Box<dyn Error>> {
    // Close all open writers
    for writer in self.open_writers.iter() {
      let volume = self.local_disk_volumes.get(&writer.volume_id).unwrap();
      let volume_handle_id = writer.volume_handle_id;

      if let Err(err) = volume.stop_writing(volume_handle_id, false).await {
        error!("Failed to stop writing when closing file manager. Error: {}", err);
      }
    }

    Ok(())
  }

  /// Returns metadata about all the local disk storage volumes in the file store
  pub async fn get_all_volume_stats(&self) -> Vec<StorageVolumeStats> {
    let mut stats: Vec<StorageVolumeStats> = Vec::new();

    for volume in self.local_disk_volumes.iter() {
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
      open_writers: DashMap::new(),
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
    if self.local_disk_volumes.contains_key(&volume_id) {
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
    self.local_disk_volumes.insert(volume_id, Box::new(volume));
    self.volume_priority_levels.insert(priority_level, volume_id);

    Ok(())
  }

  /// Finds the first volume that has enough space to hold 'size' bytes
  async fn find_free_volume(&self, size: u64) -> Result<StorageVolumeId, Box<dyn Error>> {
    for (_volume_priority, volume_id) in self.volume_priority_levels.iter() {
      let volume = self.local_disk_volumes.get(&volume_id).unwrap();
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
    let handle_id = self.get_next_handle_id();

    // Find free volume
    let free_volume_id = self.find_free_volume(reserved_size).await?;
    let volume = self.local_disk_volumes.get(&free_volume_id).unwrap();

    // Start upload
    let volume_handle_id = volume.start_writing(file_name, owner_id, reserved_size).await?;

    // Create new writer for upload
    let file_store_writer = FileStoreWriter {
      volume_id: free_volume_id,
      volume_handle_id
    };

    self.open_writers.insert(handle_id, file_store_writer);

    Ok((handle_id, free_volume_id))
  }

  pub async fn stop_writing(&self, handle: FileStoreHandleId, finalise: bool) -> Result<(), Box<dyn Error>> {
    if let Some((_open_handle_id, writer)) = self.open_writers.remove(&handle) {
      // Get the volume where the upload is stored
      let volume = self.local_disk_volumes.get(&writer.volume_id).unwrap();

      // Stop writing
      volume.stop_writing(writer.volume_handle_id, finalise).await?;
      
      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  pub async fn append_bytes(&self, handle: FileStoreHandleId, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    if let Some(writer) = self.open_writers.get(&handle) {
      // Get the volume where the upload is stored
      let volume = self.local_disk_volumes.get(&writer.volume_id).unwrap();

      // Append bytes
      volume.append_bytes(writer.volume_handle_id, bytes).await?;
      
      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  pub async fn read_chunk(
    &self,
    volume_id: StorageVolumeId,
    handle: String,
    owner_id: u64,
    chunk_id: u32,
    chunk_id_map: Option<ChunkIdMap>
  ) -> Result<Vec<u8>, Box<dyn Error>> {
    // Get volume where file is stored
    if let Some(volume) = self.local_disk_volumes.get(&volume_id) {
      let stream = volume.read_chunk(handle, owner_id, chunk_id, chunk_id_map).await?;

      Ok(stream)
    } else {
      Err("Couldn't get volume!".into())
    }
  }
}
