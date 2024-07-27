use std::collections::BTreeMap;
use dashmap::DashMap;
use log::warn;
use std::error::Error;

use crate::{
  storage::file_store::{FileStoreHandleId, FileStoreManager, StorageVolumeId},
  util::formats::{calc_encrypted_file_size, calc_expected_chunk_size, calc_file_chunk_count, calc_raw_chunk_size}
};

pub struct ActiveUpload {
  /// The id of the user that started this upload.
  pub user_id: u64,
  
  /// The handle id into the file store
  pub handle_id: FileStoreHandleId,
  
  /// The id of the storage volume where the uploaded file is located.
  pub volume_id: StorageVolumeId,
  
  /// The original unencrypted file size
  pub file_size: u64,
  
  /// The number of chunks expected of this upload which is calculated from `file_size`.
  pub chunk_count: u64,

  /// The amount of bytes written to the file excluding file format overhead (inc. encryption overhead).
  pub written_bytes: u64,

  /// The next chunk id that is expected to be written. This is used to detect when chunks arrive
  /// out of order which will be dealt with.
  pub next_chunk_id: u32,

  /// Out of order chunks will have their chunk id and real chunk id added to this map where the key 
  /// is the chunk id and the value is the **real** chunk id.
  pub out_of_order_chunk_id_map: BTreeMap<u32, u32>,

  /// A vector of booleans that are all false when an upload is started. It's used to prevent the user 
  /// from writing two chunks of the same id to the server.
  pub written_chunks: Vec<bool>,

  pub finalise_in_progress: bool
}

impl ActiveUpload {
  pub fn new(handle_id: FileStoreHandleId, user_id: u64, volume_id: StorageVolumeId, file_size: u64) -> Self {
    let chunk_count = calc_file_chunk_count(file_size);

    Self {
      user_id,
      handle_id,
      volume_id,
      file_size,
      chunk_count,
      written_bytes: 0,
      next_chunk_id: 0,
      out_of_order_chunk_id_map: BTreeMap::new(),
      written_chunks: vec![false; chunk_count as usize],
      finalise_in_progress: false
    }
  }

  pub async fn write_chunk(&mut self, chunk_id: u32, chunk: Vec<u8>, file_store: &FileStoreManager) -> Result<(), Box<dyn Error>> {
    // Ensure chunk id is in a valid range
    if chunk_id >= self.chunk_count as u32 {
      return Err(
        format!(
          "Chunk id must be less than the expected chunk count for this upload of {}.",
          self.chunk_count
        ).into()
      );
    }

    // Ensure chunk id is not a duplicate
    if self.written_chunks[chunk_id as usize] == true {
      return Err(format!("Chunk {} has already been written!",chunk_id).into());
    }

    // Get raw chunk size because the chunk is encrypted as it was received from the client
    let enc_chunk_size = chunk.len() as u64;
    let raw_chunk_size = calc_raw_chunk_size(enc_chunk_size);

    // Calculate the expected received chunk size
    let expected_enc_chunk_size = calc_expected_chunk_size(self.file_size, self.written_bytes);

    // Ensure chunk size meets expected encrypted chunk size
    if enc_chunk_size as i64 != expected_enc_chunk_size {
      warn!(
        "User {} wrote chunk of id {} with size {} but expected {}.",
        self.user_id,
        chunk_id,
        enc_chunk_size,
        expected_enc_chunk_size
      );

      return Err(
        format!(
          "Expected encrypted chunk size {} but got {} instead.",
          expected_enc_chunk_size,
          enc_chunk_size
        ).into()
      );
    }
    
    // Write data
    file_store.append_bytes(self.handle_id, &chunk).await?;
    
    // Detect out of order chunks
    if self.next_chunk_id != chunk_id {
      self.out_of_order_chunk_id_map.insert(chunk_id, self.next_chunk_id);
    }

    // Mark as written
    self.written_chunks[chunk_id as usize] = true;
    
    // Update
    self.next_chunk_id += 1;
    self.written_bytes += raw_chunk_size;

    Ok(())
  }
}

pub struct UploadManager {
  /// Maps a file's handle string to an upload's handle id
  pub active_uploads_map: DashMap<String, ActiveUpload>
}

impl UploadManager {
  pub fn new() -> Self	{
    Self {
      active_uploads_map: DashMap::new()
    }
  }

  /// Creates a new upload with the given parameters 
  pub async fn new_upload(&self, user_id: u64, handle: &String, file_size: u64, file_store: &FileStoreManager) -> Result<(), Box<dyn Error>> {
    // Calculate reserved size as encrypted file size
    let reserved_size = calc_encrypted_file_size(file_size);

    let (upload_handle_id, upload_volume_id) = file_store.start_writing(handle.clone(), user_id, reserved_size).await?;

    let upload = ActiveUpload::new(upload_handle_id, user_id, upload_volume_id, file_size);

    // Insert new active upload into the map
    self.active_uploads_map.insert(handle.clone(), upload);

    Ok(())
  }

  /// Removes the upload from the active uploads map and flushes all the written data to the disk.
  /// It will then move the file from the temporary uploads directory to the user files directory.
  /// If it fails to finalise, the temporary upload file will be deleted.
  pub async fn finalise_upload(&self, handle: &String, file_store: &FileStoreManager) -> Result<(), Box<dyn Error>> {
    // Ensure handle is valid
    if !self.is_handle_valid(handle) {
      return Err("No active upload with the provided handle was found.".into());
    }

    // Get upload by removing it from the map
    let upload = self.active_uploads_map.remove(handle).unwrap().1;
    let handle_id = upload.handle_id;

    // Ensure that are chunks were written
    let all_chunks_written = upload.written_chunks.iter().all(|&x| x == true);

    if !all_chunks_written {
      return Err("Not all chunks have been written!".into());
    }

    // Write chunk id map at the end
    let out_of_order_chunk_count = upload.out_of_order_chunk_id_map.len();
    let mut chunk_id_map_data: Vec<u32> = vec![0; out_of_order_chunk_count * 2 + 1];

    for (i, (chunk_id, real_chunk_id)) in upload.out_of_order_chunk_id_map.iter().enumerate() {
      chunk_id_map_data[i * 2 + 0] = chunk_id; 
      chunk_id_map_data[i * 2 + 1] = real_chunk_id; 
    }

    chunk_id_map_data[chunk_id_map_data.len() - 1] = ou

    file_store.append_bytes(upload, &chunk).await?;

    // Drop upload and stop writing
    drop(upload);
    file_store.stop_writing(handle_id, true).await?;

    Ok(())
  }

  pub fn is_handle_valid(&self, handle: &String) -> bool {
    self.active_uploads_map.contains_key(handle)
  }
}
