use axum::{extract::State, response::IntoResponse, Json};
use axum_macros::debug_handler;
use base64::{engine::general_purpose, Engine as _};
use log::error;
use rand::{thread_rng, RngCore};
use serde_json::json;
use std::sync::{atomic::AtomicI64, Arc};
use std::error::Error;
use http::StatusCode;
use serde::{Serialize, Deserialize};
use totp_rs::{Rfc6238, TOTP};
use tower_sessions::Session;
use argon2::{
  password_hash::{PasswordHash, PasswordVerifier},
  Argon2
};

use crate::{
  constants,
  core::sessions::get_user_session_data,
  AppState,
  get_session_data_or_return_unauthorized,
  validate_base64_byte_size,
  validate_string_is_ascii_alphanumeric,
  validate_string_length_range
};

/// auth_key and auth_key_hash must be base64 strings
fn verify_auth_key_with_hash(auth_key: &str, auth_key_hash: &str) -> bool {
  // Verify auth hash by decoding base64 string and verifying it with Argon2
  let auth_key_bytes = general_purpose::STANDARD.decode(auth_key).unwrap();
  let auth_key_hash = PasswordHash::new(auth_key_hash).unwrap();
  let verified = Argon2::default().verify_password(auth_key_bytes.as_ref(), &auth_key_hash).is_ok();

  verified
}

// ----------------------------------------------
// API - Get session info
// ----------------------------------------------

#[derive(Serialize)]
pub struct GetSessionInfoResponse {
  #[serde(rename = "userId")]
  user_id: u64,

  username: String,

  #[serde(rename = "storageQuota")]
  storage_quota: u64
}

pub async fn get_session_data_api(
  session: Session,
  State(_state): State<Arc<AppState>>
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  Json(GetSessionInfoResponse {
    user_id: session_data.user_id,
    username: session_data.username,
    storage_quota: session_data.storage_quota
  }).into_response()
}

// ----------------------------------------------
// API - Login
// ----------------------------------------------

#[derive(Deserialize)]
pub struct LoginRequest {
  username: String,

  #[serde(rename = "authKey")]
  auth_key: String,

  #[serde(rename = "twoFactorCode")]
  two_factor_code: Option<String>
}

impl LoginRequest {
  pub fn validate(&self) -> Result<(), Box<dyn Error>> {
    validate_string_is_ascii_alphanumeric!(self, username);
    validate_string_length_range!(self, username, constants::MIN_USERNAME_LENGTH, constants::MAX_USERNAME_LENGTH);
    validate_base64_byte_size!(self, auth_key, constants::AUTH_KEY_SIZE);
    
    // Validate two factor code manually because it's an option type
    if let Some(code) = &self.two_factor_code {
      if code.len() != constants::TOTP_DIGIT_COUNT {
        return Err(
          format!(
            "Two factor code length is incorrect. Expected {} digits.",
            constants::TOTP_DIGIT_COUNT
          ).into()
        );
      }
    }

    Ok(())
  }
}

#[derive(Serialize)]
pub struct LoginResponse {
  #[serde(rename = "encryptedMasterKey")]
  encrypted_master_key: Option<String>,
  
  #[serde(rename = "encryptedEd25519PrivateKey")]
  encrypted_ed25519_private_key: Option<String>,
  
  #[serde(rename = "encryptedX25519PrivateKey")]
  encrypted_x25519_private_key: Option<String>,

  #[serde(rename = "requiresTwoFactorCode")]
  requires_two_factor_code: bool
}

pub async fn login_api(
  session: Session,
  State(state): State<Arc<AppState>>,
  Json(req): Json<LoginRequest>
) -> impl IntoResponse {
  // Validate request
  if let Err(err) = req.validate() {
    return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
  }

  // Acquire database
  let mut database_guard = state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  // Get user data from username
  let user_data = match database.get_user_data(&req.username) {
    Ok(data) => data,
    Err(_) => return StatusCode::UNAUTHORIZED.into_response()
  };

  drop(database_guard);

  // Verify auth key
  if !verify_auth_key_with_hash(&req.auth_key, &user_data.auth_key_hash) {
    return StatusCode::UNAUTHORIZED.into_response();
  }

  // Check two factor code if required for this user
  if let Some(totp_secret) = user_data.totp_secret {
    if let Some(two_factor_code) = req.two_factor_code {
      // Verify two factor code
      let mut rfc = Rfc6238::with_defaults(totp_secret).unwrap();
      rfc.digits(6).unwrap();

      let totp = TOTP::from_rfc6238(rfc).unwrap();
      let value = totp.generate_current().unwrap();

      if value != two_factor_code {
        return StatusCode::UNAUTHORIZED.into_response();
      }
    } else {
      // Tell user they need to resubmit the login request with a two factor authentication code
      return Json(LoginResponse {
        encrypted_master_key: None,
        encrypted_ed25519_private_key: None,
        encrypted_x25519_private_key: None,
        requires_two_factor_code: true
      }).into_response()
    }
  }
  
  // Update user session to be logged in
  let user_id = user_data.user_id.unwrap();

  session.insert_value(constants::SESSION_USER_ID_KEY, json!(user_id)).await.unwrap();
  session.insert_value(constants::SESSION_USERNAME_KEY, json!(user_data.username)).await.unwrap();
  session.insert_value(constants::SESSION_STORAGE_QUOTA_KEY, json!(user_data.storage_quota)).await.unwrap();

  // Update web socket data
  if state.web_socket_count_per_user_map.get(&user_id).is_none() {
    state.web_socket_count_per_user_map.insert(user_id, Arc::new(AtomicI64::new(0)));
  }

  Json(LoginResponse {
    encrypted_master_key: Some(general_purpose::STANDARD.encode(user_data.encrypted_master_key)),
    encrypted_ed25519_private_key: Some(general_purpose::STANDARD.encode(user_data.encrypted_ed25519_private_key)),
    encrypted_x25519_private_key: Some(general_purpose::STANDARD.encode(user_data.encrypted_x25519_private_key)),
    requires_two_factor_code: false
  }).into_response()
}

