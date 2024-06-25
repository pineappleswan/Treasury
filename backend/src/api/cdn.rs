use axum::{
  body::Body, extract::Path, response::IntoResponse
};

use tokio::fs::File;
use tokio_util::io::ReaderStream;
use http::{header::{CACHE_CONTROL, CONTENT_TYPE}, HeaderMap, StatusCode};
use tower_sessions::Session;
use serde::Deserialize;
use log::error;

use crate::{
  api::utils::auth_utils::get_user_session_data,
  get_session_data_or_return_unauthorized
};

// ----------------------------------------------
// API - CDN
// ----------------------------------------------

#[derive(Deserialize)]
pub struct CDNPathParams {
  name: String
}

pub async fn cdn_api(
  session: Session,
  Path(path_params): Path<CDNPathParams>
) -> impl IntoResponse {
  // Ensure only authorised users can use the CDN
  let _ = get_session_data_or_return_unauthorized!(session);

  // Determine the path of the requested file
  let file_path: &str = match path_params.name.as_str() {
    "ffmpegcorewasm" => "../cdn/ffmpeg/ffmpeg-core.wasm", // TODO: cache and compress this on the first load into memory + .env setting for that feature
    "ffmpegcorejs" => "../cdn/ffmpeg/ffmpeg-core.js",
    _ => return StatusCode::NOT_FOUND.into_response()
  };

  // Open the file
  let file = match File::open(file_path).await {
    Ok(file) => file,
    Err(err) => {
      error!("CDN error for path {}: {}", file_path, err);
      return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
  };
  
  // Set headers
  let mut headers = HeaderMap::new();
  headers.insert(CONTENT_TYPE, "application/octet-stream".parse().unwrap());
  headers.insert(CACHE_CONTROL, "max-age=86400".parse().unwrap());

  let stream = ReaderStream::new(file);

  (headers, Body::from_stream(stream)).into_response()
}
