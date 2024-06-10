use axum::{
	extract::State,
	response::IntoResponse,
	Json
};

use std::sync::Arc;
use http::StatusCode;
use serde::{Serialize, Deserialize};
use tower_sessions::Session;
use tokio::sync::Mutex;

use crate::{
	constants,
  AppState
};

// ----------------------------------------------
// API - Get session info
// ----------------------------------------------

#[derive(Serialize, Deserialize, Debug)]
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
		StatusCode::UNAUTHORIZED.into_response()
	}
}