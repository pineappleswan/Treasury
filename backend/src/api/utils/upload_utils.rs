use std::collections::BTreeMap;
use std::path::PathBuf;
use dashmap::DashMap;
use tokio::{fs::File, io::{AsyncWriteExt, BufWriter}, sync::Mutex};
use std::error::Error;
use log::error;
use std::cmp;

use crate::{
  api::formats::calc_raw_chunk_size, config::Config, constants
};

pub struct ActiveUpload {
  pub user_id: u64,
  pub buf_writer: BufWriter<File>,

  /// The location where the temporary upload file is located.
  pub upload_file_path: PathBuf,

  /// The original unencrypted file size
  pub file_size: u64,

  /// The amount of bytes written to the file excluding file format overhead (inc. encryption overhead).
  pub written_bytes: u64,

  /// The next chunk id to be written which is used to ensure uploaded chunks are written in the correct order.
  pub next_chunk_id: u64,

  /// The buffered chunks which are automatically ordered by their chunk id using a BTreeMap.
  pub buffered_chunks: BTreeMap<i64, Vec<u8>>,

  pub finalise_in_progress: bool
}

impl ActiveUpload {
  pub fn new(user_id: u64, upload_file_path: PathBuf, file: File, file_size: u64) -> Self {
    Self {
      user_id,
      buf_writer: BufWriter::new(file),
      upload_file_path,
      file_size,
      written_bytes: 0,
      next_chunk_id: 0,
      buffered_chunks: BTreeMap::new(),
      finalise_in_progress: false
    }
  }

  pub async fn write_buffered_chunks(&mut self) -> Result<(), Box<dyn Error>> {
    // Try to write as many buffered chunks as possible
    let mut written_chunk_ids: Vec<i64> = Vec::with_capacity(constants::MAX_UPLOAD_CONCURRENT_CHUNKS);

    for (chunk_id, chunk) in self.buffered_chunks.iter_mut() {
      println!("Trying: {}", chunk_id);

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

      // Write chunk to disk when this chunk id is supposed to come next.
      if chunk_id - self.prev_written_chunk_id == 1 {
        // Write data
        self.buf_writer.write_all(chunk).await?;
        
        // Update
        self.written_bytes += raw_chunk_size;
        self.prev_written_chunk_id = *chunk_id;
        written_chunk_ids.push(*chunk_id);  
      } else {
        // Can't write buffered chunk which is okay, so break.
        println!("Can't write. Prev id: {}. Current id: {}", self.prev_written_chunk_id, chunk_id);

        break;
      }
    }

    // Remove written chunks from buffered chunks map
    for id in written_chunk_ids {
      self.buffered_chunks.remove(&id);
    }

    Ok(())
  }

  pub async fn try_write_chunk(&mut self, new_chunk_id: i64, data: Vec<u8>) -> Result<(), Box<dyn Error>> {
    // Add chunk to buffer
    self.buffered_chunks.insert(new_chunk_id, data);

    // Flush all buffered chunks
    self.write_buffered_chunks().await?;

    Ok(())
  }
}

pub struct UploadsManager {
  pub user_files_root_directory: PathBuf,
  pub user_upload_directory: PathBuf,

  /// Maps a file's handle string to an active upload
  pub active_uploads_map: DashMap<String, Mutex<ActiveUpload>>
}

impl UploadsManager {
  pub fn new(config: &Config) -> Self	{
    Self {
      user_files_root_directory: PathBuf::from(config.user_files_root_directory.clone()),
      user_upload_directory: PathBuf::from(config.user_upload_directory.clone()),
      active_uploads_map: DashMap::new()
    }
  }

  /// Creates a new upload with the given parameters 
  pub async fn new_upload(&self, user_id: u64, handle: &String, file_size: u64) -> Result<(), Box<dyn Error>> {
    // Create the file path
    let file_name = handle.clone() + constants::TREASURY_FILE_EXTENSION;
    let path = self.user_upload_directory.join(file_name);

    // Create the file
    let file = File::create(&path).await?;

    let mut upload = ActiveUpload::new(user_id, path, file, file_size);

    // Write header immediately
    upload.buf_writer.write_all(&constants::ENCRYPTED_FILE_MAGIC_NUMBER).await?;

    // Insert new active upload into the map
    self.active_uploads_map.insert(handle.clone(), Mutex::new(upload));

    Ok(())
  }

  /// Removes the upload from the active uploads map and flushes all the written data to the disk.
  /// It will then move the file from the temporary uploads directory to the user files directory.
  /// If it fails to finalise, the temporary upload file will be deleted.
  pub async fn finalise_upload(&self, handle: &String) -> Result<(), Box<dyn Error>> {
    // Ensure handle is valid
    if !self.is_handle_valid(handle) {
      return Err("No active upload with the provided handle was found.".into());
    }

    // Get upload by removing it from the map
    let mut upload = self.active_uploads_map.remove(handle).unwrap().1;

    // Ensure there are no buffered chunks
    if !upload.buffered_chunks.is_empty() {
      return Err("There are still buffered chunks!".into());
    }

    // Shutdown the internal buf writer
    upload.buf_writer.shutdown().await?;

    // Move uploaded file to user files directory
    let file_name = handle.clone() + constants::TREASURY_FILE_EXTENSION;

    let new_file_path = PathBuf::from(self.user_files_root_directory.clone())
      .join(file_name);

    let _ = tokio::fs::rename(&upload.upload_file_path, &new_file_path)
      .await
      .map_err(|err| {
        error!(
          "Failed to move file from uploads to user files directory! Operation: {:?} -> {:?} and error was: {}",
          upload.upload_file_path,
          new_file_path,
          err
        );

        err
      })?;

    Ok(())
  }

  pub fn is_handle_valid(&self, handle: &String) -> bool {
    self.active_uploads_map.contains_key(handle)
  }
}
