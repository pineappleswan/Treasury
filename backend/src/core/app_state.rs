use tokio::sync::Mutex;
use std::sync::Arc;
use crate::core::config::Config;
use crate::core::upload_manager::UploadManager;
use crate::core::download_manager::DownloadManager;
use crate::storage::database::Database;
use crate::storage::file_store::FileStoreManager;

pub struct AppState {
  pub config: Config,
  pub file_store: Arc<FileStoreManager>,
  pub database: Arc<Mutex<Option<Database>>>,
  pub uploads_manager: UploadManager,
  pub downloads_manager: DownloadManager
}
