// Username constraints
pub const MIN_USERNAME_LENGTH: usize = 3;
pub const MAX_USERNAME_LENGTH: usize = 20;

// Argon2 settings
pub const ARGON2_PARALLELISM: usize = 1;
pub const ARGON2_ITERATIONS: usize = 3;
pub const ARGON2_MEMORY_SIZE: usize = 12288;
pub const ARGON2_OUTPUT_SIZE: usize = 32;

// Sessions
pub const SESSION_USER_ID_KEY: &str = "user_id";
pub const NOT_LOGGED_IN_USER_ID: isize = -1;

// Crypto length constants
pub const XCHACHA20_KEY_SIZE: usize = 32;
pub const CURVE25519_KEY_SIZE: usize = 32;
pub const AUTH_KEY_SIZE: usize = 32;
pub const ED25519_SIGNATURE_SIZE: u32 = 64;
pub const SALT_SIZE: usize = 32;
pub const CLAIM_CODE_LENGTH: usize = 20;
pub const ENCRYPTED_BUFFER_EXTRA_SIZE: usize = 40; // XChaCha20-Poly1305 nonce + poly1305 auth tag length
pub const ENCRYPTED_MASTER_KEY_SIZE: usize = XCHACHA20_KEY_SIZE + ENCRYPTED_BUFFER_EXTRA_SIZE;
pub const ENCRYPTED_CURVE25519_KEY_SIZE: usize = CURVE25519_KEY_SIZE + ENCRYPTED_BUFFER_EXTRA_SIZE;

// Misc.
pub const ALPHANUMERIC_CHARS: [char; 62] = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
];
