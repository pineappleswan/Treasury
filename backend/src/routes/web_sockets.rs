use http::StatusCode;
use tokio::{sync::broadcast::error::RecvError, task};
use tower_sessions::Session;
use std::sync::{atomic::Ordering, Arc};
use log::{debug, warn};
use futures::{sink::SinkExt, stream::StreamExt};
use axum::{
  extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
  response::IntoResponse
};

use crate::{
  core::{constants, sessions::{get_user_session_data, UserSessionData}, web_sockets::WebSocketEvent}, get_session_data_or_return_unauthorized, AppState
};

pub async fn web_socket_handler(
  session: Session,
  ws: WebSocketUpgrade,
  State(state): State<Arc<AppState>>
) -> impl IntoResponse {
  let session_data = get_session_data_or_return_unauthorized!(session);

  debug!("Initial web socket request from user: {}", session_data.user_id);

  // Ensure socket count doesn't exceed limit. If it does, then close the socket.
  let socket_count = state.web_socket_count_per_user_map
    .get(&session_data.user_id)
    .unwrap()
    .clone();

  let current_socket_count = socket_count.load(Ordering::SeqCst);

  if current_socket_count >= constants::MAX_WEB_SOCKET_COUNT_PER_USER {
    warn!("Web socket establish denied because user {} is at limit.", session_data.user_id);
    return StatusCode::TEMPORARY_REDIRECT.into_response();
  }

  ws.on_upgrade(move |socket| handle_socket(socket, state.clone(), session, session_data))
}

async fn handle_socket(
  socket: WebSocket,
  state: Arc<AppState>,
  _session: Session,
  session_data: UserSessionData
) {
  let socket_count = state.web_socket_count_per_user_map
    .get(&session_data.user_id)
    .unwrap()
    .clone();

  // Increment socket count by 1 and update broadcast channel
  let old_socket_count = socket_count.fetch_add(1, Ordering::SeqCst);
  state.update_broadcast_channel_for_user(session_data.user_id).await;

  debug!("New web socket session with user {}. Count: {}", session_data.user_id, old_socket_count + 1);

  // Get broadcast channel and subscribe
  let broadcast_channel_tx = state.web_socket_broadcast_channels
    .get(&session_data.user_id)
    .unwrap()
    .clone();

  let mut broadcast_channel_rx = broadcast_channel_tx.subscribe();
  let ws_broadcast_channel_tx = broadcast_channel_tx.clone();

  // Split socket so messages can be received from and sent to the client in separate threads
  let (mut socket_tx, mut socket_rx) = socket.split();

  let web_socket_task = task::spawn(async move {
    while let Some(Ok(msg)) = socket_rx.next().await {
      match msg {
        Message::Text(text) => {
          debug!("WS text from {}: {}", session_data.user_id, text);

          let _ = ws_broadcast_channel_tx.send(WebSocketEvent {
            message: text
          });
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

  // Task that listens for messages from the user's broadcast channel
  let broadcast_task = task::spawn(async move {
    loop {
      let event = broadcast_channel_rx.recv().await;

      match event {
        Ok(event) => {
          // Process the raw message
          println!("Event [{}]: {}", session_data.user_id, event.message);
    
          // Send the same message to the client
          if let Err(err) = socket_tx.send(Message::Text(event.message.clone())).await {
            warn!("Web socket send error: {}", err)
          }
        },
        Err(err) => {
          match err {
            RecvError::Closed => {
              debug!("Broadcast received closed.");
              break;
            },
            RecvError::Lagged(skipped) => {
              warn!("Web socket broadcast for user {} lagged and skipped {} messages!", session_data.user_id, skipped);
            }
          }
        }
      }
    }
  });
  
  // Wait for at least one thread to finish which is when the other task will be aborted
  let broadcast_task_abort_handle = broadcast_task.abort_handle();
  let web_socket_task_abort_handle = web_socket_task.abort_handle();

  tokio::select! {
    _ = web_socket_task => {
      broadcast_task_abort_handle.abort();
    },
    _ = broadcast_task => {
      web_socket_task_abort_handle.abort();
    }
  };

  // Subtract socket count by 1 and update
  let old_socket_count = socket_count.fetch_sub(1, Ordering::SeqCst);
  debug!("Web socket session with user {} finished. Count: {}", session_data.user_id, old_socket_count - 1);

  state.update_broadcast_channel_for_user(session_data.user_id).await;
}
