use axum::{
  extract::{Path, State}, response::IntoResponse
};

use http::StatusCode;
use std::sync::Arc;
use std::error::Error;
use tower_sessions::Session;
use serde::Deserialize;
use log::{error, warn};

use crate::{
  constants, core::sessions::get_user_session_data, storage::file_store::StorageVolumeId, AppState
};

use crate::{
  get_session_data_or_return_unauthorized,
  validate_string_is_ascii_alphanumeric,
  validate_string_length
};

// ----------------------------------------------
// API - Download chunk
// ----------------------------------------------

#[derive(Deserialize)]
pub struct DownloadChunkPathParams {
  handle: String,
  chunk: u64
}

impl DownloadChunkPathParams {
  pub fn validate(&self) -> Result<(), Box<dyn Error>> {
    validate_string_is_ascii_alphanumeric!(self, handle);
    validate_string_length!(self, handle, constants::FILE_HANDLE_LENGTH);

    Ok(())
  }
}

pub async fn download_chunk_api(
  session: Session,
  State(state): State<Arc<AppState>>,
  Path(path_params): Path<DownloadChunkPathParams>
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  // Validate
  if let Err(err) = path_params.validate() {
    return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
  }
  
  let mut database_guard = state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  // Get volume id of file
  let file_info = match database.get_file_from_handle(session_data.user_id, &path_params.handle) {
    Ok(info) => info,
    Err(err) => {
      warn!(
        "User {} requested download chunk of file handle '{}' but rusqlite responded with error: {}",
        session_data.user_id,
        &path_params.handle,
        err
      );

      return (StatusCode::NOT_FOUND, "Handle not found.").into_response();
    }
  };

  drop(database_guard);
  
  // If volume id is none, then this is a folder
  if file_info.volume_id.is_none() {
    return (StatusCode::BAD_REQUEST, "Requested file cannot be downloaded.").into_response();
  }

  match state.downloads_manager.read_chunk(
    StorageVolumeId(file_info.volume_id.unwrap()),
    path_params.handle,
    session_data.user_id,
    path_params.chunk,
  ).await {
    Ok(chunk) => {
      chunk.into_response()
    },
    Err(err) => {
      error!("Try read chunk as stream error: {}", err);
      StatusCode::BAD_REQUEST.into_response()
    }
  }
}
