use http::StatusCode;
use tokio::task;
use tower_sessions::Session;
use std::sync::{atomic::Ordering, Arc};
use log::{debug, error, info};
use axum::{
  extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
  response::IntoResponse
};

use crate::{
  core::{sessions::{get_user_session_data, UserSessionData}, web_sockets::{WebSocketEvent, WebSocketEventType}}, get_session_data_or_return_unauthorized, AppState
};

pub async fn web_socket_handler(
  session: Session,
  ws: WebSocketUpgrade,
  State(state): State<Arc<AppState>>
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  ws.on_upgrade(move |socket| handle_socket(socket, state.clone(), session, session_data))
}

async fn handle_socket(
  mut socket: WebSocket,
  state: Arc<AppState>,
  session: Session,
  session_data: UserSessionData
) {
  let socket_count = state.web_socket_count_per_user_map
    .get(&session_data.user_id)
    .unwrap()
    .clone();
  
  // Increment socket count and update watch channel
  let old_socket_count = socket_count.fetch_add(1, Ordering::SeqCst);
  state.update_watch_channel_for_user(session_data.user_id).await;

  debug!("New web socket session with user {}. Count: {}", session_data.user_id, old_socket_count + 1);

  // Get watch channel and subscribe
  let watch_channel_tx = state.web_socket_watch_channels
    .get(&session_data.user_id)
    .unwrap()
    .clone();

  let mut watch_channel_rx = watch_channel_tx.subscribe();
  let ws_watch_channel_tx = watch_channel_tx.clone();

  let web_socket_task = task::spawn(async move {

    while let Some(Ok(msg)) = socket.recv().await {
      match msg {
        Message::Text(text) => {
          debug!("WS text from {}: {}", session_data.user_id, text);

          let _ = ws_watch_channel_tx.send(Some(WebSocketEvent {
            event_type: WebSocketEventType::Message,
            message: text
          }));
        },
        Message::Close(_) => {
          debug!("WS close request from {}.", session_data.user_id);
          break;
        }
        _ => {
          debug!("Unknown message type.");
        }
      }
    }
  });

  let watch_task = task::spawn(async move {
    while watch_channel_rx.changed().await.is_ok() {
      let event = &*watch_channel_rx.borrow();

      if let Some(event) = event {
        if event.event_type == WebSocketEventType::Close {
          break;
        }

        println!("Event [{}]: {}", session_data.user_id, event.message);
      }
    }
  });

  // Wait for at least one thread to finish
  tokio::select! {
    _ = web_socket_task => {
      // Tell watch task to stop listening
      watch_channel_tx.send(Some(WebSocketEvent {
        event_type: WebSocketEventType::Close,
        message: String::new()
      })).ok();
    },
    _ = watch_task => {}
  };

  let old_socket_count = socket_count.fetch_sub(1, Ordering::SeqCst);
  debug!("Web socket session with user {} finished. Count: {}", session_data.user_id, old_socket_count - 1);

  state.update_watch_channel_for_user(session_data.user_id).await;
}
