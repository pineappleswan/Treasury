use axum::response::{Html, IntoResponse};
use crate::constants;

pub async fn index_html_route() -> impl IntoResponse {
  let html = std::fs::read_to_string(constants::INDEX_HTML_PATH).unwrap();
  Html(html)
}
