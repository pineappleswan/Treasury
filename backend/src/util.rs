use std::error::Error;
use regex::Regex;
use nanoid::nanoid;
use base64::{engine::general_purpose, Engine as _};

#[path = "constants.rs"] mod constants;

pub fn secure_random_alphanumeric_str(length: usize) -> String {
  nanoid!(length, &constants::ALPHANUMERIC_CHARS)
}

pub fn generate_claim_code() -> String {
  let section_length = 5;

  format!(
    "{}-{}-{}-{}",
    nanoid!(section_length, &constants::LOWER_CASE_ALPHANUMERIC_CHARS),
    nanoid!(section_length, &constants::LOWER_CASE_ALPHANUMERIC_CHARS),
    nanoid!(section_length, &constants::LOWER_CASE_ALPHANUMERIC_CHARS),
    nanoid!(section_length, &constants::LOWER_CASE_ALPHANUMERIC_CHARS)
  )
}

// TODO: handle possible integer overflow!
pub fn parse_byte_size_str(mut input: String) -> Result<u64, Box<dyn Error + Send + Sync>> {
  // 'b' must be last because all units share 'b' as the last character.
  let unit_multipliers = vec!["kb", "mb", "gb", "tb", "pb", "b"];

  input = input.replace(" ", ""); // Remove any spaces
  input = input.to_lowercase(); // Make operation case insensitive by making it all lowercase
  
  // Check validity of the unit provided
  let mut found_valid_unit = false;
  let mut chosen_unit = "";
  let mut exponent: i64 = 0;
  
  for i in 0..unit_multipliers.len() {
    let unit = unit_multipliers[i];

    if input.ends_with(unit) {
      found_valid_unit = true;
      chosen_unit = unit;
      exponent = (i as i64) + 1;
      break;
    }
  }

  // Handle special case of 'b' for bytes
  if exponent == unit_multipliers.len() as i64 {
    exponent = 0;
  }

  if !found_valid_unit {
    return Err("Invalid unit provided.".into());
  }

  // Get the number part of the input
  let number_part_str = input[0..input.len() - chosen_unit.len()].to_string();

  // Only allow 0-9 and periods which also invalidates negative numbers.
  let valid_number_regex = Regex::new(r"^[0-9.]+$").unwrap();

  if !valid_number_regex.is_match(&number_part_str) {
    return Err("Invalid number provided.".into());
  }

  if let Ok(number_part) = number_part_str.parse::<f64>() {
    let result_as_float = number_part * 1000f64.powf(exponent as f64);
    
    return Ok(result_as_float as u64);
  } else {
    return Err("Invalid number provided.".into());
  }
}

// Validation utils

pub fn validate_base64_string(input: &String, length: usize) -> Result<(), Box<dyn Error + Send + Sync>> {
  if input.is_empty() {
    return Err("Input string is empty.".into());
  }

  if let Ok(bytes) = general_purpose::STANDARD.decode(input) {
    if bytes.len() != length {
      return Err(format!("Length mismatch. Expected size {} but got {}.", length, bytes.len()).into());
    }
  } else {
    return Err("Invalid base64.".into());
  }

  Ok(())
}
