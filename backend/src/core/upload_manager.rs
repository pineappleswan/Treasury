use std::collections::BTreeMap;
use dashmap::DashMap;
use tokio::sync::Mutex;
use std::error::Error;
use std::cmp;

use crate::{
  constants, storage::file_store::{FileStoreHandleId, FileStoreManager, StorageVolumeId}, util::formats::calc_raw_chunk_size
};

pub struct ActiveUpload {
  pub user_id: u64,

  /// The handle id into the file store
  pub handle_id: FileStoreHandleId,

  /// The id of the storage volume where the uploaded file is located
  pub volume_id: StorageVolumeId,

  /// The original unencrypted file size
  pub file_size: u64,

  /// The amount of bytes written to the file excluding file format overhead (inc. encryption overhead).
  pub written_bytes: u64,

  /// The next chunk id to be written which is used to ensure uploaded chunks are written in the correct order.
  pub next_chunk_id: i64,

  /// The buffered chunks which are automatically ordered by their chunk id using a BTreeMap.
  pub buffered_chunks: BTreeMap<i64, Vec<u8>>,

  pub finalise_in_progress: bool
}

impl ActiveUpload {
  pub fn new(handle_id: FileStoreHandleId, user_id: u64, volume_id: StorageVolumeId, file_size: u64) -> Self {
    Self {
      user_id,
      handle_id,
      volume_id,
      file_size,
      written_bytes: 0,
      next_chunk_id: 0,
      buffered_chunks: BTreeMap::new(),
      finalise_in_progress: false
    }
  }

  pub async fn write_buffered_chunks(&mut self, file_store: &mut FileStoreManager) -> Result<(), Box<dyn Error>> {
    while let Some(chunk) = self.buffered_chunks.remove(&self.next_chunk_id) {
      let enc_chunk_size = chunk.len() as u64;
      let raw_chunk_size = calc_raw_chunk_size(enc_chunk_size);

      // Calculate the expected received chunk size
      let bytes_left_to_write = self.file_size as i64 - self.written_bytes as i64;

      let expected_enc_chunk_size = cmp::min(
        bytes_left_to_write + constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE as i64,
        constants::ENCRYPTED_CHUNK_SIZE as i64
      );

      // Ensure chunk size meets expected encrypted chunk size
      if enc_chunk_size as i64 != expected_enc_chunk_size {
        return Err(
          format!(
            "Expected encrypted chunk size {} but got {} instead. User id: {}",
            expected_enc_chunk_size,
            enc_chunk_size,
            self.user_id
          ).into()
        );
      }

      // Write data
      // self.buf_writer.write_all(&chunk).await?;
      file_store.append_bytes(self.handle_id, &chunk).await?;

      self.written_bytes += raw_chunk_size;

      // Increment next chunk id for next iteration of the loop
      self.next_chunk_id += 1;
    }

    Ok(())
  }

  pub async fn try_write_chunk(&mut self, new_chunk_id: i64, data: Vec<u8>, file_store: &mut FileStoreManager) -> Result<(), Box<dyn Error>> {
    // Add chunk to buffer
    self.buffered_chunks.insert(new_chunk_id, data);

    // Write as many buffered chunks as possible
    self.write_buffered_chunks(file_store).await?;

    Ok(())
  }
}

pub struct UploadManager {
  /// Maps a file's handle string to an upload's handle id
  pub active_uploads_map: DashMap<String, Mutex<ActiveUpload>>
}

impl UploadManager {
  pub fn new() -> Self	{
    Self {
      active_uploads_map: DashMap::new()
    }
  }

  /// Creates a new upload with the given parameters 
  pub async fn new_upload(&self, user_id: u64, handle: &String, file_size: u64, file_store: &mut FileStoreManager) -> Result<(), Box<dyn Error>> {
    // Create the file
    // let file = File::create(&path).await?;

    let (upload_handle_id, upload_volume_id) = file_store.start_upload(handle.clone(), user_id, file_size).await?;

    let upload = ActiveUpload::new(upload_handle_id, user_id, upload_volume_id, file_size);

    // Insert new active upload into the map
    self.active_uploads_map.insert(handle.clone(), Mutex::new(upload));

    Ok(())
  }

  /// Removes the upload from the active uploads map and flushes all the written data to the disk.
  /// It will then move the file from the temporary uploads directory to the user files directory.
  /// If it fails to finalise, the temporary upload file will be deleted.
  pub async fn finalise_upload(&self, handle: &String, file_store: &mut FileStoreManager) -> Result<(), Box<dyn Error>> {
    // Ensure handle is valid
    if !self.is_handle_valid(handle) {
      return Err("No active upload with the provided handle was found.".into());
    }

    // Get upload by removing it from the map
    let upload = self.active_uploads_map.remove(handle).unwrap().1;
    let upload = upload.lock().await;

    // Ensure there are no buffered chunks
    if !upload.buffered_chunks.is_empty() {
      return Err("There are still buffered chunks!".into());
    }

    let handle_id = upload.handle_id;

    drop(upload);

    file_store.stop_upload(handle_id, true).await?;

    Ok(())
  }

  pub fn is_handle_valid(&self, handle: &String) -> bool {
    self.active_uploads_map.contains_key(handle)
  }
}
