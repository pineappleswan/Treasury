use dashmap::DashMap;
use tokio::sync::broadcast;
use tokio::sync::{broadcast::Sender, Mutex};
use std::error::Error;
use std::sync::atomic::AtomicI64;
use std::sync::{Arc, atomic::Ordering};
use log::{debug, error};
use crate::core::constants;
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

  /// Maps a user's id to a tokio broadcast channel used for web socket messaging
  pub web_socket_broadcast_channels: Arc<DashMap<u64, Sender<WebSocketEvent>>>,

  /// Maps a user's id to an atomic integer that count's how many active web socket connections
  /// are connected to that user.
  pub web_socket_count_per_user_map: Arc<DashMap<u64, Arc<AtomicI64>>>
}

impl AppState {
  pub async fn update_broadcast_channel_for_user(&self, user_id: u64) {
    // Check if new broadcast channel needs to be created
    let socket_count = self.web_socket_count_per_user_map
      .get(&user_id)
      .expect(format!("Couldn't find web socket count atomic int for user: {}", user_id).as_str());

    let socket_count = socket_count.load(Ordering::SeqCst);

    if socket_count > 0 {
      // Create broadcast channel if it doesn't exist
      if self.web_socket_broadcast_channels.get(&user_id).is_none() {
        let (tx, _) = broadcast::channel::<WebSocketEvent>(constants::WEB_SOCKET_BROADCAST_CHANNEL_CAPACITY);
        self.web_socket_broadcast_channels.insert(user_id, tx);

        debug!("New socket broadcast channel: {}", user_id);
      }
    } else if socket_count == 0 {
      // Remove broadcast channel
      let removed = self.web_socket_broadcast_channels.remove(&user_id);

      if removed.is_some() {
        debug!("Removed socket broadcast channel: {}", user_id);
      }
    } else if socket_count < 0 {
      error!("Active connection count is less than zero for user: {}", user_id);
    }
  }

  pub fn broadcast_web_socket_message(&self, user_id: &u64, message: String) -> Result<(), Box<dyn Error>> {
    match self.web_socket_broadcast_channels.get(user_id) {
      Some(channel) => {
        match channel.send(WebSocketEvent { message }) {
          Ok(_) => Ok(()),
          Err(_) => Err(format!("Failed to send message").into())
        }
      },
      None => Err(format!("User id {} was not found", user_id).into())
    }
  }
}
