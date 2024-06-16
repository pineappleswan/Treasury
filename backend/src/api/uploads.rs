use axum::{
	body::Body, extract::{Multipart, State, Path}, response::{IntoResponse, Response}, Json
};

use std::collections::BTreeMap;
use blake3::Hash;
use std::path::PathBuf;
use tokio::{fs::File, io::{AsyncReadExt, AsyncWriteExt, BufWriter}};
use tokio::sync::Mutex;
use http::{status, StatusCode};
use std::sync::Arc;
use std::collections::HashMap;
use std::error::Error;
use tower_sessions::Session;
use serde::{Serialize, Deserialize};
use log::error;
use std::cmp;
use base64::{engine::general_purpose, Engine as _};

use crate::{
	api::{
		auth::{get_user_session_data, UserSessionData}, 
		multipart::*, formats::calc_raw_chunk_size
	}, config::Config, constants, AppState
};

use crate::util::{
	generate_claim_code,
	generate_file_handle
};

use crate::{
	get_session_data_or_return_unauthorized,
	validate_base64_byte_size,
	validate_base64_max_byte_size,
	validate_integer_max_value,
	validate_integer_range,
	validate_string_is_ascii_alphanumeric,
	validate_string_length,
	validate_string_length_range,
	validate_vector_length_range,
	validate_integer_is_positive
};

use crate::{
	read_next_multipart_data_as_bytes_or_bad_request,
	read_next_multipart_data_as_i64_or_bad_request,
	read_next_multipart_data_as_string_or_bad_request
};

use super::formats::calc_encrypted_file_size;

// ----------------------------------------------
// Active upload database
// ----------------------------------------------

pub struct ActiveUpload {
	pub user_id: u64,
	pub buf_writer: BufWriter<File>,

	/// The original unencrypted file size
	pub file_size: u64,

	/// The amount of bytes written to the file excluding file format overhead (inc. encryption overhead).
	pub written_bytes: u64,

	/// The previous written chunk's id which is used to ensure uploaded chunks are written in the correct order.
	pub prev_written_chunk_id: i64,
	pub buffered_chunks: BTreeMap<i64, Vec<u8>>
}

impl ActiveUpload {
	pub fn new(user_id: u64, file: File, file_size: u64) -> Self {
		Self {
			user_id: user_id,
			buf_writer: BufWriter::new(file),
			file_size: file_size,
			written_bytes: 0,
			prev_written_chunk_id: -1,
			buffered_chunks: BTreeMap::new()
		}
	}
}

pub struct ActiveUploadsDatabase {
	pub user_files_root_directory: PathBuf,
	pub user_upload_directory: PathBuf,
	pub active_uploads_map: HashMap<String, ActiveUpload>
}

impl ActiveUploadsDatabase {
	pub fn new(config: &Config) -> Self	{
		Self {
			user_files_root_directory: PathBuf::from(config.user_files_root_directory.clone()),
			user_upload_directory: PathBuf::from(config.user_upload_directory.clone()),
			active_uploads_map: HashMap::new()
		}
	}

	pub async fn new_upload(&mut self, user_id: u64, handle: String, file_size: u64) -> Result<(), Box<dyn Error>> {
		let file_name = format!("{}{}", handle, constants::TREASURY_FILE_EXTENSION);
		let path = self.user_upload_directory.join(file_name);

		println!("Starting upload at: {} with size: {}", path.as_os_str().to_str().unwrap(), file_size);

		let file = File::create(path).await?;
		let upload = ActiveUpload::new(user_id, file, file_size);

		self.active_uploads_map.insert(handle, upload);

		Ok(())
	}

	/// Removes the upload from the active uploads database and flushes all the written data to the disk.
	pub async fn finalise_upload(&mut self, handle: &String) -> Result<(), Box<dyn Error>> {
		if let Some(mut upload) = self.active_uploads_map.remove(handle) {
			upload.buf_writer.flush().await?;

			Ok(())
		} else {
			Err("No active upload with the provided handle was found.".into())
		}
	}

