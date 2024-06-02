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
use base64::{engine::general_purpose, Engine as _};

use crate::AppState;
use crate::database;
use crate::constants;
use database::UserFileMetadata;

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

	#[serde(rename = "encryptedFileMetadata")]
	encrypted_file_metadata: String,

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
		return (StatusCode::UNAUTHORIZED).into_response();
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
			eprintln!("rusqlite error: {}", err);
			return (StatusCode::INTERNAL_SERVER_ERROR).into_response();
		}
	};

	let mut result = Vec::with_capacity(files.len());

	for file in files {
		result.push(GetFilesystemFileEntry {
			handle: file.handle,
			size: file.size,
			encrypted_file_crypt_key: general_purpose::STANDARD.encode(file.encrypted_crypt_key),
			encrypted_file_metadata: general_purpose::STANDARD.encode(file.encrypted_metadata),
			signature: general_purpose::STANDARD.encode(file.signature)
		});
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

impl CreateFolderRequest {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		if self.parent_handle.len() != constants::FILE_HANDLE_LENGTH {
			return Err(format!("Expected 'parent_handle' length to be {}", constants::FILE_HANDLE_LENGTH).into());
		}

		if !self.parent_handle.chars().all(|c: char| char::is_ascii_alphanumeric(&c)) {
			return Err(("Expected 'parent_handle' to be ASCII alphanumeric").into());
		}

		if self.encrypted_metadata.len() > constants::ENCRYPTED_FILE_METADATA_MAX_SIZE {
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
		return (StatusCode::UNAUTHORIZED).into_response();
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



	StatusCode::OK.into_response()
}
