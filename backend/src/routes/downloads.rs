use axum::{
  body::Body, extract::{Path, State}, response::IntoResponse
};

use http::StatusCode;
use std::{borrow::BorrowMut, sync::Arc};
use std::error::Error;
use tower_sessions::Session;
use serde::Deserialize;
use log::error;

use crate::{
  core::sessions::get_user_session_data, constants, AppState
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

  let mut file_store_guard = state.file_store.lock().await;
  let file_store = file_store_guard.borrow_mut();

  match state.downloads_manager.try_read_chunk_as_stream(
    session_data.user_id,
    &path_params.handle,
    path_params.chunk,
    file_store,
    database
  ).await {
    Ok(stream) => {
      drop(database_guard);
      drop(file_store_guard);

      Body::from_stream(stream).into_response()
    },
    Err(err) => {
      error!("Try read chunk as stream error: {}", err);
      StatusCode::BAD_REQUEST.into_response()
    }
  }
}
