use axum::{
	extract::{Multipart, State}, response::IntoResponse, Json
};

use tokio::sync::Mutex;
use http::StatusCode;
use std::sync::Arc;
use std::error::Error;
use tower_sessions::Session;
use serde::{Serialize, Deserialize};
use log::error;
use base64::{engine::general_purpose, Engine as _};

use crate::{
	api::{
		auth::get_user_session_data, multipart::*
	}, constants, database::UserFileEntry, AppState
};

use crate::util::generate_file_handle;

use crate::{
	get_session_data_or_return_unauthorized,
	validate_base64_byte_size,
	validate_base64_max_byte_size,
	validate_integer_max_value,
	validate_string_is_ascii_alphanumeric,
	validate_string_length,
	validate_vector_length_range,
	validate_integer_is_positive
};

use crate::{
	read_next_multipart_data_as_bytes_or_bad_request,
	read_next_multipart_data_as_i64_or_bad_request,
	read_next_multipart_data_as_string_or_bad_request
};

// ----------------------------------------------
// API - Start upload
// ----------------------------------------------

#[derive(Deserialize)]
pub struct StartUploadRequest {
	#[serde(rename = "fileSize")]
	file_size: u64
}

#[derive(Serialize)]
pub struct StartUploadResponse {
	handle: String
}

impl StartUploadRequest {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		validate_integer_max_value!(self, file_size, constants::MAX_FILE_SIZE);

		Ok(())
	}
}

pub async fn start_upload_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	Json(req): Json<StartUploadRequest>
) -> impl IntoResponse {
	let session_data = get_session_data_or_return_unauthorized!(session);

	// Validate
	if let Err(err) = req.validate() {
		return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
	}
	
	// Acquire app state
	let mut app_state = state.lock().await;
	let handle = generate_file_handle();

	match app_state.uploads_manager.new_upload(session_data.user_id, &handle, req.file_size).await {
		Ok(_) => Json(StartUploadResponse { handle }).into_response(),
		Err(err) => {
			error!("Failed to create new upload. Error: {}", err);
			StatusCode::INTERNAL_SERVER_ERROR.into_response()
		}
	}
}

// ----------------------------------------------
// API - Finalise upload
// ----------------------------------------------

#[derive(Deserialize)]
pub struct FinaliseUploadPathParams {
	handle: String
}

impl FinaliseUploadPathParams {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		validate_string_is_ascii_alphanumeric!(self, handle);
		validate_string_length!(self, handle, constants::FILE_HANDLE_LENGTH);

		Ok(())
	}
}

#[derive(Deserialize)]
pub struct FinaliseUploadRequest {
	#[serde(rename = "parentHandle")]
	parent_handle: String,

	#[serde(rename = "encryptedMetadata")]
	encrypted_metadata: String, // Base64 string

	#[serde(rename = "encryptedFileCryptKey")]
	encrypted_file_crypt_key: String, // Base64 string

	signature: String // Base64 string
}

impl FinaliseUploadRequest {
	pub fn validate(&self) -> Result<(), Box<dyn Error>> {
		validate_string_is_ascii_alphanumeric!(self, parent_handle);
		validate_string_length!(self, parent_handle, constants::FILE_HANDLE_LENGTH);
		validate_base64_max_byte_size!(self, encrypted_metadata, constants::ENCRYPTED_FILE_METADATA_MAX_SIZE);
		validate_base64_byte_size!(self, encrypted_file_crypt_key, constants::ENCRYPTED_FILE_CRYPT_KEY_SIZE);
		validate_base64_byte_size!(self, signature, constants::ED25519_SIGNATURE_SIZE);

		Ok(())
	}
}

