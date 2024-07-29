use crate::{constants, storage::chunk_id_map::ChunkIdMap};

/// Calculates the number of chunks a file can be split into with a minimum result of 1
pub fn calc_file_chunk_count(raw_file_size: u64) -> u64 {
  let quotient = raw_file_size / (constants::CHUNK_DATA_SIZE as u64);
  let remainder = raw_file_size % (constants::CHUNK_DATA_SIZE as u64);

  let count = if remainder == 0 {
    quotient
  } else {
    quotient + 1
  };

  std::cmp::max(count, 1)
}

/// Calculates the size of a file after splitting into chunks and encryption
pub fn calc_encrypted_file_size(raw_file_size: u64) -> u64 {
  let chunk_count = calc_file_chunk_count(raw_file_size);
  let overhead = chunk_count * (constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE as u64);

  overhead + raw_file_size
}

/// Calculates the original size of a file that was split into chunks and encrypted
pub fn calc_raw_file_size(encrypted_file_size: u64) -> u64 {
  let chunk_count = calc_file_chunk_count(encrypted_file_size);
  let extra_data_size = constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE as u64;
  
  std::cmp::max(0, encrypted_file_size - (extra_data_size * chunk_count))
}

/// Assumes encrypted_chunk_size is not below constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE
pub fn calc_raw_chunk_size(encrypted_chunk_size: u64) -> u64 {
  encrypted_chunk_size - constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE as u64
}

/// Calculates the encrypted size of a chunk that was received from the client for an upload.
/// 
/// **WARNING:** Undefined behaviour will occur if `chunk_id` is greater than the maximum chunk id 
/// for the given upload size.
pub fn calc_encrypted_chunk_size(upload_size: u64, chunk_id: u32) -> i64 {
  let write_offset = chunk_id as u64 * constants::CHUNK_DATA_SIZE as u64;
  let bytes_to_end = (upload_size - write_offset) as i64;

  std::cmp::min(bytes_to_end, constants::CHUNK_DATA_SIZE as i64) + constants::ENCRYPTED_CHUNK_EXTRA_DATA_SIZE as i64
}


/// Returns a tuple of the chunk read offset and read size
pub fn calc_chunk_location(chunk_id: u32, encrypted_file_size: u64, chunk_id_map: Option<ChunkIdMap>) -> (u64, u64) {
  let raw_file_size = calc_raw_file_size(encrypted_file_size);
  let chunk_count = calc_file_chunk_count(raw_file_size);

  // Calculate read size and offset
  let enc_chunk_size = constants::ENCRYPTED_CHUNK_SIZE as u64;
  let read_offset = enc_chunk_size * chunk_id as u64;
  let read_size = std::cmp::min(enc_chunk_size, encrypted_file_size - read_offset);

  // If the mapped chunk id is greater than the mapped max chunk id, then apply a correction.
  // 
  // To explain the problem, let's say chunk sizes are 1024 bytes and a file is being uploaded 
  // to the server which requires two chunks: 'A' which is 1024 bytes long and 'B' which is 512 
  // bytes long. If the user uploads the chunks out of order and B arrives before A, then when 
  // calculating the read offset for chunk A, the read offset is expected to be at 1024 but since 
  // chunk B arrived first and is located before chunk A in the file, an offset of the negative of 
  // 1024 - 512 has to be applied to get the correct chunk offset. 
  match chunk_id_map {
    Some(map) => {
      let max_chunk_id = (chunk_count - 1) as u32;
      let mapped_max_chunk_id = map.map_chunk_id(max_chunk_id);
      let mapped_chunk_id = map.map_chunk_id(chunk_id);
      
      let correction_offset = if mapped_chunk_id > mapped_max_chunk_id {
        enc_chunk_size - calc_encrypted_chunk_size(raw_file_size, max_chunk_id) as u64
      } else {
        0
      };
      
      // Calculate read offset
      let read_offset = enc_chunk_size * mapped_chunk_id as u64 - correction_offset as u64;

      (read_offset, read_size)
    },
    // No chunk id map exists, so just return the normal calculations
    None => (read_offset, read_size)
  }
}

// TODO: tests!
