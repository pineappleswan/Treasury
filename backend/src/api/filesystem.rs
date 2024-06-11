use axum::{
	body::Body, extract::{Query, State}, response::{IntoResponse, Response}, Json
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
	get_session_data_or_return_unauthorized,
	validate_base64_max_binary_size,
	validate_string_is_ascii_alphanumeric,
	validate_string_length,
	AppState,
	api::auth::get_user_session_data,
	util::generate_file_handle,
	database,
	database::UserFileEntry,
	constants
};

// ----------------------------------------------
// API - Get usage
// ----------------------------------------------

#[derive(Serialize, Deserialize, Debug)]
pub struct GetUsageResponse {
	#[serde(rename = "bytesUsed")]
	bytes_used: u64
}

pub async fn get_usage_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>
) -> impl IntoResponse {
	let session_data = get_session_data_or_return_unauthorized!(session);

	// Acquire database
	let mut app_state = state.lock().await;
	let database = app_state.database.as_mut().unwrap();

	match database.get_user_storage_used(session_data.user_id) {
		Ok(bytes_used) => {
			Json(GetUsageResponse { bytes_used }).into_response()
		},
		Err(err) => {
			error!("rusqlite error: {}", err);
			StatusCode::INTERNAL_SERVER_ERROR.into_response()
		}
	}
}

// ----------------------------------------------
// API - Get items
// ----------------------------------------------

#[derive(Serialize, Deserialize, Debug)]
pub struct GetItemsParams {
	#[serde(rename = "parentHandle")]
	parent_handle: String
}

impl GetItemsParams {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		validate_string_is_ascii_alphanumeric!(self, parent_handle);
		validate_string_length!(self, parent_handle, constants::FILE_HANDLE_LENGTH);

		Ok(())
	}
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FilesystemItem {
	handle: String,
	size: u64,

	#[serde(rename = "encryptedFileCryptKey")]
	encrypted_file_crypt_key: String,

	#[serde(rename = "encryptedMetadata")]
	encrypted_metadata: String,

	signature: String
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GetItemsResponse {
	data: Vec<FilesystemItem>
}

pub async fn get_items_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	Query(params): Query<GetItemsParams>
) -> impl IntoResponse {
	let session_data = get_session_data_or_return_unauthorized!(session);

	// Validate
	if let Err(err) = params.validate() {
		return
			Response::builder()
				.status(StatusCode::BAD_REQUEST)
				.body(Body::from(err.to_string()))
				.unwrap();
	}
	
	// Acquire database
	let mut app_state = state.lock().await;
	let database = app_state.database.as_mut().unwrap();

	let files = match database.get_files_under_handle(session_data.user_id, &params.parent_handle) {
		Ok(data) => data,
		Err(err) => {
			error!("rusqlite error: {}", err);
			return StatusCode::INTERNAL_SERVER_ERROR.into_response();
		}
	};

	let mut result = Vec::with_capacity(files.len());

	for file in files {
		let mut entry = FilesystemItem {
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

	Json(GetItemsResponse { data: result }).into_response()
}

// ----------------------------------------------
// API - Post folders
// ----------------------------------------------

#[derive(Serialize, Deserialize, Debug)]
pub struct PostFolderRequest {
	#[serde(rename = "parentHandle")]
	parent_handle: String,

	#[serde(rename = "encryptedMetadata")]
	encrypted_metadata: String // Base64 encoded
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PostFolderResponse {
	handle: String
}

impl PostFolderRequest {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		validate_string_is_ascii_alphanumeric!(self, parent_handle);
		validate_string_length!(self, parent_handle, constants::FILE_HANDLE_LENGTH);
		validate_base64_max_binary_size!(self, encrypted_metadata, constants::ENCRYPTED_FILE_METADATA_MAX_SIZE);

		Ok(())
	}
}

pub async fn post_folders_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	Json(req): Json<PostFolderRequest>
) -> impl IntoResponse {
	let session_data = get_session_data_or_return_unauthorized!(session);

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
		owner_id: session_data.user_id,
		handle: generate_file_handle(),
		parent_handle: req.parent_handle,
		size: 0,
		encrypted_crypt_key: None,
		encrypted_metadata: general_purpose::STANDARD.decode(req.encrypted_metadata).unwrap(),
		signature: None
	};

	match database.insert_new_user_file(&entry) {
		Ok(_) => Json(PostFolderResponse { handle: entry.handle }).into_response(),
		Err(err) => {
			error!("rusqlite error: {}", err);
			StatusCode::INTERNAL_SERVER_ERROR.into_response()
		}
	}
}

// ----------------------------------------------
// API - Put metadata
// ----------------------------------------------

#[derive(Serialize, Deserialize, Debug)]
pub struct PutMetadataRequest {
	handle: String,

	#[serde(rename = "encryptedMetadata")]
	encrypted_metadata: String, // Base64 encoded
}

impl PutMetadataRequest {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		validate_string_length!(self, handle, constants::FILE_HANDLE_LENGTH);
		validate_base64_max_binary_size!(self, encrypted_metadata, constants::ENCRYPTED_FILE_METADATA_MAX_SIZE);

		Ok(())
	}
}

pub async fn put_metadata_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	Json(req): Json<Vec<PutMetadataRequest>>
) -> impl IntoResponse {
	let session_data = get_session_data_or_return_unauthorized!(session);

	// Validate
	for entry in req.iter() {
		if let Err(err) = entry.validate() {
			return
				Response::builder()
					.status(StatusCode::BAD_REQUEST)
					.body(Body::from(err.to_string()))
					.unwrap();
		}
	}
	
	// Acquire database
	let mut app_state = state.lock().await;
	let database = app_state.database.as_mut().unwrap();

	// Create requests for the database
	let mut requests: Vec<database::EditFileMetadataRequest> = Vec::with_capacity(req.len());

	for entry in req.iter() {
		requests.push(database::EditFileMetadataRequest {
			handle: entry.handle.clone(),
			metadata: general_purpose::STANDARD.decode(entry.encrypted_metadata.clone()).unwrap()
		});
	}

	match database.edit_file_metadata_multiple(session_data.user_id, &requests) {
		Ok(_) => StatusCode::OK.into_response(),
		Err(err) => {
			error!("rusqlite error: {}", err);
			StatusCode::INTERNAL_SERVER_ERROR.into_response()
		}
	}
}
