// ------------------------------------
// WARNING
//  - If you don't know what you are doing, don't touch any settings here. Thank you.
//  - If you change any values while users have used your treasury instance, there will likely be problems.
// ------------------------------------

const CONSTANTS = {
  // Account related
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 20,
  MAX_PASSWORD_LENGTH: 128,
  TWO_FACTOR_AUTH_CODE_LENGTH: 6,

  ARGON2_SETTINGS: {
    PARALLELISM: 1,
    ITERATIONS: 3,
    MEMORY_SIZE: 12 * 1024 // In KiB so this is 12 MiB
  },

  /** Number of bytes used for obfuscating the exact length of the metadata json for security reasons. */
  FILE_METADATA_OBFUSCATE_PADDING: 16,
  
  /** The number of alphanumeric characters the progress callback handle will be comprised of. */
  PROGRESS_CALLBACK_HANDLE_LENGTH: 16,
  ROOT_DIRECTORY_HANDLE: "", // Set below...
  
  THUMBNAIL_SIZE: 160,
  THUMBNAILS_DATABASE_NAME: "thumbnails",

  // Time before the thumbnails database on the client automatically closes due to inactivity.
  THUMBNAILS_DATABASE_CLOSE_TIMEOUT_MS: 2500,

  // Time window in milliseconds where two consecutive clicks are considered a double click.
  DOUBLE_CLICK_TIME_THRESHOLD_MS: 500,

  // When the width of the window is smaller than this value, the frontend will switch to mobile 
  // mode if the conditions are right (such as touch is enabled, etc.)
  SMALL_SCREEN_WIDTH_THRESHOLD: 700,

  FILE_HANDLE_LENGTH: 16,
  CLAIM_ACCOUNT_CODE_LENGTH: 23,
  USER_AUTH_HASH_SALT_SIZE: 16, // How many random bytes

  MAX_SIGNED_32_BIT_INTEGER: 2147483647,

  // ENCRYPTED_FILE_HEADER_SIZE: 4, // Consists of: Magic number (4B)
  CHUNK_DATA_SIZE: 2 * 1024 * 1024, // In bytes
  CHUNK_EXTRA_DATA_SIZE: 0, // Calculated below...
  CHUNK_FULL_SIZE: 0, // Calculated below...

  XCHACHA20_KEY_LENGTH: 32, // 256 bit
  NONCE_BYTE_LENGTH: 24, // 192 bit
  POLY1305_TAG_BYTE_LENGTH: 16, // 128 bit
  CURVE25519_KEY_BYTE_LENGTH: 32, // 256 bit
  ED25519_SIGNATURE_BYTE_LENGTH: 64, // 512 bit
  ENCRYPTED_CURVE25519_KEY_BYTE_LENGTH: 0, // Calculated below...

  MAX_USER_SETTINGS_ENCRYPTED_BLOB_SIZE: 8 * 1024, // 8 KiB (should be plenty because user settings are encrypted compressed jsons and there aren't that many user settings.)

  // Related to transfers
  MAX_UPLOAD_CONCURRENT_CHUNKS: 4, // Maximum number of chunks that can be uploaded to the server concurrently.
  MAX_DOWNLOAD_CONCURRENT_CHUNKS: 5, // Maximum number of chunks that can be downloaded concurrently for each file transfer.
  TARGET_CONCURRENT_UPLOADS_COUNT: 10, // How many concurrent uploads the client will try to perform if possible when uploading files to the server
  CONCURRENT_CHUNK_TRANSFER_SPEED_INCREMENT: 5000000, // Bytes per second speed required to add another concurrent chunk (TODO: explain better)
  
  // All file extensions that are viewable in the media viewer
  MEDIA_VIEWER_VIEWABLE_EXTENSIONS: [
    // Images
    "jpg", "jpeg", "jfif", "jfi", "jpe", "jif",
    "png",
    "bmp",
    "gif",
    "webp",
  
    // Audio
    "mp3", "m4a", "flac", "ogg", "wav"
  ],

  // All file extensions where a thumbnail will automatically be generated for
  THUMBNAIL_GENERATION_EXTENSIONS: [
    "jpg", "jpeg", "jfif", "jfi", "jpe", "jif",
    "png",
    "bmp",
    "gif",
    "webp"
  ],

  // Other
  ENCRYPTED_FILE_METADATA_MAX_SIZE: 1024, // In bytes
  ENCRYPTED_CRYPT_KEY_SIZE: 72, // Nonce (24B) + Key (32B) + poly1305 tag (16B)
  MAX_FILE_NAME_SIZE: 500, // In characters (should ideally be approximately half of the max encrypted file metadata size)
};

// Calculate some constants

// Chunk id (4B), nonce (24B) and poly1305 authentication tag (16B)
CONSTANTS.CHUNK_EXTRA_DATA_SIZE = 4 + CONSTANTS.NONCE_BYTE_LENGTH + CONSTANTS.POLY1305_TAG_BYTE_LENGTH;

CONSTANTS.ENCRYPTED_CURVE25519_KEY_BYTE_LENGTH = CONSTANTS.NONCE_BYTE_LENGTH + CONSTANTS.CURVE25519_KEY_BYTE_LENGTH + CONSTANTS.POLY1305_TAG_BYTE_LENGTH;
CONSTANTS.CHUNK_FULL_SIZE = CONSTANTS.CHUNK_DATA_SIZE + CONSTANTS.CHUNK_EXTRA_DATA_SIZE;

// The root directory handle doesn't point to an actual file/folder. It is purely symbolic.
// It consists of a string FILE_HANDLE_LENGTH long, where every character is an ASCII zero (i.e. '0').
CONSTANTS.ROOT_DIRECTORY_HANDLE = "0".repeat(CONSTANTS.FILE_HANDLE_LENGTH);

export default CONSTANTS;
