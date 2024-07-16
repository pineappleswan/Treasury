use dashmap::DashMap;
use tokio::sync::{watch::Sender, Mutex};
use std::sync::atomic::AtomicI64;
use std::sync::{Arc, atomic::Ordering};
use log::{info, error};
use crate::core::web_sockets::WebSocketEvent;
use crate::core::config::Config;
use crate::core::upload_manager::UploadManager;
use crate::core::download_manager::DownloadManager;
use crate::storage::database::Database;
use crate::storage::file_store::FileStoreManager;

pub struct AppState {
  pub config: Arc<Config>,
  pub file_store: Arc<FileStoreManager>,
  pub database: Arc<Mutex<Option<Database>>>,
  pub uploads_manager: UploadManager,
  pub downloads_manager: DownloadManager,

  /// Maps a user's id to a tokio watch channel used for web socket messaging
  pub web_socket_watch_channels: Arc<DashMap<u64, Sender<Option<WebSocketEvent>>>>,

  /// Maps a user's id to an atomic integer that count's how many active web socket connections
  /// are connected to that user.
  pub web_socket_count_per_user_map: Arc<DashMap<u64, AtomicI64>>
}

impl AppState {
  pub async fn update_watch_channel_for_user(&self, user_id: u64) {
    // TODO:

    // Check if new watch channel needs to be created
    let mut create_channel = false;

    if let Some(active_connections) = self.web_socket_count_per_user_map.get(&user_id) {
      let active_connections = active_connections.load(Ordering::SeqCst);

      if active_connections == 0 {
        create_channel = true;
      } else if active_connections < 0 {
        error!("Active connection count");
      }
    } else {
      create_channel = true;
    }

    if create_channel {

    }
  }
}
