use axum::{
  extract::State,
  body::Body,
  response::{IntoResponse, Response},
  Json
};

use argon2::{
  password_hash::{
    rand_core::OsRng,
    PasswordHash, PasswordHasher, PasswordVerifier, SaltString
  },
  Argon2, Params
};

use base64::{engine::general_purpose, Engine as _};
use serde_json::json;
use std::{borrow::Borrow, sync::Arc};
use http::StatusCode;
use serde::{Serialize, Deserialize};
use tower_sessions::Session;
use tokio::sync::Mutex;

#[path = "../constants.rs"] mod constants;
#[path = "../util.rs"] mod util;
use util::{validate_base64_string};

use crate::{database::ClaimUserData, AppState};

#[derive(Serialize, Deserialize, Debug)]
pub struct CheckClaimCodeRequest {
  #[serde(rename = "claimCode")]
  claim_code: String
}

#[derive(Serialize, Deserialize, Debug)]
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

#[derive(Serialize, Deserialize, Debug)]
pub struct ClaimAccountRequest {
  #[serde(rename = "claimCode")]
  claim_code: String,

  username: String,

  // Everything below is encoded in Base64
  #[serde(rename = "authKey")]
  auth_key: String, 
  
  #[serde(rename = "encryptedMasterKey")]
  encrypted_master_key: String,
  
  #[serde(rename = "encryptedEd25519PrivateKey")]
  encrypted_ed25519_private_key: String,
  
  #[serde(rename = "encryptedX25519PrivateKey")]
  encrypted_x25519_private_key: String,
  
  #[serde(rename = "ed25519PublicKey")]
  ed25519_public_key: String,
  
  #[serde(rename = "x25519PublicKey")]
  x25519_public_key: String,
  
  salt: String
}

impl ClaimAccountRequest {
  pub fn validate(&self) -> Result<(), String> {
    // claim_code
    if self.claim_code.len() != constants::CLAIM_CODE_LENGTH {
      return Err("Incorrect claim code length.".to_string());
    }

    // username
    if self.username.len() < constants::MIN_USERNAME_LENGTH {
      return Err("Username is too short.".to_string());
    }

    if self.username.len() > constants::MAX_USERNAME_LENGTH {
      return Err("Username is too long.".to_string());
    }

    // auth_key
    if let Err(err) = validate_base64_string(&self.auth_key, constants::AUTH_KEY_SIZE) {
      return Err(format!("auth_key validation error: {}", err));
    }

    // encrypted_master_key
    if let Err(err) = validate_base64_string(&self.encrypted_master_key, constants::ENCRYPTED_MASTER_KEY_SIZE) {
      return Err(format!("encrypted_master_key validation error: {}", err));
    }

    // encrypted_ed25519_private_key
    if let Err(err) = validate_base64_string(&self.encrypted_ed25519_private_key, constants::ENCRYPTED_CURVE25519_KEY_SIZE) {
      return Err(format!("encrypted_ed25519_private_key validation error: {}", err));
    }

    // encrypted_x25519_private_key
    if let Err(err) = validate_base64_string(&self.encrypted_x25519_private_key, constants::ENCRYPTED_CURVE25519_KEY_SIZE) {
      return Err(format!("encrypted_x25519_private_key validation error: {}", err));
    }

    // ed25519_public_key
    if let Err(err) = validate_base64_string(&self.ed25519_public_key, constants::CURVE25519_KEY_SIZE) {
      return Err(format!("ed25519_public_key validation error: {}", err));
    }

    // x25519_public_key
    if let Err(err) = validate_base64_string(&self.x25519_public_key, constants::CURVE25519_KEY_SIZE) {
      return Err(format!("x25519_public_key validation error: {}", err));
    }

    Ok(())
  }
}

#[derive(Serialize, Deserialize, Debug)]
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
  // Validate request
  if let Err(err) = req.validate() {
    return
      Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .body(Body::from(err))
        .unwrap();
  }

  // Hash the authentication key
  let auth_key_bytes = general_purpose::STANDARD.decode(&req.auth_key).unwrap();
  
  let salt = SaltString::generate(&mut OsRng);

  let argon2 = Argon2::new(
    argon2::Algorithm::Argon2id,
    argon2::Version::V0x13,
    Params::new(
      constants::ARGON2_MEMORY_SIZE as u32,
      constants::ARGON2_ITERATIONS as u32,
      constants::ARGON2_PARALLELISM as u32,
      None // Use default
    ).unwrap()
  );

  let auth_key_hash = argon2.hash_password(&auth_key_bytes, &salt).unwrap().to_string();

  println!("Auth key: {}", req.auth_key);
  println!("Hash: {}", auth_key_hash);

  // Decode Base64
  let claim_user_data = ClaimUserData {
    claim_code: req.claim_code,
    username: req.username,
    auth_key_hash: auth_key_hash,
    salt: general_purpose::STANDARD.decode(req.salt).unwrap(),
    encrypted_master_key: general_purpose::STANDARD.decode(req.encrypted_master_key).unwrap(),
    encrypted_ed25519_private_key: general_purpose::STANDARD.decode(req.encrypted_ed25519_private_key).unwrap(),
    ed25519_public_key: general_purpose::STANDARD.decode(req.ed25519_public_key).unwrap(),
    encrypted_x25519_private_key: general_purpose::STANDARD.decode(req.encrypted_x25519_private_key).unwrap(),
    x25519_public_key: general_purpose::STANDARD.decode(req.x25519_public_key).unwrap()
  };

  // Acquire database
  let mut app_state = state.lock().await;
  let database = app_state.database.as_mut().unwrap();

  match database.claim_user(&claim_user_data) {
    Ok(_) => {
      println!("Successfully claimed user!");
    },
    Err(err) => {
      eprintln!("claim_user error: {}", err);
    }
  }

  Response::builder()
    .status(StatusCode::OK)
    .body(Body::empty())
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
