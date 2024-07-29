use std::error::Error;

// TODO: tests for both functions

/// Converts a size representing a number of bytes to a human readable format.
/// 
/// `use_base_two`
/// 
/// ### Example
/// Given `size = 1,540,000`, `use_base_two = false` and `precision = 2`, this function 
/// will return a string of "1.54 MB".
pub fn format_size_human_readable(size: u64, use_base_two: bool, precision: usize) -> String {
  let unit_suffixes = if use_base_two {
    vec!["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"]
  } else {
    vec!["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
  };

  let mut size = size as f64;
  let mut unit_index = 0;
  
  let divisor = match use_base_two {
    true => 1024.0,
    false => 1000.0
  };
  
  while size >= divisor && unit_index < unit_suffixes.len() - 1 {
    size /= divisor;
    unit_index += 1;
  }

  format!("{:.prec$} {}", size, unit_suffixes[unit_index], prec = precision)
}

// TODO: handle possible integer overflow!

/// Parses a byte size represented in a human readable string like `1gb`, `10 mb`, `15.6 TB`, etc. 
/// to their corresponding u64 value.
/// 
/// The following suffixes are valid (case-insensitive): `B`, `KB`, `MB`, `GB`, `TB`, `PB`
/// 
/// **WARNING:** May be slightly inaccurate for large sizes due to internal use of floats.
pub fn parse_human_readable_size(mut input: String) -> Result<u64, Box<dyn Error + Send + Sync>> {
  let units = vec!["b", "kb", "mb", "gb", "tb", "pb"];

  // Remove any spaces
  input = input.replace(" ", "");

  // Make operation case insensitive by making it all lowercase
  input = input.to_lowercase(); 
  
  // The iterator is reversed because the 'b' suffix needs to be last, as every other suffix ends with 'b'.
  for (exponent, unit) in units.iter().rev().enumerate() {
    let exponent = (units.len() - exponent) - 1;

    if !input.ends_with(unit) {
      continue;
    }

    // Parse the base value in the input string
    let base = &input[..input.len() - unit.len()];

    if let Ok(base) = base.parse::<f64>() {
      return Ok((base * 1000f64.powf(exponent as f64)) as u64);
    } else {
      return Err("Invalid number.".into());
    }
  }

  Err("Invalid unit.".into())
}
