use std::{collections::HashMap, path::PathBuf};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufWriter, SeekFrom};
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use std::error::Error;
use std::collections::BTreeMap;
use async_trait::async_trait;
use log::debug;

use crate::core::constants;

#[derive(PartialEq, Eq, Clone)]
pub enum StorageVolumeType {
  Disk,
  S3
}

#[derive(PartialEq, Eq)]
pub enum FileHandleType {
  ReadOnly,
  WriteOnly
}

#[derive(PartialEq, Eq, Hash, Copy, Clone)]
pub struct FileStoreHandleId(u64);

#[derive(PartialEq, Eq, Hash, Copy, Clone)]
pub struct StorageVolumeId(pub u64);

#[derive(PartialEq, Eq, Hash, Copy, Clone)]
pub struct StorageVolumeHandleId(u64);

impl From<StorageVolumeId> for u64 {
  fn from(value: StorageVolumeId) -> Self {
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
  async fn start_upload(&mut self, file_name: String, owner_id: u64, reserved_size: u64) -> Result<StorageVolumeHandleId, Box<dyn Error>>;
  async fn stop_upload(&mut self, handle: StorageVolumeHandleId, finalise: bool) -> Result<(), Box<dyn Error>>;
  async fn append_bytes(&mut self, handle: StorageVolumeHandleId, bytes: &[u8]) -> Result<(), Box<dyn Error>>;

  async fn start_reading(&mut self, file_name: String, owner_id: u64) -> Result<StorageVolumeHandleId, Box<dyn Error>>;
  async fn stop_reading(&mut self, handle: StorageVolumeHandleId) -> Result<(), Box<dyn Error>>;
  async fn read_chunk_as_stream(&mut self, handle: StorageVolumeHandleId, chunk_id: u64) -> Result<ReaderStream<tokio::io::Take<File>>, Box<dyn Error>>;

  fn allocation_size(&self) -> u64;
  fn used_bytes(&self) -> u64;

  /// Calculates the total size of all open write-only file handles
  fn upload_reservations_size(&self) -> u64;
}

pub struct DiskFileHandle {
  pub handle_type: FileHandleType,

  pub owner_id: u64,

  /// The size of the file in read only mode or the reservation size in write only mode
  pub size: u64,

  /// The amount of bytes written to storage
  pub written_bytes: u64,

  /// Used for write only handle types
  pub buf_writer: Option<BufWriter<File>>,

  /// Used for read only handle types
  pub file: Option<File>,

  /// The path of the file
  pub path: PathBuf
}

pub struct DiskStorageVolume {
  pub allocation_size: u64,

  pub used_bytes: u64,

  /// Stores all the open file handles where the key is the handle's id
  pub open_handles: HashMap<StorageVolumeHandleId, DiskFileHandle>,

  /// The root directory of the storage volume
  pub root_path: PathBuf,

  pub handle_id_counter: StorageVolumeHandleId
}

#[async_trait]
impl StorageVolume for DiskStorageVolume {
  async fn start_upload(&mut self, file_name: String, owner_id: u64, reserved_size: u64) -> Result<StorageVolumeHandleId, Box<dyn Error>> {
    // Create filesystem path for the file
    let path = self.root_path.join(file_name + constants::TREASURY_FILE_EXTENSION);

    debug!("Starting upload at: {:?}", path);

    // Create file and buf writer
    let file = File::create(&path).await?;
    let buf_writer = BufWriter::new(file);

    // Create handle and insert into map
    let handle = DiskFileHandle {
      handle_type: FileHandleType::WriteOnly,
      owner_id,
      size: reserved_size,
      written_bytes: 0,
      buf_writer: Some(buf_writer),
      file: None,
      path
    };

    let handle_id = self.handle_id_counter;

    self.open_handles.insert(handle_id, handle);
    self.handle_id_counter.0 += 1;

    Ok(handle_id)
  }

