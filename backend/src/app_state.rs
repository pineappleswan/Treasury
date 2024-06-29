use tokio::sync::Mutex;
use crate::config::Config;
use crate::database::Database;
use crate::api::utils::upload_utils::UploadsManager;
use crate::api::utils::download_utils::DownloadsManager;

pub struct AppState {
  pub config: Config,
  pub database: Mutex<Option<Database>>,
  pub uploads_manager: UploadsManager,
  pub downloads_manager: DownloadsManager
}