// ----------------------------------------------
// API - Log out
// ----------------------------------------------

pub async fn logout_api(
  session: Session,
  State(_state): State<Arc<AppState>>
) -> impl IntoResponse {
  // If there's no session id, then return early.
  if session.id().is_none() {
    return StatusCode::OK.into_response();
  }

  if let Err(err) = session.delete().await {
    error!("Logout API error: {}", err);
    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
  }

  StatusCode::OK.into_response()
}

// ----------------------------------------------
// API - Enable two factor authentication
// ----------------------------------------------

#[derive(Deserialize)]
pub struct EnableTwoFactorAuthRequest {
  #[serde(rename = "authKey")]
  auth_key: String
}

impl EnableTwoFactorAuthRequest {
  pub fn validate(&self) -> Result<(), Box<dyn Error>> {
    validate_base64_byte_size!(self, auth_key, constants::AUTH_KEY_SIZE);
    
    Ok(())
  }
}

#[debug_handler]
pub async fn enable_two_factor_auth_api(
  session: Session,
  State(state): State<Arc<AppState>>,
  Json(req): Json<EnableTwoFactorAuthRequest>
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  // Validate request
  if let Err(err) = req.validate() {
    return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
  }

  // Get user data from username
  let mut database_guard = state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  let user_data = database
    .get_user_data(&session_data.username)
    .expect("User is already logged in but couldn't get their user data from database!");

  drop(database_guard);

  // Verify auth key
  if !verify_auth_key_with_hash(&req.auth_key, &user_data.auth_key_hash) {
    return StatusCode::UNAUTHORIZED.into_response();
  }

  // Generate new TOTP secret
  let mut totp_secret = [0 as u8; constants::TOTP_SECRET_SIZE];
  thread_rng().fill_bytes(&mut totp_secret);
  let totp_secret = totp_secret.to_vec();

  // Update database
  let mut database_guard = state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  match database.set_user_totp_secret(session_data.user_id, Some(totp_secret.clone())) {
    Ok(data) => data,
    Err(err) => {
      error!("rusqlite error: {}", err);
      return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
  };

  drop(database_guard);

  // Get url and return it
  let mut rfc = Rfc6238::with_defaults(totp_secret).unwrap();
  rfc.digits(constants::TOTP_DIGIT_COUNT).unwrap();
  rfc.issuer(constants::TOTP_ISSUER.to_string());
  rfc.account_name(session_data.username);

  let totp = TOTP::from_rfc6238(rfc).unwrap();
  let url = totp.get_url();

  (StatusCode::OK, url).into_response()
}

// ----------------------------------------------
// API - Disable TOTP two factor authentication
// ----------------------------------------------

#[derive(Deserialize)]
pub struct DisableTwoFactorAuthRequest {
  #[serde(rename = "authKey")]
  auth_key: String
}

impl DisableTwoFactorAuthRequest {
  pub fn validate(&self) -> Result<(), Box<dyn Error>> {
    validate_base64_byte_size!(self, auth_key, constants::AUTH_KEY_SIZE);
    
    Ok(())
  }
}

pub async fn disable_two_factor_auth_api(
  session: Session,
  State(state): State<Arc<AppState>>,
  Json(req): Json<DisableTwoFactorAuthRequest>
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  // Validate request
  if let Err(err) = req.validate() {
    return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
  }

  // Get user data from username
  let mut database_guard = state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  let user_data = database
    .get_user_data(&session_data.username)
    .expect("User is already logged in but couldn't get their user data from database!");

  drop(database_guard);

  // Verify auth key
  if !verify_auth_key_with_hash(&req.auth_key, &user_data.auth_key_hash) {
    return StatusCode::UNAUTHORIZED.into_response();
  }

  // Set user's TOTP secret to null
  let mut database_guard = state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  match database.set_user_totp_secret(session_data.user_id, None) {
    Ok(data) => data,
    Err(err) => {
      error!("rusqlite error: {}", err);
      return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
  };

  StatusCode::OK.into_response()
}

// ----------------------------------------------
// API - Get two factor authentication otpauth url
// ----------------------------------------------

#[derive(Serialize)]
pub struct GetTwoFactorAuthUrlResponse {
  url: String,
  secret: String
}

pub async fn get_two_factor_auth_url_api(
  session: Session,
  State(state): State<Arc<AppState>>
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  // Get user data
  let mut database_guard = state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  let user_data = database
    .get_user_data(&session_data.username)
    .expect("User is already logged in but couldn't get their user data from database!");

  drop(database_guard);

  // Return empty if user has not setup two factor authentication
  if user_data.totp_secret.is_none() {
    return Json(GetTwoFactorAuthUrlResponse {
      url: "".to_string(),
      secret: "".to_string()
    }).into_response()
  }

  // Get url
  let mut rfc = Rfc6238::with_defaults(user_data.totp_secret.unwrap()).unwrap();
  rfc.digits(constants::TOTP_DIGIT_COUNT).unwrap();
  rfc.issuer(constants::TOTP_ISSUER.to_string());
  rfc.account_name(session_data.username.clone());

  let totp = TOTP::from_rfc6238(rfc).unwrap();

  Json(GetTwoFactorAuthUrlResponse {
    url: totp.get_url(),
    secret: totp.get_secret_base32()
  }).into_response()
}
