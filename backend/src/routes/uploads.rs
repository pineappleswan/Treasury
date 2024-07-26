use axum::{
  extract::{Multipart, State, Path}, response::IntoResponse, Json
};

use axum_macros::debug_handler;
use http::StatusCode;
use std::sync::Arc;
use std::error::Error;
use tower_sessions::Session;
use serde::{Serialize, Deserialize};
use log::{error, warn};
use base64::{engine::general_purpose, Engine as _};

#[rustfmt::skip]
use crate::{
  constants,
  core::sessions::*,
  storage::database::UserFileEntry,
  util::{
    formats::calc_file_chunk_count,
    misc::generate_file_handle,
    multipart::*
  },
  AppState
};

use crate::{
  get_session_data_or_return_unauthorized,
  validate_base64_byte_size,
  validate_base64_max_byte_size,
  validate_integer_max_value,
  validate_string_is_ascii_alphanumeric,
  validate_string_length,
  validate_vector_length_range,
  validate_integer_is_positive
};

use crate::{
  read_next_multipart_data_as_bytes_or_bad_request,
  read_next_multipart_data_as_i64_or_bad_request,
  read_next_multipart_data_as_string_or_bad_request
};

// ----------------------------------------------
// API - Start upload
// ----------------------------------------------

#[derive(Deserialize)]
pub struct StartUploadRequest {
  #[serde(rename = "fileSize")]
  file_size: u64
}

#[derive(Serialize)]
pub struct StartUploadResponse {
  handle: String
}

impl StartUploadRequest {
  pub fn validate(&self) -> Result<(), Box<dyn Error>> {
    validate_integer_max_value!(self, file_size, constants::MAX_UPLOAD_SIZE);

    Ok(())
  }
}

#[debug_handler]
pub async fn start_upload_api(
  session: Session,
  State(state): State<Arc<AppState>>,
  Json(req): Json<StartUploadRequest>
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  // Validate
  if let Err(err) = req.validate() {
    return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
  }
  
  let handle = generate_file_handle();

  match state.uploads_manager.new_upload(session_data.user_id, &handle, req.file_size, &state.file_store).await {
    Ok(_) => Json(StartUploadResponse { handle }).into_response(),
    Err(err) => {
      error!("Failed to create new upload. Error: {}", err);
      StatusCode::INTERNAL_SERVER_ERROR.into_response()
    }
  }
}

// ----------------------------------------------
// API - Finalise upload
// ----------------------------------------------

#[derive(Deserialize)]
pub struct FinaliseUploadPathParams {
  handle: String
}

impl FinaliseUploadPathParams {
  pub fn validate(&self) -> Result<(), Box<dyn Error>> {
    validate_string_is_ascii_alphanumeric!(self, handle);
    validate_string_length!(self, handle, constants::FILE_HANDLE_LENGTH);

    Ok(())
  }
}

#[derive(Deserialize)]
pub struct FinaliseUploadRequest {
  #[serde(rename = "parentHandle")]
  parent_handle: String,

  #[serde(rename = "encryptedMetadata")]
  encrypted_metadata: String, // Base64 string

  #[serde(rename = "encryptedFileCryptKey")]
  encrypted_file_crypt_key: String, // Base64 string
}

impl FinaliseUploadRequest {
  pub fn validate(&self) -> Result<(), Box<dyn Error>> {
    validate_string_is_ascii_alphanumeric!(self, parent_handle);
    validate_string_length!(self, parent_handle, constants::FILE_HANDLE_LENGTH);
    validate_base64_max_byte_size!(self, encrypted_metadata, constants::ENCRYPTED_FILE_METADATA_MAX_SIZE);
    validate_base64_byte_size!(self, encrypted_file_crypt_key, constants::ENCRYPTED_FILE_CRYPT_KEY_SIZE);

    Ok(())
  }
}

