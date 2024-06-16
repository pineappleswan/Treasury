// Username constraints
pub const MIN_USERNAME_LENGTH: usize = 3;
pub const MAX_USERNAME_LENGTH: usize = 20;

// Argon2 settings
pub const ARGON2_PARALLELISM: usize = 1;
pub const ARGON2_ITERATIONS: usize = 3;
pub const ARGON2_MEMORY_SIZE: usize = 12 * 1024; // In KiB

// Sessions
pub const SESSION_USER_ID_KEY: &str = "user_id";
pub const SESSION_USERNAME_KEY: &str = "username";
pub const SESSION_STORAGE_QUOTA_KEY: &str = "storage_quota";
pub const SESSION_EXPIRY_TIME_SECONDS: i64 = 3 * 86400;

// Crypto length constants
pub const XCHACHA20_KEY_SIZE: usize = 32;
pub const CURVE25519_KEY_SIZE: usize = 32;
pub const NONCE_BYTE_SIZE: usize = 24;
pub const POLY1305_TAG_BYTE_SIZE: usize = 16;
pub const AUTH_KEY_SIZE: usize = 32;
pub const ED25519_SIGNATURE_SIZE: usize = 64;
pub const SALT_SIZE: usize = 16;
pub const ENCRYPTED_BUFFER_EXTRA_SIZE: usize = NONCE_BYTE_SIZE + POLY1305_TAG_BYTE_SIZE;
pub const ENCRYPTED_MASTER_KEY_SIZE: usize = XCHACHA20_KEY_SIZE + ENCRYPTED_BUFFER_EXTRA_SIZE;
pub const ENCRYPTED_FILE_CRYPT_KEY_SIZE: usize = XCHACHA20_KEY_SIZE + ENCRYPTED_BUFFER_EXTRA_SIZE;
pub const ENCRYPTED_CURVE25519_KEY_SIZE: usize = CURVE25519_KEY_SIZE + ENCRYPTED_BUFFER_EXTRA_SIZE;

// Transfers
pub const ACTIVE_DOWNLOAD_EXPIRY_TIME_MS: usize = 10000;
pub const MAX_UPLOAD_CONCURRENT_CHUNKS: usize = 4;

// File formats
pub const ENCRYPTED_FILE_MAGIC_NUMBER: [u8; 4] = [ 0x2E, 0x54, 0x45, 0x46 ];
pub const ENCRYPTED_FILE_HEADER_SIZE: usize = ENCRYPTED_FILE_MAGIC_NUMBER.len();
pub const CHUNK_MAGIC_NUMBER: [u8; 4] = [ 0x43, 0x48, 0x4E, 0x4B ];
pub const CHUNK_ID_BYTE_SIZE: usize = 4;
pub const CHUNK_DATA_SIZE: usize = 2 * 1024 * 1024; // 2 MiB
pub const ENCRYPTED_CHUNK_EXTRA_DATA_SIZE: usize = CHUNK_ID_BYTE_SIZE + NONCE_BYTE_SIZE + POLY1305_TAG_BYTE_SIZE;
pub const ENCRYPTED_CHUNK_SIZE: usize = CHUNK_DATA_SIZE + ENCRYPTED_CHUNK_EXTRA_DATA_SIZE;

// Misc.
pub const FILE_HANDLE_LENGTH: usize = 16;
pub const CLAIM_CODE_LENGTH: usize = 23;
pub const ENCRYPTED_FILE_METADATA_MAX_SIZE: usize = 1024; // In bytes
pub const MAX_FILE_SIZE: u64 = 1 * 1024 * 1024 * 1024 * 1024;
pub const TREASURY_FILE_EXTENSION: &str = ".tef";

pub const ALPHANUMERIC_CHARS: [char; 62] = [
	'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
	'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
	'0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
];

pub const LOWER_CASE_ALPHANUMERIC_CHARS: [char; 36] = [
	'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
	'0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
];
