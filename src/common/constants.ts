// ------------------------------------
// WARNING
//  - If you don't know what you are doing, don't touch any settings here. Thank you.
//  - If you change any values while users have used your treasury instance, there will be problems.
// ------------------------------------

// TODO: larger chunk size like 4 MB or 8 MB so really fast downloads wont be throttled due to ping delays even with parallel download/upload chunk processes
// TODO: master key length constant

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

  // Constants for the client
  FILE_METADATA_OBFUSCATE_PADDING: 32, // In bytes. Used for obfuscating the exact length of the metadata json for security reasons
  PROGRESS_CALLBACK_HANDLE_LENGTH: 16, // How many alphanumeric characters

  // Constants for the server
  CLAIM_ACCOUNT_CODE_LENGTH: 20, // How many alphanumeric characters
  FILE_HANDLE_LENGTH: 32, // How many alphanumeric characters
  USER_DATA_SALT_BYTE_LENGTH: 32, // How many random bytes
  BUFFERED_CHUNK_WRITE_RETRY_TIMEOUT_MS: 60 * 1000, // When chunks are being buffered during upload, limit the time spent buffering...
  BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS: 100, // Retry every ... ms

  // Shared constants
  ENCRYPTED_FILE_MAGIC_NUMBER: [ 0x2E, 0x54, 0x45, 0x46 ], // MUST BE 4 NUMBERS EXACTLY!!! (due to hardcoded values elsewhere)
  CHUNK_MAGIC_NUMBER: [ 0x82, 0x7A, 0x3D, 0xE3 ], // (exact same requirements as above)

  ENCRYPTED_FILE_NAME_EXTENSION: ".tef",
  ENCRYPTED_FILE_HEADER_SIZE: 4, // Magic (4B)
  CHUNK_DATA_SIZE: 2 * 1024 * 1024, // In bytes
  CHUNK_EXTRA_DATA_SIZE: 48, // Added bytes for storing the magic (4B), chunk id (4B), nonce (24B) and poly1305 authentication tag (16B)
  CHUNK_FULL_SIZE: 0, // Calculated below...

  NONCE_LENGTH: 24, // In bytes
  POLY1305_LENGTH: 16, // In bytes

  MAX_SIGNED_32_BIT_INTEGER: 2147483647,

  // Related to transfers
  MAX_TRANSFER_PARALLEL_CHUNKS: 3, // How many chunks can be transferred in parallel for each file transfer
  MAX_PARALLEL_UPLOADS: 8,
  MAX_PARALLEL_DOWNLOADS: 8,

  // Other
  ENCRYPTED_FILE_METADATA_MAX_SIZE: 1024, // In bytes
  ENCRYPTED_CRYPT_KEY_SIZE: 72, // Nonce (24B) + Key (32B) + poly1305 tag (16B)
  MAX_FILE_NAME_SIZE: 500, // In characters
  
};

// Calculate this constant
CONSTANTS.CHUNK_FULL_SIZE = CONSTANTS.CHUNK_DATA_SIZE + CONSTANTS.CHUNK_EXTRA_DATA_SIZE;

export default CONSTANTS;
