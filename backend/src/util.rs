use regex::Regex;

pub fn parse_byte_size_str(mut input: String) -> Result<u64, String> {
  // 'b' must be last because all units share 'b' as the last character.
  let unit_multipliers = vec!["kb", "mb", "gb", "tb", "pb", "b"];

  input = input.trim().to_string();
  input = input.to_lowercase();
  
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
    return Err("Invalid unit provided.".to_string());
  }

  // Get the number part of the input
  let number_part_str = input[0..input.len() - chosen_unit.len()].to_string();
  let valid_number_regex = Regex::new(r"^[0-9.]+$").unwrap();

  if !valid_number_regex.is_match(&number_part_str) {
    return Err("Invalid number provided.".to_string());
  }

  if let Ok(number_part) = number_part_str.parse::<f64>() {
    println!("Number part: {}", number_part);
    println!("Exponent: {}", exponent);
    println!("Unit multiplier: {}", 1000i64.pow(exponent as u32));
    println!("Result: {}", number_part * 1000f64.powf(exponent as f64));
  } else {
    return Err("Invalid number provided.".to_string());
  }

  Ok(0)
}
