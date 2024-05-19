// ------------------------------------
// WARNING
//  - If you don't know what you are doing, don't touch any settings here. Thank you.
//  - If you change any values while users have used your treasury instance, there will likely be problems.
// ------------------------------------

const CONSTANTS = {
	// Account creation constraints
	MIN_USERNAME_LENGTH: 3,
	MAX_USERNAME_LENGTH: 20,
	MAX_PASSWORD_LENGTH: 128,

	PASSWORD_HASH_SETTINGS: {
		PARALLELISM: 2,
		ITERATIONS: 8,
		MEMORY_SIZE: 32 * 1024, // 32 MiB
		HASH_LENGTH: 32 // 32 bytes (note: it's the same as XCHACHA20_KEY_LENGTH for key derivation purposes)
	},

	// Constants for the client
	FILE_METADATA_OBFUSCATE_PADDING: 32, // In bytes. Used for obfuscating the exact length of the metadata json for security reasons
	PROGRESS_CALLBACK_HANDLE_LENGTH: 16, // How many alphanumeric characters
	ROOT_DIRECTORY_HANDLE: "", // Set below...
	CHUNK_HASH_BYTE_LENGTH: 32, // The byte length of the blake3 hash for individual chunks used to create file signatures

	THUMBNAIL_SIZE: 160,
	THUMBNAILS_DATABASE_NAME: "thumbnails",
	THUMBNAILS_DATABASE_CLOSE_TIMEOUT_MS: 2500, // Time before the thumbnails database on the client automatically closes due to inactivity

	// Constants for the server
	FILE_HANDLE_LENGTH: 16, // How many alphanumeric characters
	CLAIM_ACCOUNT_CODE_LENGTH: 20, // How many alphanumeric characters
	USER_DATA_SALT_BYTE_LENGTH: 32, // How many random bytes
	DOWNLOAD_ENTRY_EXPIRE_TIME_MS: 15000, // How many milliseconds before a download entry is deleted and its file handle is closed due to inactivity
	SERVER_SECRET_BYTE_LENGTH: 64, // 512 bit

	// Shared constants
	ENCRYPTED_FILE_MAGIC_NUMBER: [ 0x2E, 0x54, 0x45, 0x46 ],
	CHUNK_MAGIC_NUMBER: [ 0x43, 0x48, 0x4E, 0x4B ],
	MAX_SIGNED_32_BIT_INTEGER: 2147483647,

	MAX_FILE_SIZE: 1 * 1024 * 1024 * 1024 * 1024, // Maximum file size for one single uploaded file

	ENCRYPTED_FILE_NAME_EXTENSION: ".tef", // The extension for the encrypted files stored on the server
	ENCRYPTED_FILE_HEADER_SIZE: 4, // Consists of: Magic number (4B)
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
	MIN_UPLOAD_CONCURRENT_CHUNKS: 1, // Minimum number of chunks to be uploaded in concurrent for each file transfer
	MAX_UPLOAD_CONCURRENT_CHUNKS: 4, // Same as above but is the maximum
	
	MAX_DOWNLOAD_CONCURRENT_CHUNKS: 5, // Maximum number of concurrent chunks to be downloaded in concurrent for each file transfer (note: no. of concurrent chunks depends on user's upload speed for the file)
	TARGET_CONCURRENT_UPLOADS_COUNT: 4, // How many concurrent uploads the client will try to perform if possible when uploading files to the server
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
CONSTANTS.CHUNK_FULL_SIZE = CONSTANTS.CHUNK_DATA_SIZE + CONSTANTS.CHUNK_EXTRA_DATA_SIZE;
CONSTANTS.ENCRYPTED_CURVE25519_KEY_BYTE_LENGTH = CONSTANTS.NONCE_BYTE_LENGTH + CONSTANTS.CURVE25519_KEY_BYTE_LENGTH + CONSTANTS.POLY1305_TAG_BYTE_LENGTH;

// Magic number, chunk id (4B), nonce (24B) and poly1305 authentication tag (16B)
CONSTANTS.CHUNK_EXTRA_DATA_SIZE = CONSTANTS.CHUNK_MAGIC_NUMBER.length + 4 + CONSTANTS.NONCE_BYTE_LENGTH + CONSTANTS.POLY1305_TAG_BYTE_LENGTH;

// The root directory handle doesn't point to an actual file/folder. It is purely symbolic.
// It consists of a string FILE_HANDLE_LENGTH long, where every character is an ASCII zero (i.e. '0').
CONSTANTS.ROOT_DIRECTORY_HANDLE = "0".repeat(CONSTANTS.FILE_HANDLE_LENGTH);

export default CONSTANTS;
