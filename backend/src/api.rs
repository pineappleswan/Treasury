use axum::{
  extract::State,
  body::Body,
  response::{IntoResponse, Response},
  Json
};

use std::sync::Arc;
use http::StatusCode;
use serde::{Serialize, Deserialize};

use crate::AppState;

#[derive(Serialize, Deserialize)]
pub struct LoginRequest {
  username: String,

  #[serde(rename = "password")] // TODO: rename to authKey
  auth_key: String  
}

pub async fn login_api(
  State(state): State<Arc<AppState>>,
  Json(req): Json<LoginRequest>
) -> impl IntoResponse {
  println!("Username: {} Auth: {}", req.username, req.auth_key);

  let database = state.database.lock().await;

  let is_busy = match database.as_ref() {
    Some(db) => {
      db.connection.is_busy()
    },
    None => {
      false
    }
  };

  println!("Database is busy: {}", is_busy);

  Response::builder()
    .status(StatusCode::OK)
    .body(Body::from("Logged in..."))
    .unwrap()
}
