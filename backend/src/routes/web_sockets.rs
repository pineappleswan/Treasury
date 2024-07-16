use http::StatusCode;
use tower_sessions::Session;
use std::sync::{atomic::Ordering, Arc};
use log::{info, error};
use axum::{
  extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
  response::IntoResponse
};

use crate::{
  AppState,
  core::sessions::{get_user_session_data, UserSessionData},
  get_session_data_or_return_unauthorized
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
  app_state: Arc<AppState>,
  session: Session,
  session_data: UserSessionData
) {
  println!("New web socket session with user {}.", session_data.user_id);

  

  while let Some(Ok(msg)) = socket.recv().await {
    match msg {
      Message::Text(text) => {
        println!("WS text from {}: {}", session_data.user_id, text);
      },
      Message::Close(_) => {
        println!("WS close request from {}.", session_data.user_id);
        break;
      }
      _ => {
        println!("Unknown message type.");
      }
    }
  }

  /*
  if socket.send(Message::Text("Hello".to_string())).await.is_ok() {
    println!("Sent message.");
  } else {
    println!("Failed to send message.");
  }
  */

  println!("Web socket session with user {} finished.", session_data.user_id);
}
