use tower_sessions::Session;
use crate::constants;

pub struct UserSessionData {
  pub user_id: u64, 
  pub username: String,
  pub storage_quota: u64
}

pub async fn GetUserSessionData(session: &Session) -> Option<UserSessionData> {
  let user_id = match session.get::<u64>(constants::SESSION_USER_ID_KEY).await.unwrap() {
    Some(id) => id,
    None => return None
  };

  let username = match session.get::<String>(constants::SESSION_USERNAME_KEY).await.unwrap() {
    Some(name) => name,
    None => return None
  };

  let storage_quota = match session.get::<u64>(constants::SESSION_STORAGE_QUOTA_KEY).await.unwrap() {
    Some(value) => value,
    None => return None
  };

  Some(UserSessionData {
    user_id: user_id,
    username: username,
    storage_quota: storage_quota
  })
}

#[macro_export]
macro_rules! get_session_data_or_return_unauthorized {
  ($session:ident) => {
    match GetUserSessionData(&$session).await {
      Some(data) => data,
      None => return StatusCode::UNAUTHORIZED.into_response()
    } 
  };
}
