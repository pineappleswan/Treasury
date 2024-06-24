use axum::{
  extract::{Query, State, Path}, response::IntoResponse, Json
};

use argon2::{
  password_hash::{
    rand_core::OsRng,
    PasswordHasher, SaltString
  },
  Argon2, Params
};

use base64::{engine::general_purpose, Engine as _};
use std::sync::Arc;
use http::StatusCode;
use serde::{Serialize, Deserialize};
use tower_sessions::Session;
use tokio::sync::Mutex;
use std::error::Error;
use log::error;

use crate::{
  AppState,
  constants,
  database::{
    ClaimUserRequest,
    UserData
  },
  validate_base64_byte_size,
  validate_string_is_ascii_alphanumeric,
  validate_string_length,
  validate_string_length_range
};

// ----------------------------------------------
// API - Get claim code info
// ----------------------------------------------

#[derive(Deserialize)]
pub struct ClaimCodeParams {
  code: String
}

#[derive(Serialize)]
pub struct ClaimCodeResponse {
  #[serde(rename = "isValid")]
  is_valid: bool,

  #[serde(rename = "storageQuota")]
  storage_quota: u64
}

pub async fn get_claim_code_api(
  _session: Session,
  State(state): State<Arc<Mutex<AppState>>>,
  Query(params): Query<ClaimCodeParams>
) -> impl IntoResponse {
  // Ensure length is correct
  if params.code.len() != constants::CLAIM_CODE_LENGTH {
    return (StatusCode::BAD_REQUEST, "'code' length is incorrect.").into_response();
  }

  // Check validity with database
  let mut app_state = state.lock().await;
  let database = app_state.database.as_mut().unwrap();

  if let Ok(info) = database.get_claim_code_info(&params.code) {
    Json(ClaimCodeResponse {
      is_valid: true,
      storage_quota: info.storage_quota
    }).into_response()
  } else {
    Json(ClaimCodeResponse { is_valid: false, storage_quota: 0 }).into_response()
  }
}

// ----------------------------------------------
// API - Claim account
// ----------------------------------------------

#[derive(Deserialize)]
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
  pub fn validate(&self) -> Result<(), Box<dyn Error>> {
    validate_string_length!(self, claim_code, constants::CLAIM_CODE_LENGTH);
    validate_string_length_range!(self, username, constants::MIN_USERNAME_LENGTH, constants::MAX_USERNAME_LENGTH);
    validate_string_is_ascii_alphanumeric!(self, username);
    validate_base64_byte_size!(self, auth_key, constants::AUTH_KEY_SIZE);
    validate_base64_byte_size!(self, encrypted_master_key, constants::ENCRYPTED_MASTER_KEY_SIZE);
    validate_base64_byte_size!(self, encrypted_ed25519_private_key, constants::ENCRYPTED_CURVE25519_KEY_SIZE);
    validate_base64_byte_size!(self, encrypted_x25519_private_key, constants::ENCRYPTED_CURVE25519_KEY_SIZE);
    validate_base64_byte_size!(self, ed25519_public_key, constants::CURVE25519_KEY_SIZE);
    validate_base64_byte_size!(self, x25519_public_key, constants::CURVE25519_KEY_SIZE);
    validate_base64_byte_size!(self, salt, constants::SALT_SIZE);

    Ok(())
  }
}

pub async fn claim_api(
  _session: Session,
  State(state): State<Arc<Mutex<AppState>>>,
  Json(req): Json<ClaimAccountRequest>
) -> impl IntoResponse {
  // Validate request
  if let Err(err) = req.validate() {
    return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
  }

  // Acquire database
  let mut app_state = state.lock().await;
  let database = app_state.database.as_mut().unwrap();

  // Ensure the username isn't already taken
  let is_username_taken = match database.is_username_taken_case_insensitive(&req.username) {
    Ok(taken) => taken,
    Err(err) => {
      error!("Is username taken check error: {}", err);
      return StatusCode::INTERNAL_SERVER_ERROR.into_response()
    }
  };

  if is_username_taken {
    return (StatusCode::CONFLICT, "Username is taken!").into_response();
  }

  // Hash the authentication key
  let auth_key_bytes = general_purpose::STANDARD.decode(&req.auth_key).unwrap();
  
  let salt = SaltString::generate(&mut OsRng); // Random salt for the hash

  let argon2 = Argon2::new(
    argon2::Algorithm::Argon2id,
    argon2::Version::V0x13,
    Params::new(
      constants::ARGON2_MEMORY_SIZE as u32,
      constants::ARGON2_ITERATIONS as u32,
      constants::ARGON2_PARALLELISM as u32,
      None // Use default output length
    ).unwrap()
  );

  let auth_key_hash = argon2.hash_password(&auth_key_bytes, &salt).unwrap().to_string();

  // Decode Base64
  let claim_user_data = UserData {
    username: req.username,
    auth_key_hash,
    salt: general_purpose::STANDARD.decode(req.salt).unwrap(),
    encrypted_master_key: general_purpose::STANDARD.decode(req.encrypted_master_key).unwrap(),
    encrypted_ed25519_private_key: general_purpose::STANDARD.decode(req.encrypted_ed25519_private_key).unwrap(),
    ed25519_public_key: general_purpose::STANDARD.decode(req.ed25519_public_key).unwrap(),
    encrypted_x25519_private_key: general_purpose::STANDARD.decode(req.encrypted_x25519_private_key).unwrap(),
    x25519_public_key: general_purpose::STANDARD.decode(req.x25519_public_key).unwrap(),
    storage_quota: None,
    user_id: None
  };

  let claim_request = ClaimUserRequest {
    claim_code: req.claim_code,
    user_data: claim_user_data
  };

  match database.claim_user(&claim_request) {
    Ok(_) => StatusCode::OK.into_response(),
    Err(err) => {
      error!("database.claim_user error: {}", err);
      StatusCode::INTERNAL_SERVER_ERROR.into_response()
    }
  }
}

// ----------------------------------------------
// API - Get salt
// ----------------------------------------------

#[derive(Deserialize)]
pub struct GetUserSaltPathParams {
  username: String
}

#[derive(Serialize)]
pub struct GetUserSaltResponse {
  salt: String // Base64 encoded
}

pub async fn get_salt_api(
  _session: Session,
  State(state): State<Arc<Mutex<AppState>>>,
  Path(path_params): Path<GetUserSaltPathParams>
) -> impl IntoResponse {
  // Acquire database
  let mut app_state = state.lock().await;
  let database = app_state.database.as_mut().unwrap();

  match database.get_user_data(&path_params.username) {
    Ok(user_data) => {
      let salt_b64 = general_purpose::STANDARD.encode(user_data.salt);

      Json(GetUserSaltResponse { salt: salt_b64 }).into_response()
    },
    Err(_) => {
      // Generate a non-random hash of the username to act as the salt so that existing usernames can't
      // be easily revealed.
      let mut hasher = blake3::Hasher::new();
      
      // Add the username to the hasher.
      hasher.update(path_params.username.as_bytes());

      // Add the session secret key of the server config to make it hard to easily determine that this
      // is a fake salt.
      hasher.update(app_state.config.session_secret_key.master());

      // Get the hash of SALT_SIZE length.
      let mut hash_output = [0; constants::SALT_SIZE];
      let mut output_reader = hasher.finalize_xof();
      output_reader.fill(&mut hash_output);

      // Convert to base64.
      let salt_b64 = general_purpose::STANDARD.encode(hash_output);

      Json(GetUserSaltResponse { salt: salt_b64 }).into_response()
    }
  }
}
