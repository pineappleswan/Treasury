use axum::{
	body::Body, extract::{Multipart, State}, response::{IntoResponse, Response}, Json
};

use std::collections::BTreeMap;
use blake3::Hash;
use std::path::PathBuf;
use tokio::fs::File;
use tokio::sync::Mutex;
use http::StatusCode;
use std::sync::Arc;
use std::collections::HashMap;
use std::error::Error;
use tower_sessions::Session;
use serde::{Serialize, Deserialize};
use log::error;
use base64::{engine::general_purpose, Engine as _};

use crate::{
	api::auth::{
		UserSessionData,
		get_user_session_data
	},
	api::util::{
		read_next_multipart_data_as_string,
		read_next_multipart_data_as_i64,
		read_next_multipart_data_as_bytes
	},
	config::Config,
	constants,
	AppState,
	util::generate_file_handle,
	read_next_multipart_data_as_string_or_bad_request,
	read_next_multipart_data_as_i64_or_bad_request,
	read_next_multipart_data_as_bytes_or_bad_request,
	get_session_data_or_return_unauthorized,
	validate_base64_binary_size,
	validate_base64_max_binary_size,
	validate_integer_max_value,
	validate_string_length,
	validate_string_length_range,
};

// ----------------------------------------------
// Active upload database
// ----------------------------------------------

pub struct BufferedChunk {
	pub id: usize,
	pub data: Vec<u8>
}

pub struct ActiveUpload {
	pub user_id: u64,
	pub file: File,
	pub buffered_chunks: BTreeMap<usize, BufferedChunk>
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

	pub async fn new_upload(&mut self, user_id: u64, handle: String) -> Result<(), Box<dyn Error>> {
		let file_name = format!("{}{}", handle, constants::TREASURY_FILE_EXTENSION);
		let path = self.user_upload_directory.join(file_name);

		println!("Starting upload at: {}", path.as_os_str().to_str().unwrap());

		let file = File::create(path).await?;

		let upload = ActiveUpload {
			user_id: user_id,
			file: file,
			buffered_chunks: BTreeMap::new()
		};

		self.active_uploads_map.insert(handle, upload);

		Ok(())
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
		return
			Response::builder()
				.status(StatusCode::BAD_REQUEST)
				.body(Body::from(err.to_string()))
				.unwrap();
	}
	
	// Acquire app state
	let mut app_state = state.lock().await;
	let handle = generate_file_handle();

	match app_state.active_uploads.new_upload(session_data.user_id, handle.clone()).await {
		Ok(_) => Json(StartUploadResponse { handle: handle }).into_response(),
		Err(err) => {
			error!("Failed to create new upload. Error: {}", err);
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

	// Read multipart data
	let handle = read_next_multipart_data_as_string_or_bad_request!(multipart, "handle");
	let chunk_id = read_next_multipart_data_as_i64_or_bad_request!(multipart, "chunkId");
	let data = read_next_multipart_data_as_bytes_or_bad_request!(multipart, "data");
	
	// println!("Handle: {} Chunk id: {} Data size: {}", handle, chunk_id, data.len());

	// Validate (TODO: FINISH THIS)
	let result = move || -> Result<(), Box<dyn Error>> {
		validate_string_length!(handle, constants::FILE_HANDLE_LENGTH);

		Ok(())
	};

	if let Err(err) = result() {
		return
			Response::builder()
				.status(StatusCode::BAD_REQUEST)
				.body(Body::from(err.to_string()))
				.unwrap();
	}

	StatusCode::OK.into_response()
}