	pub async fn get_active_upload(&mut self, handle: &String) -> Option<&mut ActiveUpload> {
		self.active_uploads_map.get_mut(handle)
	}
}

// ----------------------------------------------
// API - Start upload
// ----------------------------------------------

#[derive(Serialize, Deserialize, Debug)]
pub struct StartUploadRequest {
	#[serde(rename = "fileSize")]
	file_size: u64
}

#[derive(Serialize, Deserialize, Debug)]
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
		return (StatusCode::BAD_REQUEST, Body::from(err.to_string())).into_response();
	}
	
	// Acquire app state
	let mut app_state = state.lock().await;
	let handle = generate_file_handle();

	// TODO: remove this
	let encrypted_file_size = calc_encrypted_file_size(req.file_size);
	println!("File size: {} Encrypted size: {} Increase: {}", req.file_size, encrypted_file_size, encrypted_file_size - req.file_size);

	match app_state.active_uploads.new_upload(session_data.user_id, handle.clone(), req.file_size).await {
		Ok(_) => Json(StartUploadResponse { handle: handle }).into_response(),
		Err(err) => {
			error!("Failed to create new upload. Error: {}", err);
			StatusCode::INTERNAL_SERVER_ERROR.into_response()
		}
	}
}

// ----------------------------------------------
// API - Finalise upload
// ----------------------------------------------

// TODO: remove all "Debug" serialisation because they aren't really needed, and can accidentally be logged
// TODO: also remove Serialize or Deseralize depending on whether it's a response or not?

#[derive(Serialize, Deserialize, Debug)]
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

#[derive(Serialize, Deserialize, Debug)]
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
	Path(path_params): Path<FinaliseUploadPathParams>,
	Json(req): Json<FinaliseUploadRequest>
) -> impl IntoResponse {
	let _ = get_session_data_or_return_unauthorized!(session);

	// Validate
	if let Err(err) = path_params.validate() {
		return (StatusCode::BAD_REQUEST, Body::from(err.to_string())).into_response();
	}

	if let Err(err) = req.validate() {
		return (StatusCode::BAD_REQUEST, Body::from(err.to_string())).into_response();
	}
	
	// Acquire app state
	let mut app_state = state.lock().await;

	// Get upload
	let active_upload = match app_state.active_uploads.get_active_upload(&path_params.handle).await {
		Some(upload) => upload,
		None => return StatusCode::NOT_FOUND.into_response()
	};

	// Ensure the correct number of bytes was written to the file
	if active_upload.written_bytes != active_upload.file_size {
		println!("Whoops. Bytes left to write: {}", active_upload.file_size as i64 - active_upload.written_bytes as i64);
	} else {
		println!("Finalised: {}", &path_params.handle);
	}

	match app_state.active_uploads.finalise_upload(&path_params.handle).await {
		Ok(_) => StatusCode::OK.into_response(),
		Err(err) => {
			error!("Finalise upload error: {}", err);
			StatusCode::INTERNAL_SERVER_ERROR.into_response()
		}
	}
}

// ----------------------------------------------
// API - Upload chunk
// ----------------------------------------------