  async fn stop_upload(&mut self, handle: StorageVolumeHandleId, finalise: bool) -> Result<(), Box<dyn Error>> {
    if let Some(upload) = self.open_handles.remove(&handle) {
      // Ensure handle is the correct type
      if upload.handle_type == FileHandleType::ReadOnly {
        return Err("Handle is read only which mean's it's not an upload!".into());
      }

      // Shutdown the buf writer
      upload.buf_writer
        .unwrap()
        .shutdown()
        .await?;
      
      // If not finalising, aka cancelling, then delete the file
      if finalise {
        self.used_bytes += upload.written_bytes as u64;

        debug!("Finalising upload: {}", handle.0);
      } else {
        debug!("Deleting because not finalising: {:?}", upload.path);

        tokio::fs::remove_file(upload.path).await?;
      }

      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  async fn append_bytes(&mut self, handle: StorageVolumeHandleId, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    if let Some(upload) = self.open_handles.get_mut(&handle) {
      if upload.handle_type == FileHandleType::WriteOnly {
        upload.buf_writer
          .as_mut()
          .unwrap()
          .write_all(bytes)
          .await?;

        upload.written_bytes += bytes.len() as u64;
        
        Ok(())
      } else {
        Err("Handle is not writeable!".into())
      }
    } else {
      Err("Handle is invalid".into())
    }
  }

  async fn start_reading(&mut self, file_name: String, owner_id: u64) -> Result<StorageVolumeHandleId, Box<dyn Error>> {
    // Create filesystem path for the file
    let path = self.root_path.join(file_name + constants::TREASURY_FILE_EXTENSION);

    debug!("Started reading: {:?}", path);

    // Open file
    let file = File::open(&path).await?;
    let metadata = file.metadata().await?;

    // Create handle and insert into map
    let handle = DiskFileHandle {
      handle_type: FileHandleType::ReadOnly,
      owner_id,
      size: metadata.len(),
      written_bytes: 0,
      buf_writer: None,
      file: Some(file),
      path
    };

    let handle_id = self.handle_id_counter;

    self.open_handles.insert(handle_id, handle);
    self.handle_id_counter.0 += 1;

    Ok(handle_id)
  }

  async fn stop_reading(&mut self, handle: StorageVolumeHandleId) -> Result<(), Box<dyn Error>> {
    if let Some(open_handle) = self.open_handles.remove(&handle) {
      // Ensure handle is the correct type
      if open_handle.handle_type == FileHandleType::WriteOnly {
        return Err("Handle is write only! Call 'stop_upload' instead!".into());
      }

      // Shutdown the file
      open_handle.file
        .unwrap()
        .shutdown()
        .await?;

      debug!("Stopped reading: {}", handle.0);

      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  async fn read_chunk_as_stream(&mut self, handle: StorageVolumeHandleId, chunk_id: u64) -> Result<ReaderStream<tokio::io::Take<File>>, Box<dyn Error>> {
    if let Some(handle) = self.open_handles.get(&handle) {
      // Ensure handle type is correct
      if handle.handle_type == FileHandleType::WriteOnly {
        return Err("Handle is write only! Cannot read chunks from it!".into());
      }

      // Calculate read size and offset which ignores the chunk header
      let enc_chunk_size_u64 = constants::ENCRYPTED_CHUNK_SIZE as u64;
      let read_offset = chunk_id * enc_chunk_size_u64;
      let read_size = std::cmp::min(enc_chunk_size_u64, handle.size - read_offset);

      // Validate read offset
      if read_offset > handle.size { 
        return Err(
          format!(
            "Chunk id {} is too high since resulting read offset is {} which is greater than requested 
            file's size of {} bytes.",
            chunk_id,
            read_offset,
            handle.size
          ).into()
        );
      }

      // Create read stream from the file at the location
      let mut file = handle.file.as_ref().unwrap().try_clone().await?;
      file.seek(SeekFrom::Start(read_offset)).await?;
      let stream = ReaderStream::new(file.take(read_size));

      Ok(stream)
    } else {
      Err("Handle is invalid".into())
    }
  }

  fn allocation_size(&self) -> u64 {
    self.allocation_size
  }

  fn used_bytes(&self) -> u64 {
    self.used_bytes
  }

  fn upload_reservations_size(&self) -> u64 {
    self.open_handles
      .iter()
      .map(|(_handle_id, handle)| {
        // Only count the size of write-only file handles
        if handle.handle_type == FileHandleType::WriteOnly {
          handle.size as u64
        } else {
          0
        }
      })
      .sum()
  }
}

pub struct S3StorageVolume {
  
}

pub struct FileStoreHandle {
  pub handle_type: FileHandleType,

  /// The id of the handle
  pub id: FileStoreHandleId,

  /// The id of the user that owns the file
  pub owner_id: u64,

  /// The id of the volume where the file is stored
  pub volume_id: StorageVolumeId,

  /// The id of the handle in the volume where the file is stored
  pub volume_handle_id: StorageVolumeHandleId
}

pub struct FileStoreManager {
  /// Maps a storage volume's id to the storage volume
  volumes: HashMap<StorageVolumeId, Box<dyn StorageVolume>>,

  /// Maps a priority level to the id of a storage volume
  volume_priority_levels: BTreeMap<u64, StorageVolumeId>,

  open_handles: HashMap<FileStoreHandleId, FileStoreHandle>,

  handle_id_counter: FileStoreHandleId
}

impl FileStoreManager {
  pub fn new() -> Self {
    Self {
      volumes: HashMap::new(),
      volume_priority_levels: BTreeMap::new(),
      open_handles: HashMap::new(),
      handle_id_counter: FileStoreHandleId(0)
    }
  }

  pub fn close() -> Result<(), Box<dyn Error>> {
    // TODO: delete any open file handles

    Ok(())
  }

  pub fn register_filesystem_volume(
    &mut self,
    volume_id: StorageVolumeId,
    priority_level: u64,
    allocation_size: u64,
    used_bytes: u64,
    root_path: PathBuf
  ) -> Result<(), Box<dyn Error>> {
    let volume = DiskStorageVolume {
      allocation_size,
      used_bytes,
      open_handles: HashMap::new(),
      root_path,
      handle_id_counter: StorageVolumeHandleId(0)
    };

    // Get volume filesystem path and check the metadata
    let metadata = volume.root_path.metadata()?;

    if !metadata.is_dir() {
      return Err("Path of filesystem volume must be a directory!".into());
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
  fn find_free_volume(&self, size: u64) -> Result<StorageVolumeId, Box<dyn Error>> {
    for (volume_id, volume) in self.volumes.iter() {
      let volume_allocation_size = volume.allocation_size();

      // Check if there is enough space
      let used_space = volume.used_bytes();
      let upload_reservation_size = volume.upload_reservations_size();

      if used_space + upload_reservation_size + size as u64 <= volume_allocation_size {
        debug!("Free volume id is {} with free bytes: {}", volume_id.0, volume_allocation_size - used_space);

        return Ok(*volume_id);
      }
    }

    Err("No volumes are free!".into())
  }

  /// Starts an upload and returns the handle id of the upload
  pub async fn start_upload(&mut self, file_name: String, owner_id: u64, reserved_size: u64) -> Result<(FileStoreHandleId, StorageVolumeId), Box<dyn Error>> {
    let handle_id = self.handle_id_counter;

    // Find free volume
    let free_volume_id = self.find_free_volume(reserved_size)?;
    let volume = self.volumes.get_mut(&free_volume_id).unwrap();

    // Start upload
    let volume_handle_id = volume.start_upload(file_name, owner_id, reserved_size).await?;

    // Create new handle for upload
    let upload = FileStoreHandle {
      handle_type: FileHandleType::WriteOnly,
      id: handle_id,
      owner_id,
      volume_id: free_volume_id,
      volume_handle_id
    };

    self.open_handles.insert(handle_id, upload);
    self.handle_id_counter.0 += 1;

    Ok((handle_id, free_volume_id))
  }

  pub async fn stop_upload(&mut self, handle: FileStoreHandleId, finalise: bool) -> Result<(), Box<dyn Error>> {
    if let Some(open_handle) = self.open_handles.get(&handle) {
      // Get the volume where the upload is stored
      let volume = self.volumes.get_mut(&open_handle.volume_id).unwrap();

      // Stop upload
      volume.stop_upload(open_handle.volume_handle_id, finalise).await?;

      // Remove open handle from file store manager when upload is stopped
      self.open_handles.remove(&handle);
      
      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  pub async fn append_bytes(&mut self, handle: FileStoreHandleId, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    if let Some(open_handle) = self.open_handles.get(&handle) {
      // Get the volume where the upload is stored
      let volume = self.volumes.get_mut(&open_handle.volume_id).unwrap();

      // Append bytes
      volume.append_bytes(open_handle.volume_handle_id, bytes).await?;
      
      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  pub async fn start_reading(&mut self, file_name: String, volume_id: StorageVolumeId, owner_id: u64) -> Result<FileStoreHandleId, Box<dyn Error>> {
    if let Some(volume) = self.volumes.get_mut(&volume_id) {
      let volume_handle_id = volume.start_reading(file_name, owner_id).await?;
      let handle_id = self.handle_id_counter;

      let handle = FileStoreHandle {
        handle_type: FileHandleType::ReadOnly,
        id: handle_id,
        owner_id,
        volume_id,
        volume_handle_id
      };

      self.open_handles.insert(handle_id, handle);
      self.handle_id_counter.0 += 1;

      Ok(handle_id)
    } else {
      Err("Volume id is invalid".into())
    }
  }

  pub async fn stop_reading(&mut self, handle: FileStoreHandleId) -> Result<(), Box<dyn Error>> {
    // Get open handle by handle id
    if let Some(handle) = self.open_handles.get(&handle) {
      // Get volume where file is stored
      if let Some(volume) = self.volumes.get_mut(&handle.volume_id) {
        volume.stop_reading(handle.volume_handle_id).await?;

        Ok(())
      } else {
        Err("Couldn't get volume!".into())
      }
    } else {
      Err("Handle is invalid".into())
    }
  }

  pub async fn read_chunk_as_stream(&mut self, handle: FileStoreHandleId, chunk_id: u64) -> Result<ReaderStream<tokio::io::Take<File>>, Box<dyn Error>> {
    // Get open handle by handle id
    if let Some(handle) = self.open_handles.get(&handle) {
      // Get volume where file is stored
      if let Some(volume) = self.volumes.get_mut(&handle.volume_id) {
        let stream = volume.read_chunk_as_stream(handle.volume_handle_id, chunk_id).await?;

        Ok(stream)
      } else {
        Err("Couldn't get volume!".into())
      }
    } else {
      Err("Handle is invalid".into())
    }
  }
}
