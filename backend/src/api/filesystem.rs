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
use std::error::Error;
use log::error;
use base64::{engine::general_purpose, Engine as _};

use crate::{
	util::{
		validate_base64_string_max_length,
		generate_file_handle
	},
	AppState
};

use crate::database;
use crate::constants;
use database::UserFileEntry;

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
				error!("rusqlite error: {}", err);
				StatusCode::INTERNAL_SERVER_ERROR.into_response()
			}
		}
	} else {
		StatusCode::UNAUTHORIZED.into_response()
	}
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GetFilesystemRequest {
	handle: String
}

impl GetFilesystemRequest {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		if self.handle.len() != constants::FILE_HANDLE_LENGTH {
			return Err(format!("Expected 'handle' length to be {}", constants::FILE_HANDLE_LENGTH).into());
		}

		if !self.handle.chars().all(|c: char| char::is_ascii_alphanumeric(&c)) {
			return Err(("Expected 'handle' to be ASCII alphanumeric").into());
		}

		Ok(())
	}
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GetFilesystemFileEntry {
	handle: String,
	size: u64,

	#[serde(rename = "encryptedFileCryptKey")]
	encrypted_file_crypt_key: String,

	#[serde(rename = "encryptedMetadata")]
	encrypted_metadata: String,

	signature: String
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GetFilesystemResponse {
	data: Vec<GetFilesystemFileEntry>
}

pub async fn get_filesystem_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	Json(req): Json<GetFilesystemRequest>
) -> impl IntoResponse {
	// Get user id
	let user_id_option = session.get::<u64>(constants::SESSION_USER_ID_KEY).await.unwrap();

	if user_id_option.is_none() {
		return StatusCode::UNAUTHORIZED.into_response();
	}

	let user_id = user_id_option.unwrap();

	// Validate
	if let Err(err) = req.validate() {
		return
			Response::builder()
				.status(StatusCode::BAD_REQUEST)
				.body(Body::from(err.to_string()))
				.unwrap();
	}
	
	// Acquire database
	let mut app_state = state.lock().await;
	let database = app_state.database.as_mut().unwrap();

	let files = match database.get_files_under_handle(user_id, &req.handle) {
		Ok(data) => data,
		Err(err) => {
			error!("rusqlite error: {}", err);
			return StatusCode::INTERNAL_SERVER_ERROR.into_response();
		}
	};

	let mut result = Vec::with_capacity(files.len());

	for file in files {
		let mut entry = GetFilesystemFileEntry {
			handle: file.handle,
			size: file.size,
			encrypted_metadata: general_purpose::STANDARD.encode(file.encrypted_metadata),

			// Optional values
			encrypted_file_crypt_key: String::new(),
			signature: String::new()
		};

		// TODO: rename to encrypted_crypt_key so less verbose

		// Process optional values
		if let Some(value) = file.encrypted_crypt_key {
			entry.encrypted_file_crypt_key = general_purpose::STANDARD.encode(value);
		};

		if let Some(value) = file.signature {
			entry.signature = general_purpose::STANDARD.encode(value);
		};

		result.push(entry);
	}

	Json(GetFilesystemResponse { data: result }).into_response()
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateFolderRequest {
	#[serde(rename = "encryptedMetadata")]
	encrypted_metadata: String, // Base64 encoded

	#[serde(rename = "parentHandle")]
	parent_handle: String
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateFolderResponse {
	handle: String
}

impl CreateFolderRequest {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		if self.parent_handle.len() != constants::FILE_HANDLE_LENGTH {
			return Err(format!("Expected 'parent_handle' length to be {}", constants::FILE_HANDLE_LENGTH).into());
		}

		if !self.parent_handle.chars().all(|c: char| char::is_ascii_alphanumeric(&c)) {
			return Err(("Expected 'parent_handle' to be ASCII alphanumeric").into());
		}

		if validate_base64_string_max_length(&self.encrypted_metadata, constants::ENCRYPTED_FILE_METADATA_MAX_SIZE).is_err() {
			return Err(("encrypted_metadata is too big!").into());
		}

		Ok(())
	}
}

pub async fn create_folder_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	Json(req): Json<CreateFolderRequest>
) -> impl IntoResponse {
	// Get user id
	let user_id_option = session.get::<u64>(constants::SESSION_USER_ID_KEY).await.unwrap();

	if user_id_option.is_none() {
		return StatusCode::UNAUTHORIZED.into_response();
	}

	let user_id = user_id_option.unwrap();

	// Validate
	if let Err(err) = req.validate() {
		return
			Response::builder()
				.status(StatusCode::BAD_REQUEST)
				.body(Body::from(err.to_string()))
				.unwrap();
	}
	
	// Acquire database
	let mut app_state = state.lock().await;
	let database = app_state.database.as_mut().unwrap();

	// Create user file entry for the folter
	let entry = UserFileEntry {
		owner_id: user_id,
		handle: generate_file_handle(),
		parent_handle: req.parent_handle,
		size: 0,
		encrypted_crypt_key: None,
		encrypted_metadata: general_purpose::STANDARD.decode(req.encrypted_metadata).unwrap(),
		signature: None
	};

	match database.insert_new_user_file(&entry) {
		Ok(_) => {
			return Json(CreateFolderResponse { handle: entry.handle }).into_response();
		},
		Err(err) => {
			error!("rusqlite error: {}", err);
			return StatusCode::INTERNAL_SERVER_ERROR.into_response();
		}
	}
}
