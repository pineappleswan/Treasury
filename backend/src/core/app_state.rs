use dashmap::DashMap;
use tokio::sync::watch;
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
  pub web_socket_count_per_user_map: Arc<DashMap<u64, Arc<AtomicI64>>>
}

impl AppState {
  pub async fn update_watch_channel_for_user(&self, user_id: u64) {
    // Check if new watch channel needs to be created
    let socket_count = self.web_socket_count_per_user_map
      .get(&user_id)
      .expect(format!("Couldn't find web socket count atomic int for user: {}", user_id).as_str());

    let socket_count = socket_count.load(Ordering::SeqCst);

    if socket_count > 0 {
      if self.web_socket_watch_channels.get(&user_id).is_none() {
        let (tx, _) = watch::channel::<Option<WebSocketEvent>>(None);
        self.web_socket_watch_channels.insert(user_id, tx);

        info!("New socket watch channel: {}", user_id);
      }
    } else if socket_count == 0 {
      let removed = self.web_socket_watch_channels.remove(&user_id);

      if removed.is_some() {
        info!("Removed socket watch channel: {}", user_id);
      }
    } else if socket_count < 0 {
      error!("Active connection count is less than zero for user: {}", user_id);
    }
  }
}
