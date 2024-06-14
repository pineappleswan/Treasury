use axum::extract::Multipart;
use std::error::Error;

/// Tries to read the next field of a multipart with an expected name of the field.
#[macro_export]
macro_rules! read_next_multipart_field {
  ($multipart:ident, $expected_name:expr) => {
    {
      let field_option = $multipart.next_field().await.map_err(|_| "Next field failed to read.")?;
      let field = field_option.ok_or("Next field not found.")?;
      let name = field.name().ok_or("Failed to read next field's name.")?.to_string();

      // Ensure the actual name of the field matches the expected name
      if name != $expected_name {
        return Err(format!("Expected next field's name to be '{}', but got '{}' instead.", $expected_name, name).into());
      }

      (field, name)
    }
  };
}

pub async fn read_next_multipart_data_as_string(multipart: &mut Multipart, expected_name: &str) -> Result<String, Box<dyn Error>> {
  let (field, name) = read_next_multipart_field!(multipart, expected_name);
  let text = field.text().await.map_err(|_| format!("Failed to read text data of multipart field: '{}'.", name))?;

  Ok(text)
}

/// Calls `read_next_multipart_data_as_string` and returns the string data.
/// 
/// If it fails, then it will automatically return status code bad request with a body of the error message.
#[macro_export]
macro_rules! read_next_multipart_data_as_string_or_bad_request {
  ($multipart:ident, $expected_name:expr) => {
    match read_next_multipart_data_as_string(&mut $multipart, $expected_name).await {
      Ok(text) => text,
      Err(err) => return Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .body(Body::from(err.to_string()))
        .unwrap()
    }
  };
}

pub async fn read_next_multipart_data_as_i64(multipart: &mut Multipart, expected_name: &str) -> Result<i64, Box<dyn Error>> {
  let (field, name) = read_next_multipart_field!(multipart, expected_name);
  let text = field.text().await.map_err(|_| format!("Failed to read text data of multipart field: '{}'.", name))?;
  let number = text.parse::<i64>().map_err(|_| format!("Failed to parse text as i64 for field: '{}'.", name))?;

  Ok(number)
}

/// Calls `read_next_multipart_data_as_i64` and returns a parsed i64.
/// 
/// If it fails, then it will automatically return status code bad request with a body of the error message.
#[macro_export]
macro_rules! read_next_multipart_data_as_i64_or_bad_request {
  ($multipart:ident, $expected_name:expr) => {
    match read_next_multipart_data_as_i64(&mut $multipart, $expected_name).await {
      Ok(number) => number,
      Err(err) => return Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .body(Body::from(err.to_string()))
        .unwrap()
    }
  };
}

pub async fn read_next_multipart_data_as_bytes(multipart: &mut Multipart, expected_name: &str) -> Result<Vec<u8>, Box<dyn Error>> {
  let (field, name) = read_next_multipart_field!(multipart, expected_name);
  let bytes = field.bytes().await.map_err(|_| format!("Failed to read bytes data of multipart field: '{}'.", name))?;

  Ok(bytes.to_vec())
}

/// Calls `read_next_multipart_data_as_bytes` and returns the bytes as a Vec<u8>.
/// 
/// If it fails, then it will automatically return status code bad request with a body of the error message.
#[macro_export]
macro_rules! read_next_multipart_data_as_bytes_or_bad_request {
  ($multipart:ident, $expected_name:expr) => {
    match read_next_multipart_data_as_bytes(&mut $multipart, $expected_name).await {
      Ok(bytes) => bytes,
      Err(err) => return Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .body(Body::from(err.to_string()))
        .unwrap()
    }
  };
}
