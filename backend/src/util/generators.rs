use nanoid::nanoid;
use crate::constants;

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

pub fn generate_file_handle() -> String {
  let length = constants::FILE_HANDLE_LENGTH;
  nanoid!(length, &constants::ALPHANUMERIC_CHARS)
}
