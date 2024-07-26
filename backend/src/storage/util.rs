use std::path::PathBuf;
use crate::core::constants;

pub fn get_local_disk_file_path(root_path: &PathBuf, handle: String) -> PathBuf {
  root_path.join(handle + constants::TREASURY_FILE_EXTENSION)
}
