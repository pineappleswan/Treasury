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
use std::sync::Arc;
use http::StatusCode;
use serde::{Serialize, Deserialize};
use tower_sessions::Session;
use tokio::sync::Mutex;

#[path = "../constants.rs"] mod constants;
#[path = "../util.rs"] mod util;
use util::{validate_base64_string};

use crate::{database::{ClaimUserRequest, UserData}, AppState};

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

  if let Ok(info) = database.get_claim_code_info(&req.claim_code) {
    Json(CheckClaimCodeResponse {
      is_valid: true,
      storage_quota: info.storage_quota
    })
  } else {
    Json(CheckClaimCodeResponse { is_valid: false, storage_quota: 0 })
  }
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
      return Err("Incorrect claim code length.".into());
    }

    // username
    if self.username.len() < constants::MIN_USERNAME_LENGTH {
      return Err("Username is too short.".into());
    }

    if self.username.len() > constants::MAX_USERNAME_LENGTH {
      return Err("Username is too long.".into());
    }

    if !self.username.chars().all(|c: char| char::is_ascii_alphanumeric(&c)) {
      return Err("Username is not alphanumeric.".into());
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
  let claim_user_data = UserData {
    username: req.username,
    auth_key_hash: auth_key_hash,
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

  // Acquire database
  let mut app_state = state.lock().await;
  let database = app_state.database.as_mut().unwrap();

  match database.claim_user(&claim_request) {
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

#[derive(Serialize, Deserialize, Debug)]
pub struct LoginRequest {
  username: String,

  #[serde(rename = "authKey")]
  auth_key: String
}

#[derive(Serialize, Deserialize, Debug)]
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
  println!("Username: {} Auth: {}", req.username, req.auth_key);

  // Acquire database
  let mut app_state = state.lock().await;
  let database = app_state.database.as_mut().unwrap();

  // Get user data from username
  let user_data = match database.get_user_data(&req.username) {
    Ok(data) => data,
    Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR).into_response()
  };

  // Validate auth key
  if let Err(_) = validate_base64_string(&req.auth_key, constants::AUTH_KEY_SIZE) {
    return (StatusCode::BAD_REQUEST, "authKey invalid format.").into_response();
  }

  // Verify auth hash
  let auth_key_bytes = general_purpose::STANDARD.decode(req.auth_key).unwrap();
  let auth_key_hash = PasswordHash::new(user_data.auth_key_hash.as_str()).unwrap();
  let verified = Argon2::default().verify_password(auth_key_bytes.as_ref(), &auth_key_hash).is_ok();

  if !verified {
    return (StatusCode::UNAUTHORIZED).into_response();
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

pub async fn logout_api(
  session: Session,
  State(state): State<Arc<Mutex<AppState>>>
) -> impl IntoResponse {
  println!("logout");

  session.remove_value(constants::SESSION_USER_ID_KEY).await.unwrap();
  session.remove_value(constants::SESSION_USERNAME_KEY).await.unwrap();
  session.remove_value(constants::SESSION_STORAGE_QUOTA_KEY).await.unwrap();

  Response::builder()
    .status(StatusCode::OK)
    .body(Body::empty())
    .unwrap()
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GetUserSaltRequest {
  username: String
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GetUserSaltResponse {
  salt: String // Base64 encoded
}

pub async fn get_user_salt_api(
  session: Session,
  State(state): State<Arc<Mutex<AppState>>>,
  Json(req): Json<GetUserSaltRequest>
) -> impl IntoResponse {
  // Acquire database
  let mut app_state = state.lock().await;
  let database = app_state.database.as_mut().unwrap();

  match database.get_user_data(&req.username) {
    Ok(user_data) => {
      let salt_b64 = general_purpose::STANDARD.encode(user_data.salt);

      Json(GetUserSaltResponse { salt: salt_b64 }).into_response()
    },
    Err(err) => {
      // Generate a non-random hash of the username to act as the salt so that existing usernames can't
      // be easily revealed.
      let mut hasher = blake3::Hasher::new();
      
      // Add the username to the hasher.
      hasher.update(req.username.as_bytes());

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

#[derive(Serialize, Deserialize, Debug)]
pub struct GetSessionInfoResponse {
  #[serde(rename = "userId")]
  user_id: u64,

  username: String,

  #[serde(rename = "storageQuota")]
  storage_quota: u64
}

pub async fn get_session_info_api(
  session: Session,
  State(state): State<Arc<Mutex<AppState>>>
) -> impl IntoResponse {
  let user_id_option = session.get::<u64>(constants::SESSION_USER_ID_KEY).await.unwrap();

  if let Some(user_id) = user_id_option {
    // If the user id is available, all the other values are as well
    let username = session.get::<String>(constants::SESSION_USERNAME_KEY).await.unwrap().unwrap();
    let storage_quota = session.get::<u64>(constants::SESSION_STORAGE_QUOTA_KEY).await.unwrap().unwrap();

    Json(GetSessionInfoResponse {
      user_id: user_id,
      username: username,
      storage_quota: storage_quota
    }).into_response()
  } else {
    (StatusCode::UNAUTHORIZED).into_response()
  }
}
