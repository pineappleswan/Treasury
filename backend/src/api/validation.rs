#[macro_export]
macro_rules! validate_integer_max_value {
  ($self:ident, $property:ident, $max:expr) => {
    if $self.$property > $max {
      return Err(
        format!(
          "Integer '{}' is over the max value of {}. Got {}.",
          stringify!($property), $max, $self.$property
        ).into()
      );
    }
  };
}

#[macro_export]
macro_rules! validate_integer_is_positive {
  // Match when 'self' is provided
  ($self:ident, $property:ident) => {
    if $self.$property < 0 {
      return Err(
        format!(
          "Integer '{}' must be positive. Got {}.",
          stringify!($property), $self.$property
        ).into()
      );
    }
  };

  // Match when there is no 'self'
  ($property:expr) => {
    if $property < 0 {
      return Err(
        format!(
          "Integer '{}' must be positive. Got {}.",
          stringify!($property), $property
        ).into()
      );
    }
  };
}

/// Asserts that the input integer is within the minimum and maximum value (inclusive).
#[macro_export]
macro_rules! validate_integer_range {
  // Match when 'self' is provided
  ($self:ident, $property:ident, $min:expr, $max:expr) => {
    if $self.$property < $min || $self.$property > $max {
      return Err(
        format!(
          "Integer '{}' is out of the range {}-{}. Got {}.",
          stringify!($property), $min, $max, $self.$property
        ).into()
      );
    }
  };

  // Match when there is no 'self'
  ($integer:expr, $min:expr, $max:expr) => {
    if $integer < $min || $integer > $max {
      return Err(
        format!(
          "Integer '{}' is out of the range {}-{}. Got {}.",
          stringify!($integer), $min, $max, $integer
        ).into()
      );
    }
  };
}

/// Asserts that a string is ascii alphanumeric.
#[macro_export]
macro_rules! validate_string_is_ascii_alphanumeric {
  ($self:ident, $property:ident) => {
    if !($self.$property.chars().all(|c: char| char::is_ascii_alphanumeric(&c))) {
			return Err(format!("Expected string '{}' to be ASCII alphanumeric.", stringify!($property)).into());
		}
  };
}

/// Asserts that a string exactly matches the provided length.
#[macro_export]
macro_rules! validate_string_length {
  // Match when 'self' is provided
  ($self:ident, $property:ident, $expected_len:expr) => {
    if $self.$property.len() != $expected_len {
      return Err(
        format!(
          "Expected string '{}' length to be {} but got length {}.",
          stringify!($property), $expected_len, $self.$property.len()
        ).into()
      );
    }
  };

  // Match when there is no 'self'
  ($string:expr, $expected_len:expr) => {
    if $string.len() != $expected_len {
      return Err(
        format!(
          "Expected string '{}' length to be {} but got length {}.",
          stringify!($string), $expected_len, $string.len()
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
            stringify!($property), length, $min_len, $max_len
          ).into()
        );
      }
    };
  }
}

#[macro_export]
macro_rules! validate_base64_byte_size {
  ($self:ident, $property:ident, $expected_len:expr) => {
    {
      if let Ok(bytes) = general_purpose::STANDARD.decode(&$self.$property) {
        if bytes.len() != $expected_len {
          return Err(
            format!(
              "Expected base64 '{}' size to be {} but got size {}.",
              stringify!($property), $expected_len, bytes.len()
            ).into()
          );
        }
      } else {
        return Err(format!("Base64 '{}' is invalid.", stringify!($property)).into());
      }
    }
  };
}

/// Asserts that a base64 string represents a byte size that doesn't exceed a specified limit.
#[macro_export]
macro_rules! validate_base64_max_byte_size {
  ($self:ident, $property:ident, $max_len:expr) => {
    {
      if let Ok(bytes) = general_purpose::STANDARD.decode(&$self.$property) {
        if bytes.len() > $max_len {
          return Err(
            format!(
              "Expected base64 '{}' max size to be {} but got size {}.",
              stringify!($property), $max_len, bytes.len()
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
macro_rules! validate_vector_length_range {
  // Match when 'self' is provided
  ($self:ident, $property:ident, $min:expr, $max:expr) => {
    if $self.$property.len() < $min || $self.$property.len() > $max {
      return Err(
        format!(
          "Length of vector '{}' is out of range! Valid range is {}-{}. Got length {}.",
          stringify!($property), $min, $max, $self.$property.len()
        ).into()
      );
    }
  };

  // Match when there is no 'self'
  ($vector:expr, $min:expr, $max:expr) => {
    if $vector.len() < $min || $vector.len() > $max {
      return Err(
        format!(
          "Length of vector '{}' is out of range! Valid range is {}-{}. Got length {}.",
          stringify!($property), $min, $max, $vector.len()
        ).into()
      );
    }
  };
}