pub async fn upload_chunk_api(
	session: Session,
	State(state): State<Arc<Mutex<AppState>>>,
	mut multipart: Multipart
) -> impl IntoResponse {
	let session_data = get_session_data_or_return_unauthorized!(session);

	// TODO: check if handle of upload request is actually cached! if not, then its not a valid upload and should reject!

	// Read multipart data
	let handle = read_next_multipart_data_as_string_or_bad_request!(multipart, "handle");
	let chunk_id = read_next_multipart_data_as_i64_or_bad_request!(multipart, "chunkId");
	let data = read_next_multipart_data_as_bytes_or_bad_request!(multipart, "data");
	
	println!("Upload chunk request: handle: {} chunk id: {} size: {}", handle, chunk_id, data.len());

	// Validate
	let result = || -> Result<(), Box<dyn Error>> {
		validate_string_length!(handle, constants::FILE_HANDLE_LENGTH);
		validate_integer_is_positive!(chunk_id);
		validate_vector_length_range!(data, constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE, constants::ENCRYPTED_CHUNK_SIZE);

		Ok(())
	};

	if let Err(err) = result() {
		return (StatusCode::BAD_REQUEST, Body::from(err.to_string())).into_response();
	}

	// Acquire app state
	let mut app_state = state.lock().await;

	// Check database for the active upload by the handle
	let active_upload = match app_state.active_uploads.get_active_upload(&handle).await {
		Some(upload) => upload,

		// Return bad request if no active upload was found. Therefore the handle is invalid.
		None => return (StatusCode::BAD_REQUEST, Body::from("handle is invalid")).into_response()
	};

	// TODO: cancel uploads function please

	// Ensure chunk id is not a duplicate
	if active_upload.buffered_chunks.contains_key(&chunk_id) {
		return (StatusCode::BAD_REQUEST, Body::from("provided chunk id is a duplicate")).into_response();
	}
	
	// Ensure not too many chunks are buffered
	if active_upload.buffered_chunks.len() >= constants::MAX_UPLOAD_CONCURRENT_CHUNKS {
		return (StatusCode::TOO_MANY_REQUESTS, Body::from("reached the maximum amount of concurrent chunks")).into_response();
	}

	// Add chunk to buffer
	active_upload.buffered_chunks.insert(chunk_id, data);

	// Try to write as many buffered chunks as possible
	let mut written_chunk_ids: Vec<i64> = Vec::with_capacity(constants::MAX_UPLOAD_CONCURRENT_CHUNKS);

	for (id, chunk) in active_upload.buffered_chunks.iter_mut() {
		let enc_chunk_size = chunk.len() as u64;
		let raw_chunk_size = calc_raw_chunk_size(enc_chunk_size);

		// Calculate the expected received chunk size
		let bytes_left_to_write = active_upload.file_size as i64 - active_upload.written_bytes as i64;

		let expected_enc_chunk_size = cmp::min(
			bytes_left_to_write + constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE as i64,
			constants::ENCRYPTED_CHUNK_SIZE as i64
		);

		println!("Writing id {} of raw size {}. Bytes left: {}.", id, raw_chunk_size, bytes_left_to_write);

		// Ensure chunk size meets expected encrypted chunk size
		if enc_chunk_size as i64 != expected_enc_chunk_size {
			println!("WRONG SIZE!");

			return (
				StatusCode::BAD_REQUEST,
				Body::from(format!("Expected encrypted chunk size {} but got {} instead.", expected_enc_chunk_size, enc_chunk_size))
			).into_response();
		}

		// Write chunk to disk when this chunk id is supposed to come next.
		if chunk_id - active_upload.prev_written_chunk_id != 1 {
			active_upload.prev_written_chunk_id = chunk_id;

			// TODO: cancel upload if error
			
			// Write data (TODO: fix write_all next to each other issue! you know.)
			if let Err(err) = active_upload.buf_writer.write_all(&constants::CHUNK_MAGIC_NUMBER).await {
				error!("Upload error: {}", err);
				return StatusCode::INTERNAL_SERVER_ERROR.into_response();
			}

			if let Err(err) = active_upload.buf_writer.write_all(&chunk).await {
				error!("Upload error: {}", err);
				return StatusCode::INTERNAL_SERVER_ERROR.into_response();
			}

			// Update
			active_upload.written_bytes += raw_chunk_size;
			written_chunk_ids.push(active_upload.prev_written_chunk_id);
		} else {
			println!("Out of order! Returning...");

			// Can't write buffered chunk which is okay, so return.
			return StatusCode::OK.into_response();
		}
	}

	// Remove written chunks from buffered chunks map
	for id in written_chunk_ids {
		active_upload.buffered_chunks.remove(&id);
	}

	StatusCode::OK.into_response()
}

// TODO: possibly allow only a max number of buffered chunks per user for many uploads.
