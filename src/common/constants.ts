const CONSTANTS = {
  // Account creation constraints
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 20,
  MAX_PASSWORD_LENGTH: 200,

  PASSWORD_HASH_SETTINGS: {
    PARALLELISM: 2,
    ITERATIONS: 8,
    MEMORY_SIZE: 32 * 1024, // 32 MiB
    HASH_LENGTH: 32 // 32 bytes
  },

  // Constants for the server
  CLAIM_ACCOUNT_CODE_LENGTH: 20,
  FILE_HANDLE_LENGTH: 32,
  USER_DATA_SALT_LENGTH: 32,
  BUFFERED_CHUNK_WRITE_RETRY_TIMEOUT_MS: 60 * 1000, // When chunks are being buffered during upload, limit the time spent buffering...
  BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS: 50, // Retry every ... ms

  // Shared constants
  ENCRYPTED_CHUNK_DATA_SIZE: 2 * 1024 * 1024,
  ENCRYPTED_CHUNK_EXTRA_DATA_SIZE: 48, // Added bytes for storing the magic (4B), chunk id (4B), nonce (24B) and poly1305 authentication tag (16B)
  ENCRYPTED_CHUNK_FULL_SIZE: 0, 
  ENCRYPTED_FILE_MAGIC_NUMBER: [ 0x9B, 0x4F, 0xE7, 0x05 ],
  ENCRYPTED_CHUNK_MAGIC_NUMBER: [ 0x82, 0x7A, 0x3D, 0xE3 ],
  MAX_TRANSFER_BUSY_CHUNKS: 3,
};

// Calculate this constant
CONSTANTS.ENCRYPTED_CHUNK_FULL_SIZE = CONSTANTS.ENCRYPTED_CHUNK_DATA_SIZE + CONSTANTS.ENCRYPTED_CHUNK_EXTRA_DATA_SIZE;

export default CONSTANTS;
