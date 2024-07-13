use axum::response::IntoResponse;
use http::StatusCode;

pub async fn is_admin_server_api() -> impl IntoResponse {
  StatusCode::OK.into_response()
}
