use std::path::PathBuf;
use tokio::io::{AsyncWriteExt, BufWriter};
use parking_lot::Mutex;
use tokio::fs::File;
use std::error::Error;
use dashmap::DashMap;
use std::collections::BTreeMap;
use log::debug;

use crate::core::constants;
use crate::util::misc::generate_file_handle;

#[derive(PartialEq, Eq, Clone)]
pub enum StorageVolumeType {
  Disk,
  S3
}

#[derive(PartialEq, Eq)]
pub enum FileStoreFileHandleType {
  ReadOnly,
  WriteOnly
}

pub struct StorageVolume {
  /// The name of the volume
  pub name: String,

  /// The storage backend used for this volume.
  pub volume_type: StorageVolumeType,
  
  /// Measured in bytes. This is how many bytes is allocated for files in this volume.
  pub allocation_size: u64,

  /// Measured in bytes.
  pub used_bytes: u64,

  /// **For the disk volume type only**
  /// 
  /// The root filesystem path of the storage volume
  pub filesystem_path: PathBuf,

  /// A map that stores the size of the temporary allocations of space for uploads. 
  /// 
  /// Map key is the id of the file store file handle and value is the allocation size in bytes.
  pub upload_allocations: BTreeMap<u64, u64>
}

pub struct FileStoreFileHandle {
  /// The type of handle this is
  pub handle_type: FileStoreFileHandleType,

  /// The owner user id of the file
  pub owner_id: u64,

  /// The size of the file (only applicable when reading files)
  pub size: u64,

  /// The name of the volume the file is stored on
  pub volume_name: String,

  /// An optional buf writer used when writing data to a file
  pub buf_writer: Option<BufWriter<File>>,

  /// An optional file for reading
  pub file: Option<File>,

  /// The storage volume type where the file handle is from
  pub storage_volume_type: StorageVolumeType,

  /// The path of the file in the file handle or [TODO: whatever name/id for S3]
  pub storage_path: PathBuf
}

pub struct FileStoreManager {
  /// Maps a storage volume's name to the storage volume
  volumes: DashMap<String, Mutex<StorageVolume>>,

  open_handles: DashMap<u64, Mutex<FileStoreFileHandle>>,

  handle_id_counter: u64
}

impl FileStoreManager {
  pub fn close() -> Result<(), Box<dyn Error>> {
    // TODO: delete any open file handles

    Ok(())
  }

  pub fn register_filesystem_volume(&mut self, name: String, allocation_size: u64, used_bytes: u64, filesystem_path: PathBuf) -> Result<(), Box<dyn Error>> {
    let volume = StorageVolume {
      name,
      volume_type: StorageVolumeType::Disk,
      allocation_size,
      filesystem_path,
      upload_allocations: BTreeMap::new(),
      used_bytes
    };

    // Get volume filesystem path and check the metadata
    let metadata = volume.filesystem_path.metadata()?;

    if !metadata.is_dir() {
      return Err("Path of filesystem volume must be a directory!".into());
    }

    // Add volume
    self.volumes.insert(volume.name.clone(), Mutex::new(volume));

    Ok(())
  }

  /// Finds the first volume that has enough space
  fn find_free_volume(&self, size: u64) -> Result<String, Box<dyn Error>> {
    for volume in self.volumes.iter_mut() {
      let volume = volume.lock();

      // Check if there is enough space
      let upload_allocations_size: u64 = volume.upload_allocations
        .iter()
        .map(|allocation| allocation.1)
        .sum();

      let used_space = upload_allocations_size + volume.used_bytes;

      if used_space + size <= volume.allocation_size {
        let volume_name = volume.name.clone();

        debug!("Free volume: {} - free bytes: {}", volume_name, volume.allocation_size - used_space);

        return Ok(volume_name);
      }
    }

    Err("No volumes are free!".into())
  }

  /// Opens a new file for writing
  pub async fn create_new_upload(&mut self, size: u64, owner_id: u64) -> Result<u64, Box<dyn Error>> {
    // Find a free volume to store this upload
    let volume_name = self.find_free_volume(size)?;

    let volume = self.volumes
      .get(&volume_name)
      .expect("Free volume was found!");

    let volume = volume.lock();
    let volume_type = volume.volume_type.clone();
    let handle_id = self.handle_id_counter;

    // Create the file
    if volume_type == StorageVolumeType::Disk {
      // Create filesystem path for the file
      let file_name = generate_file_handle() + constants::TREASURY_FILE_EXTENSION;
      let path = volume.filesystem_path.join(file_name);

      debug!("Opening new file at: {:?}", path);

      // Create file and buf writer
      let file = File::create(&path).await?;
      let buf_writer = BufWriter::new(file);

      // Create handle and insert into map
      let handle = FileStoreFileHandle {
        handle_type: FileStoreFileHandleType::WriteOnly,
        owner_id,
        size: 0,
        volume_name,
        buf_writer: Some(buf_writer),
        file: None,
        storage_volume_type: volume_type,
        storage_path: path
      };

      self.open_handles.insert(handle_id, Mutex::new(handle));

      return Ok(handle_id);
    } else if volume.volume_type == StorageVolumeType::S3 {
      // drop volume lock to save time probably if creating a new s3 file/blob

    }

    Err("NOT IMPLEMENTED".into())
  }

  /// Cancels an upload
  pub async fn cancel_upload(&mut self, handle: u64) -> Result<(), Box<dyn Error>> {
    let file_handle = self.open_handles.get_mut(&handle);

    if let Some(file_handle) = file_handle {
      let mut file_handle = file_handle.lock();

      if file_handle.handle_type != FileStoreFileHandleType::WriteOnly {
        return Err("Handle is read only".into());
      }

      let buf_writer = file_handle.buf_writer.as_mut().unwrap();

      // Shutdown buf writer
      buf_writer.shutdown().await?;

      // Delete
      if file_handle.storage_volume_type == StorageVolumeType::Disk {
        tokio::fs::remove_file(&file_handle.storage_path).await?;
      }

      self.open_handles.remove(&handle).expect("Handle should exist!");

      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  /// Finalises an upload by flushing the buf writer and removing it from the map
  pub async fn finalise_upload(&mut self, handle: u64) -> Result<(), Box<dyn Error>> {
    let file_handle = self.open_handles.get_mut(&handle);

    if let Some(file_handle) = file_handle {
      let mut file_handle = file_handle.lock();

      if file_handle.handle_type != FileStoreFileHandleType::WriteOnly {
        return Err("Handle is read only".into());
      }

      file_handle.buf_writer
        .as_mut()
        .unwrap()
        .shutdown()
        .await?;

      self.open_handles.remove(&handle).expect("Handle should exist!");

      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  /// Writes a file chunk to the end of a file handle
  pub async fn append_chunk_to_file(&mut self, handle: u64, chunk: &[u8]) -> Result<(), Box<dyn Error>> {
    let file_handle = self.open_handles.get_mut(&handle);

    if let Some(file_handle) = file_handle {
      let mut file_handle = file_handle.lock();

      if file_handle.handle_type != FileStoreFileHandleType::WriteOnly {
        return Err("Handle is read only".into());
      }

      file_handle.buf_writer
        .as_mut()
        .unwrap()
        .write_all(chunk)
        .await?;
      
      Ok(())
    } else {
      Err("Handle is invalid".into())
    }
  }

  /// Reads a file chunk from a file by its handle
  pub fn read_file_chunk(handle: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    Ok(Vec::new()) // TODO:
  }
}
