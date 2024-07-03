use std::path::PathBuf;
use tokio::sync::Mutex;
use dashmap::DashMap;

#[derive(PartialEq, Eq)]
pub enum StorageVolumeType {
  Disk
}

pub struct StorageVolume {
  /// The name of the volume
  pub name: String,

  /// The storage backend used for this volume.
  pub volume_type: StorageVolumeType,
  
  /// Measured in bytes. This is how many bytes is allocated for files in this volume.
  pub allocation_size: u64,

  /// **For the disk volume type only**
  /// 
  /// The root filesystem path of the storage volume
  pub filesystem_path: PathBuf
}

pub struct FileStore {
  /// Maps a storage volume's name to the storage volume
  pub volumes: DashMap<String, Mutex<StorageVolume>>
}

impl FileStore {
  pub fn add_filesystem_volume(name: String, allocation_size: u64, filesystem_path: PathBuf) {
    let volume = StorageVolume {
      name,
      volume_type: StorageVolumeType::Disk,
      allocation_size,
      filesystem_path
    };

    // TODO: check filesystem path exists
  }
}