pub async fn finalise_upload_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	axum::extract::Path(path_params): axum::extract::Path<FinaliseUploadPathParams>,
	Json(req): Json<FinaliseUploadRequest>
) -> impl IntoResponse {
	let session_data = get_session_data_or_return_unauthorized!(session);

	// Validate
	if let Err(err) = path_params.validate() {
		return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
	}

	if let Err(err) = req.validate() {
		return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
	}
	
	// Acquire app state and database
	let mut app_state = state.lock().await;

	// Get upload
	let active_upload = match app_state.uploads_manager.get_active_upload(&path_params.handle).await {
		Some(upload) => upload,
		None => return StatusCode::NOT_FOUND.into_response()
	};

	let upload_size = active_upload.file_size;

	// Finalise the upload
	match app_state.uploads_manager.finalise_upload(&path_params.handle).await {
		Ok(_) => (),
		Err(err) => {
			error!("Finalise upload error: {}", err);

			// Respond with 500 even though it could be a genuinely bad request from the client. However
			// it's more likely that the server has an issue in most situations so 500 is used.
			return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response();
		}
	};

	// Insert new file entry into the database
	let encrypted_crypt_key = general_purpose::STANDARD.decode(req.encrypted_file_crypt_key).unwrap();
	let encrypted_metadata = general_purpose::STANDARD.decode(req.encrypted_metadata).unwrap();
	let signature = general_purpose::STANDARD.decode(req.signature).unwrap();

	let new_file = UserFileEntry {
		owner_id: session_data.user_id,
		handle: path_params.handle.clone(),
		parent_handle: req.parent_handle,
		size: upload_size,
		encrypted_crypt_key: Some(encrypted_crypt_key),
		encrypted_metadata,
		signature: Some(signature)
	};

	let database = app_state.database.as_mut().unwrap();

	let _ = database.insert_new_user_file(&new_file)
		.map_err(|err| {
			error!("rusqlite error: {}", err);
			return StatusCode::INTERNAL_SERVER_ERROR.into_response();
		});

	StatusCode::OK.into_response()
}

// ----------------------------------------------
// API - Upload chunk
// ----------------------------------------------

pub async fn upload_chunk_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	mut multipart: Multipart
) -> impl IntoResponse {
	let _ = get_session_data_or_return_unauthorized!(session);

	// Read multipart data
	let handle = read_next_multipart_data_as_string_or_bad_request!(multipart, "handle");
	let chunk_id = read_next_multipart_data_as_i64_or_bad_request!(multipart, "chunkId");
	let data = read_next_multipart_data_as_bytes_or_bad_request!(multipart, "data");
	
	// Validate
	let validate = || -> Result<(), Box<dyn Error>> {
		validate_string_length!(handle, constants::FILE_HANDLE_LENGTH);
		validate_integer_is_positive!(chunk_id);
		validate_vector_length_range!(data, constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE, constants::ENCRYPTED_CHUNK_SIZE);

		Ok(())
	};

	if let Err(err) = validate() {
		return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
	}

	// Acquire app state
	let mut app_state = state.lock().await;

	// Get active upload by the handle
	let active_upload = match app_state.uploads_manager.get_active_upload(&handle).await {
		Some(upload) => upload,

		// Return bad request if no active upload was found because that means the handle is invalid.
		None => return (StatusCode::BAD_REQUEST, "Handle is invalid").into_response()
	};

	// Ensure chunk id is not a duplicate
	if active_upload.buffered_chunks.contains_key(&chunk_id) {
		return (StatusCode::BAD_REQUEST, "Provided chunk id is a duplicate").into_response();
	}

	// Ensure chunk id is not less than or equal to the previously written chunk id
	if chunk_id <= active_upload.prev_written_chunk_id {
		return (
			StatusCode::BAD_REQUEST,
			"Provided chunk id is less than or equal to the previous written chunk id."
		).into_response();
	}
	
	// Ensure not too many chunks are buffered
	if active_upload.buffered_chunks.len() >= constants::MAX_UPLOAD_CONCURRENT_CHUNKS {
		return (
			StatusCode::TOO_MANY_REQUESTS,
			"Reached the maximum amount of concurrent chunks"
		).into_response();
	}

	// Add chunk to buffer
	let _ = active_upload.try_write_chunk(chunk_id, data)
		.await
		.map_err(|err| {
			return (StatusCode::BAD_REQUEST, err.to_string()).into_response()
		});

	StatusCode::OK.into_response()
}

// TODO: possibly allow only a max number of buffered chunks per user for many uploads.
