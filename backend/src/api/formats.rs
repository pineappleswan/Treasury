use crate::constants;

pub fn calc_file_chunk_count(raw_file_size: u64) -> u64 {
	let quotient = raw_file_size / (constants::CHUNK_DATA_SIZE as u64);
	let remainder = raw_file_size % (constants::CHUNK_DATA_SIZE as u64);

  if remainder == 0 {
    quotient
  } else {
    quotient + 1
  }
}

pub fn calc_encrypted_file_size(raw_file_size: u64) -> u64 {
	let chunk_count = calc_file_chunk_count(raw_file_size);
  let header_size = constants::ENCRYPTED_FILE_HEADER_SIZE as u64;
	let overhead = header_size + (chunk_count * (constants::CHUNK_EXTRA_DATA_SIZE as u64));

	return overhead + raw_file_size;
}

// TODO: tests!
