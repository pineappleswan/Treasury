use std::sync::Arc;
use std::error::Error;

use crate::storage::file_store::{FileStoreManager, StorageVolumeId};

pub struct DownloadManager {
  file_store: Arc<FileStoreManager>
}

impl DownloadManager {
  pub fn new(file_store: Arc<FileStoreManager>) -> Self	{
    Self {
      file_store
    }
  }

  /// Reads a chunk from a file with the provided handle and chunk id
  pub async fn read_chunk(&self, volume_id: StorageVolumeId, handle: String, owner_id: u64, chunk_id: u64) 
    -> Result<Vec<u8>, Box<dyn Error>> 
  {
    // Read chunk
    let chunk = self.file_store.read_chunk(volume_id, handle, owner_id, chunk_id).await?;

    Ok(chunk)
  }
}
