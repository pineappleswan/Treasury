use axum::{
  extract::State,
  body::Body,
  response::{IntoResponse, Response},
  Json
};

use http::StatusCode;
use std::sync::Arc;
use tower_sessions::Session;
use serde::{Serialize, Deserialize};
use tokio::sync::Mutex;

use crate::AppState;
#[path = "../database.rs"] mod database;
#[path = "../constants.rs"] mod constants;

#[derive(Serialize, Deserialize, Debug)]
pub struct StorageUsedResponse {
  #[serde(rename = "bytesUsed")]
  bytes_used: u64
}

pub async fn get_storage_used_api(
  session: Session,
  State(state): State<Arc<Mutex<AppState>>>
) -> impl IntoResponse {
  let user_id_option = session.get::<u64>(constants::SESSION_USER_ID_KEY).await.unwrap();

  if let Some(user_id) = user_id_option {
    // Acquire database
    let mut app_state = state.lock().await;
    let database = app_state.database.as_mut().unwrap();

    match database.get_user_storage_used(user_id) {
      Ok(bytes_used) => {
        Json(StorageUsedResponse { bytes_used }).into_response()
      },
      Err(err) => {
        eprintln!("rusqlite error: {}", err);
        (StatusCode::INTERNAL_SERVER_ERROR).into_response()
      }
    }
  } else {
    (StatusCode::UNAUTHORIZED).into_response()
  }
}