pub async fn finalise_upload_api(
  session: Session,
  State(state): State<Arc<AppState>>,
  Path(path_params): Path<FinaliseUploadPathParams>,
  Json(req): Json<FinaliseUploadRequest>
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  // Validate
  if let Err(err) = path_params.validate() {
    return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
  }

  if let Err(err) = req.validate() {
    return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
  }

  if !state.uploads_manager.active_uploads_map.contains_key(&path_params.handle) {
    return StatusCode::NOT_FOUND.into_response();
  }
  
  // Check if finalisation can proceed
  let mut active_upload = state.uploads_manager.active_uploads_map.get_mut(&path_params.handle).unwrap();

  if active_upload.finalise_in_progress {
    return (StatusCode::BAD_REQUEST, "Already finalised!").into_response();
  } else {
    active_upload.finalise_in_progress = true;
  }

  // Metadata about the upload
  let upload_file_size = active_upload.file_size;
  let upload_written_bytes = active_upload.written_bytes;
  let buffered_chunk_count = active_upload.buffered_chunks.len();
  let expected_chunk_count = calc_file_chunk_count(upload_file_size);
  let bytes_left_to_write = upload_file_size as i64 - upload_written_bytes as i64;
  let next_chunk_id = active_upload.next_chunk_id;

  let upload_volume_id = active_upload.volume_id;

  drop(active_upload);
  
  // Ensure the correct number of bytes have been written to the upload file.
  if upload_written_bytes != upload_file_size {
    warn!(
      "Couldn't finalise upload by user {}.
      Bytes left to write: {}.
      Buffered chunks left to write: {}
      Next chunk id: {}
      Total chunks: {}",
      session_data.user_id,
      bytes_left_to_write,
      buffered_chunk_count,
      next_chunk_id,
      expected_chunk_count
    );

    return (
      StatusCode::BAD_REQUEST,
      format!("Can't finalise. Bytes left to write: {}", bytes_left_to_write)
    ).into_response();
  }

  // Finalise the upload
  match state.uploads_manager.finalise_upload(&path_params.handle, &state.file_store).await {
    Ok(_) => (),
    Err(err) => {
      error!("Finalise upload error: {}", err);

      // Respond with 500 even though it could be a genuinely bad request from the client. However
      // it's more likely that the server has an issue in most situations so 500 is used.
      return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
  };

  // Insert new file entry into the database
  let encrypted_crypt_key = general_purpose::STANDARD.decode(req.encrypted_file_crypt_key).unwrap();
  let encrypted_metadata = general_purpose::STANDARD.decode(req.encrypted_metadata).unwrap();

  let new_file = UserFileEntry {
    id: None,
    owner_id: session_data.user_id,
    volume_id: Some(upload_volume_id.into()),
    handle: path_params.handle.clone(),
    parent_handle: req.parent_handle,
    size: upload_file_size,
    encrypted_crypt_key: Some(encrypted_crypt_key),
    encrypted_metadata
  };

  // Acquire database and insert new file for this user
  let mut database_guard = state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  match database.insert_new_user_file(&new_file) {
    Ok(_) => {
      drop(database_guard);

      // Tell client to sync
      let broadcast_result = state.broadcast_web_socket_message(
        &session_data.user_id,
        format!("syncFile|{}", path_params.handle)
      );

      if let Err(err) = broadcast_result {
        error!("Broadcast web socket message error: {}", err);
      }

      StatusCode::OK.into_response()
    },
    Err(err) => {
      error!("rusqlite error: {}", err);
      StatusCode::INTERNAL_SERVER_ERROR.into_response()
    }
  }
}

// ----------------------------------------------
// API - Upload chunk
// ----------------------------------------------

pub async fn upload_chunk_api(
  session: Session,
  State(state): State<Arc<AppState>>,
  mut multipart: Multipart
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  // Read multipart data
  let handle = read_next_multipart_data_as_string_or_bad_request!(multipart, "handle");
  let chunk_id = read_next_multipart_data_as_i64_or_bad_request!(multipart, "chunkId");
  let data = read_next_multipart_data_as_bytes_or_bad_request!(multipart, "data");
  
  // Validate
  let validate = || -> Result<(), Box<dyn Error>> {
    validate_string_length!(handle, constants::FILE_HANDLE_LENGTH);
    validate_integer_is_positive!(chunk_id);
    validate_vector_length_range!(data, constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE, constants::ENCRYPTED_CHUNK_SIZE);

    Ok(())
  };

  if let Err(err) = validate() {
    return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
  }

  // Get active upload by the handle
  let mut active_upload = match state.uploads_manager.active_uploads_map.get_mut(&handle) {
    Some(upload) => upload,

    // Return bad request if no active upload was found because that means the handle is invalid.
    None => return (StatusCode::BAD_REQUEST, "Handle is invalid").into_response()
  };

  // Ensure chunk id is not less than the next expected chunk id because any chunk id before the
  // next expected chunk id would have already been written to the file.
  if chunk_id < active_upload.next_chunk_id as i64 {
    return (
      StatusCode::BAD_REQUEST,
      "Provided chunk id is less than the next expected chunk id."
    ).into_response();
  }
  
  // Ensure not too many chunks are buffered
  if active_upload.buffered_chunks.len() >= constants::MAX_UPLOAD_BUFFERED_CHUNKS {
    warn!("User {} reached max amount of buffered upload chunks. Buffered: {}", session_data.user_id, active_upload.buffered_chunks.len());

    return (
      StatusCode::TOO_MANY_REQUESTS,
      "Reached the maximum amount of buffered chunks"
    ).into_response();
  }

  // Add chunk to buffer
  match active_upload.try_write_chunk(chunk_id, data, &state.file_store).await {
    Ok(_) => StatusCode::OK.into_response(),
    Err(err) => (StatusCode::BAD_REQUEST, err.to_string()).into_response()
  }
}
