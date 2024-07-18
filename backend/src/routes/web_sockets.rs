use http::StatusCode;
use tokio::task;
use tower_sessions::Session;
use std::{borrow::Borrow, sync::{atomic::Ordering, Arc}};
use log::{debug, error, info, warn};
use futures::{sink::SinkExt, stream::StreamExt};
use axum::{
  extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
  response::IntoResponse
};

use crate::{
  core::{sessions::{get_user_session_data, UserSessionData}, web_sockets::WebSocketEvent}, get_session_data_or_return_unauthorized, AppState
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
  
  // Increment socket count by 1 and update watch channel
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

  // Split socket so messages can be received from and sent to the client in separate threads
  let (mut socket_tx, mut socket_rx) = socket.split();

  let web_socket_task = task::spawn(async move {
    while let Some(Ok(msg)) = socket_rx.next().await {
      match msg {
        Message::Text(text) => {
          debug!("WS text from {}: {}", session_data.user_id, text);

          let _ = ws_watch_channel_tx.send(Some(WebSocketEvent {
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

  // Task that listens for messages from the user's watch channel
  let watch_task = task::spawn(async move {
    while watch_channel_rx.changed().await.is_ok() {
      // Read event message
      let event_message = {
        let event = &*watch_channel_rx.borrow();
        event.as_ref().map(|e| e.message.clone())
      };

      // Process the raw message
      if let Some(message) = event_message {
        println!("Event [{}]: {}", session_data.user_id, message);
  
        // Send the same message to the client
        if let Err(err) = socket_tx.send(Message::Text(message.clone())).await {
          warn!("Web socket send error: {}", err)
        }
      }
    }
  });

  let watch_task_abort_handle = watch_task.abort_handle();

  // Wait for at least one thread to finish
  tokio::select! {
    _ = web_socket_task => {
      watch_task_abort_handle.abort();
    },
    _ = watch_task => {}
  };

  // Subtract socket count by 1 and update
  let old_socket_count = socket_count.fetch_sub(1, Ordering::SeqCst);
  debug!("Web socket session with user {} finished. Count: {}", session_data.user_id, old_socket_count - 1);

  state.update_watch_channel_for_user(session_data.user_id).await;
}
