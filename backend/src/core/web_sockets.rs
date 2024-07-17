#[derive(Clone, PartialEq)]
pub enum WebSocketEventType {
  Message,
  Close
}

#[derive(Clone)]
pub struct WebSocketEvent {
  pub event_type: WebSocketEventType,
  pub message: String
}
