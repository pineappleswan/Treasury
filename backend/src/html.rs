use axum::response::{Html, IntoResponse};
use lazy_static::lazy_static;
use log::debug;
use tokio::sync::RwLock;
use crate::constants;

lazy_static! {
  static ref INDEX_HTML: RwLock<Option<String>> = RwLock::new(None);
}

pub async fn index_html_route() -> impl IntoResponse {
  let content = {
    let guard = INDEX_HTML.read().await;
    guard.clone()
  };
  
  // If index.html wasn't loaded already, then load it.
  if content.is_none() {
    let html = std::fs::read_to_string(constants::INDEX_HTML_PATH).unwrap();
    *INDEX_HTML.write().await = Some(html);

    debug!("Loaded and cached index.html");
  }

  let html = INDEX_HTML.read().await.as_ref().unwrap().clone();

  Html(html)
}
