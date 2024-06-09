use axum::{
	extract::State,
	body::Body,
	response::{IntoResponse, Response},
	Json
};

use tokio::sync::Mutex;
use http::StatusCode;
use std::sync::Arc;
use tower_sessions::Session;
use serde::{Serialize, Deserialize};
use std::error::Error;
use log::error;
use base64::{engine::general_purpose, Engine as _};
use crate::{
	AppState,
	constants,
	validate_string_length,
	validate_string_length_range,
	validate_base64_binary_size,
	validate_base64_max_binary_size,
	validate_integer_max_value
};

#[derive(Serialize, Deserialize, Debug)]
pub struct StartUploadRequest {
	#[serde(rename = "fileSize")]
	file_size: u64,
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

	// TODO:
	StatusCode::OK.into_response()
}
