use axum::{
  extract::State,
  body::Body,
  response::{IntoResponse, Response},
  Json
};
use serde_json::json;

use std::{borrow::Borrow, sync::Arc};
use http::StatusCode;
use serde::{Serialize, Deserialize};
use tower_sessions::Session;
use tokio::sync::Mutex;

#[path = "../constants.rs"] mod constants;
#[path = "../util.rs"] mod util;
use util::{validate_base64_string};

use crate::AppState;

#[derive(Serialize, Deserialize)]
pub struct CheckClaimCodeRequest {
  #[serde(rename = "claimCode")]
  claim_code: String
}

#[derive(Serialize, Deserialize)]
pub struct CheckClaimCodeResponse {
  #[serde(rename = "isValid")]
  is_valid: bool,

  #[serde(rename = "storageQuota")]
  storage_quota: u64
}

pub async fn check_claim_code_api(
  session: Session,
  State(state): State<Arc<Mutex<AppState>>>,
  Json(req): Json<CheckClaimCodeRequest>
) -> Json<CheckClaimCodeResponse> {
  // Ensure length is correct
  if req.claim_code.len() != constants::CLAIM_CODE_LENGTH {
    return Json(CheckClaimCodeResponse { is_valid: false, storage_quota: 0 });
  }

  // Check validity with database
  let mut app_state = state.lock().await;
  let database = app_state.database.as_mut().unwrap();

  if let Ok(info) = database.get_claim_code_info(req.claim_code) {
    if let Some(info) = info {
      return Json(CheckClaimCodeResponse {
        is_valid: true,
        storage_quota: info.storage_quota
      });
    }
  }
    
  return Json(CheckClaimCodeResponse { is_valid: false, storage_quota: 0 });
}

#[derive(Serialize, Deserialize)]
pub struct ClaimAccountRequest {
  #[serde(rename = "claimCode")]
  claim_code: String,

  #[serde(rename = "authKey", default)]
  auth_key: String, // Uses Base64 encoding
  
  #[serde(rename = "encryptedMasterKey", default)]
  encrypted_master_key: String, // Uses Base64 encoding

  #[serde(rename = "encryptedEd25519PrivateKey", default)]
  encrypted_ed25519_private_key: String, // Uses Base64 encoding

  #[serde(rename = "encryptedX25519PrivateKey", default)]
  encrypted_x25519_private_key: String, // Uses Base64 encoding

  #[serde(rename = "ed25519PublicKey", default)]
  ed25519_public_key: String, // Uses Base64 encoding

  #[serde(rename = "x25519PublicKey", default)]
  x25519_public_key: String, // Uses Base64 encoding

  #[serde(default)]
  salt: String, // Uses Base64 encoding

  #[serde(default)]
  username: String
}

impl ClaimAccountRequest {
  pub fn validate(&self) -> Result<(), String> {
    // claim_code
    if self.claim_code.len() != constants::CLAIM_CODE_LENGTH {
      return Err("Incorrect claim code length.".to_string());
    }

    // auth_key
    if !self.auth_key.is_empty() {
      if let Err(err) = validate_base64_string(&self.auth_key, constants::AUTH_KEY_SIZE) {
        return Err(format!("auth_key validation error: {}", err));
      }
    }

    // encrypted_master_key
    if !self.encrypted_master_key.is_empty() {
      if let Err(err) = validate_base64_string(&self.encrypted_master_key, constants::ENCRYPTED_MASTER_KEY_SIZE) {
        return Err(format!("encrypted_master_key validation error: {}", err));
      }
    }

    // encrypted_ed25519_private_key
    if !self.encrypted_ed25519_private_key.is_empty() {
      if let Err(err) = validate_base64_string(&self.encrypted_ed25519_private_key, constants::ENCRYPTED_CURVE25519_KEY_SIZE) {
        return Err(format!("encrypted_ed25519_private_key validation error: {}", err));
      }
    }

    // encrypted_x25519_private_key
    if !self.encrypted_x25519_private_key.is_empty() {
      if let Err(err) = validate_base64_string(&self.encrypted_x25519_private_key, constants::ENCRYPTED_CURVE25519_KEY_SIZE) {
        return Err(format!("encrypted_x25519_private_key validation error: {}", err));
      }
    }

    // ed25519_public_key
    if !self.ed25519_public_key.is_empty() {
      if let Err(err) = validate_base64_string(&self.ed25519_public_key, constants::CURVE25519_KEY_SIZE) {
        return Err(format!("ed25519_public_key validation error: {}", err));
      }
    }

    // x25519_public_key
    if !self.x25519_public_key.is_empty() {
      if let Err(err) = validate_base64_string(&self.x25519_public_key, constants::CURVE25519_KEY_SIZE) {
        return Err(format!("x25519_public_key validation error: {}", err));
      }
    }

    Ok(())
  }
}

#[derive(Serialize, Deserialize)]
pub struct LoginRequest {
  username: String,

  #[serde(rename = "authKey")]
  auth_key: String  
}

pub async fn claim_account_api(
  session: Session,
  State(state): State<Arc<Mutex<AppState>>>,
  Json(req): Json<ClaimAccountRequest>
) -> impl IntoResponse {
  println!("claim account");

  Response::builder()
    .status(StatusCode::OK)
    .body(Body::from("Logged in..."))
    .unwrap()
}

pub async fn login_api(
  session: Session,
  State(state): State<Arc<Mutex<AppState>>>,
  Json(req): Json<LoginRequest>
) -> impl IntoResponse {
  println!("Username: {} Auth: {}", req.username, req.auth_key);

  /*
  let user_id_option = session.get::<u32>(constants::SESSION_USER_ID_KEY).await.unwrap_or_default();

  if let Some(user_id) = user_id_option {
    println!("Claim account - user_id: {}", user_id);
    
    return Response::builder()
      .status(StatusCode::OK)
      .body(Body::empty())
      .unwrap();
  } else {
    println!("Claim account - No user id found");
  }
  */

  Response::builder()
    .status(StatusCode::OK)
    .body(Body::from("Logged in..."))
    .unwrap()
}
