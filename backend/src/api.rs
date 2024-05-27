use axum::{
  extract,
  body::Body,
  response::{IntoResponse, Response},
  Json
};

use http::StatusCode;
use serde::{Serialize, Deserialize};
use serde_json::json;

#[derive(Serialize, Deserialize)]
pub struct LoginRequest {
  username: String,

  #[serde(rename = "password")]
  auth_key: String  
}

pub async fn login_api(Json(req): Json<LoginRequest>) -> impl IntoResponse {
  println!("Username: {} Auth: {}", req.username, req.auth_key);

  let response = json!({ "message": "hello" });

  Response::builder()
    .status(StatusCode::OK)
    .body(Body::from("Logged in..."))
    .unwrap()
}
