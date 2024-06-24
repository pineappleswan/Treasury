use axum::{
	extract::State,
	response::IntoResponse,
	Json
};

use argon2::{
	password_hash::{
		PasswordHash, PasswordVerifier
	},
	Argon2
};

use base64::{engine::general_purpose, Engine as _};
use log::error;
use serde_json::json;

use std::sync::Arc;
use std::error::Error;
use http::StatusCode;
use serde::{Serialize, Deserialize};
use tower_sessions::Session;
use tokio::sync::Mutex;

use crate::{
  constants,
  api::auth::get_user_session_data,
  AppState,
  get_session_data_or_return_unauthorized,
  validate_base64_byte_size,
	validate_string_is_ascii_alphanumeric,
	validate_string_length_range
};

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
	State(_state): State<Arc<Mutex<AppState>>>
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
	auth_key: String
}

impl LoginRequest {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		validate_string_is_ascii_alphanumeric!(self, username);
		validate_string_length_range!(self, username, constants::MIN_USERNAME_LENGTH, constants::MAX_USERNAME_LENGTH);
		validate_base64_byte_size!(self, auth_key, constants::AUTH_KEY_SIZE);

		Ok(())
	}
}

#[derive(Serialize)]
pub struct LoginResponse {
	#[serde(rename = "encryptedMasterKey")]
	encrypted_master_key: String,
	
	#[serde(rename = "encryptedEd25519PrivateKey")]
	encrypted_ed25519_private_key: String,
	
	#[serde(rename = "encryptedX25519PrivateKey")]
	encrypted_x25519_private_key: String
}

pub async fn login_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	Json(req): Json<LoginRequest>
) -> impl IntoResponse {
	// Validate request
	if let Err(err) = req.validate() {
		return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
	}

	// Acquire database
	let mut app_state = state.lock().await;
	let database = app_state.database.as_mut().unwrap();

	// Get user data from username
	let user_data = match database.get_user_data(&req.username) {
		Ok(data) => data,
		Err(_) => return StatusCode::UNAUTHORIZED.into_response()
	};

	// Verify auth hash by decoding base64 string and verifying it with Argon2
	let auth_key_bytes = general_purpose::STANDARD.decode(req.auth_key).unwrap();
	let auth_key_hash = PasswordHash::new(user_data.auth_key_hash.as_str()).unwrap();
	let verified = Argon2::default().verify_password(auth_key_bytes.as_ref(), &auth_key_hash).is_ok();

	if !verified {
		return StatusCode::UNAUTHORIZED.into_response();
	}

	let user_id = user_data.user_id.unwrap();

	// Update user session to be logged in
	session.insert_value(constants::SESSION_USER_ID_KEY, json!(user_id)).await.unwrap();
	session.insert_value(constants::SESSION_USERNAME_KEY, json!(user_data.username)).await.unwrap();
	session.insert_value(constants::SESSION_STORAGE_QUOTA_KEY, json!(user_data.storage_quota)).await.unwrap();

	Json(LoginResponse {
		encrypted_master_key: general_purpose::STANDARD.encode(user_data.encrypted_master_key),
		encrypted_ed25519_private_key: general_purpose::STANDARD.encode(user_data.encrypted_ed25519_private_key),
		encrypted_x25519_private_key: general_purpose::STANDARD.encode(user_data.encrypted_x25519_private_key)
	}).into_response()
}

// ----------------------------------------------
// API - Log out
// ----------------------------------------------

pub async fn logout_api(
	session: Session,
	State(_state): State<Arc<Mutex<AppState>>>
) -> impl IntoResponse {
	if let Err(err) = session.delete().await {
		error!("Logout API error: {}", err);
		return StatusCode::INTERNAL_SERVER_ERROR.into_response();
	}

	StatusCode::OK.into_response()
}
