use axum::{
	extract::State,
	body::Body,
	response::{IntoResponse, Response},
	Json
};
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
	api::auth::{GetUserSessionData, UserSessionData}, config::Config, constants, get_session_data_or_return_unauthorized, util::generate_file_handle, validate_base64_binary_size, validate_base64_max_binary_size, validate_integer_max_value, validate_string_length, validate_string_length_range, AppState
};

// ----------------------------------------------
// Active upload database
// ----------------------------------------------

pub struct ActiveUpload {
	file: File
}

pub struct ActiveUploadsDatabase {
	user_files_root_directory: PathBuf,
	active_uploads_map: HashMap<String, ActiveUpload>
}

impl ActiveUploadsDatabase {
	pub fn new(config: &Config) -> Self	{
		Self {
			user_files_root_directory: PathBuf::from(config.user_files_root_directory.clone()),
			active_uploads_map: HashMap::new()
		}
	}

	pub async fn new_upload(&mut self, handle: String) {
		let path = self.user_files_root_directory.join(handle).join(constants::TREASURY_FILE_EXTENSION);

		println!("Starting upload at: {}", path.as_os_str().to_str().unwrap());

		/*
		let file = File::open();

		let upload = ActiveUpload {
			file:
		};

		match self.active_uploads_map.insert() {

		}
		*/
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
	
	// Acquire database
	let mut app_state = state.lock().await;
	let database = app_state.database.as_mut().unwrap();

	let handle = generate_file_handle();

	app_state.active_uploads.new_upload(handle).await;

	// TODO:
	StatusCode::OK.into_response()
}
