#[macro_export]
macro_rules! validate_integer_max_value {
  ($self:ident, $property:ident, $max_value:expr) => {
    if $self.$property > $max_value {
      return Err(
        format!(
          "Integer '{}' is over the max value of {}. Got {}.",
          stringify!($property),
          $max_value,
          $self.$property
        ).into()
      );
    }
  };
}

#[macro_export]
macro_rules! validate_string_is_ascii_alphanumeric {
  ($self:ident, $property:ident) => {
    if !($self.$property.chars().all(|c: char| char::is_ascii_alphanumeric(&c))) {
			return Err(
        format!(
          "Expected string '{}' to be ASCII alphanumeric.",
          stringify!($property)
        ).into()
      );
		}
  };
}

#[macro_export]
macro_rules! validate_string_length {
  ($property:expr, $expected_len:expr) => {
    if $property.len() != $expected_len {
      return Err(
        format!(
          "Expected string '{}' length to be {} but got length {}.",
          stringify!($property),
          $expected_len,
          $property.len()
        ).into()
      );
    }
  };
}

#[macro_export]
macro_rules! validate_string_length_range {
  ($self:ident, $property:ident, $min_len:expr, $max_len:expr) => {
    {
      let length = $self.$property.len();
      
      if length < $min_len || length > $max_len {
        return Err(
          format!(
            "String '{}' length out of range. Got length {} but valid range is {}-{} inclusive.",
            stringify!($property),
            length,
            $min_len,
            $max_len
          ).into()
        );
      }
    };
  }
}

#[macro_export]
macro_rules! validate_base64_binary_size {
  ($self:ident, $property:ident, $expected_len:expr) => {
    {
      if let Ok(bytes) = general_purpose::STANDARD.decode(&$self.$property) {
        if bytes.len() != $expected_len {
          return Err(
            format!(
              "Expected base64 '{}' size to be {} but got size {}.",
              stringify!($property),
              $expected_len,
              bytes.len()
            ).into()
          );
        }
      } else {
        return Err(format!("Base64 '{}' is invalid.", stringify!($property)).into());
      }
    }
  };
}

#[macro_export]
macro_rules! validate_base64_max_binary_size {
  ($self:ident, $property:ident, $max_len:expr) => {
    {
      if let Ok(bytes) = general_purpose::STANDARD.decode(&$self.$property) {
        if bytes.len() > $max_len {
          return Err(
            format!(
              "Expected base64 '{}' max size to be {} but got size {}.",
              stringify!($property),
              $max_len,
              bytes.len()
            ).into()
          );
        }
      } else {
        return Err(format!("Base64 '{}' is invalid.", stringify!($property)).into());
      }
    }
  };
}
