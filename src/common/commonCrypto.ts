/*
----* TREASURY ENCRYPTED FILE FORMAT (.tef) *---- (TODO: move to documentation somewhere else)

FILE HEADER:
	1. Magic (4B -> 9B 4F E7 05)
	2. Chunk count (4B -> signed 32 bit integer) (big endian)
	3. Chunk size (4B -> signed 32 bit integer) (big endian)
	   -> (the number of bytes from the start of the magic of one chunk to the start of the magic of the next chunk)
		 -> NOTE: is not valid for the last chunk of course... last chunk's size can be calculated as distance to end of file

CHUNK
	1. Magic (4B -> 82 7A 3D E3) (verifies the beginning of a chunk)
	2. Chunk id (4B) (big endian)
	3. Nonce (24B)
	4. Encrypted data (max ~2 GB)
	5. poly1305 authentication tag (16B) 
	
*/

/*
{
	const key = crypto.randomBytes(32);
	const nonce = crypto.randomBytes(24);
	const chacha = xchacha20poly1305(key, nonce);
	const data = utf8ToBytes("greetings, friend");
	const cipherText = chacha.encrypt(data);

	//cipherText[4] = 123; // tamper with ciphertext as a test

	try {
		const plainText = chacha.decrypt(cipherText);

		console.log(cipherText);
		console.log(plainText);
	} catch (error) {
		if (error.message.includes("invalid tag")) {
				console.error("Failed to decrypt! Data was corrupted!");
		}
	}
}
*/

// TODO: less hard coding of the chunk data size variable?

// ENSURE IT'S NOT OVER 2.1 GB!!! ONLY CHANGE IF YOU KNOW WHAT YOU ARE DOING
const ENCRYPTED_CHUNK_DATA_SIZE = 2 * 1024 * 1024;

// DO NOT CHANGE THESE VALUES!!!
const ENCRYPTED_CHUNK_FULL_SIZE = ENCRYPTED_CHUNK_DATA_SIZE + 48; // Added bytes for storing the magic (4B), chunk id (4B), nonce (24B) and poly1305 authentication tag (16B)
const ENCRYPTED_FILE_MAGIC_NUMBER = [ 0x9B, 0x4F, 0xE7, 0x05 ];
const ENCRYPTED_CHUNK_MAGIC_NUMBER = [ 0x82, 0x7A, 0x3D, 0xE3 ];

// This value describes the max number of chunks that can be downloaded/uploaded in parallel
// TODO: On client, try to not create 3 requests unless upload time per chunk is so low that multiple requests need to be made to maximise upload speed.
//       This prevents the rare case where the upload speed is distributed over many requests where one chunk might take >60 seconds (or whatever the
//       threshold is) to upload, causing them to timeout
const MAX_TRANSFER_BUSY_CHUNKS = 3;

// DON'T CHANGE (TODO: need some central config or something man... idk maybe commonCrypto.ts is fine)
const PASSWORD_HASH_SETTINGS = {
	PARALLELISM: 2,
	ITERATIONS: 8,
	MEMORY_SIZE: 32 * 1024, // 32 MiB
	HASH_LENGTH: 32 // 32 bytes
};

type EncryptedFileRequirements = {
	encryptedFileSize: number,
	chunkCount: number
};

// Returns the required file size to store a file after encryption
function getEncryptedFileSizeAndChunkCount(unencryptedFileSize: number): EncryptedFileRequirements {
	let chunkCount = Math.floor(unencryptedFileSize / ENCRYPTED_CHUNK_DATA_SIZE) + 1;
	const fileHeaderSize = 12; // Magic + chunk count + chunk size
	const extraChunkSize = 48; // Magic + chunk id + nonce + poly1305 authentication tag
	
	return {
		encryptedFileSize: fileHeaderSize + (chunkCount * extraChunkSize) + unencryptedFileSize,
		chunkCount: chunkCount
	}
}

// Returns important information about stored encrypted files in the treasury's file format
// {
//		1. File is valid? (matches the magic number)
//		2. Chunk count
//		3. Chunk size
// }

/*
TODO: serverCrypto.js for this

function parseEncryptedFileStats() {


	return {
		isValid: isValid,
		chunkCount: chunkCount,
		chunkSize: chunkSize
	}
}
*/

function encodeSignedIntAsFourBytes(number: number): Array<number> {
	return [
		(number >> 24) & 255,
		(number >> 16) & 255,
		(number >> 8) & 255,
		number & 255
	];
}

function convertFourBytesToSignedInt(fourBytes: Array<number>): number {
	return (fourBytes[0] << 24) | (fourBytes[1] << 16) | (fourBytes[2] << 8) | fourBytes[3];
}

function uint8ArrayToHexString(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((i) => {
			i = i % 255; // Limit range to 0-255 (for security reasons)
			return i.toString(16).padStart(2, "0");
		})
		.join("");
}

function hexStringToUint8Array(str: string): Uint8Array {
	const bytes = [];

	for (let i = 0; i < str.length; i += 2) {
		let byte = parseInt(str.substring(i, i + 2), 16);
		byte = byte % 255; // Limit range to 0-255 (for security reasons)
		bytes.push(byte);
	}

	return new Uint8Array(bytes);
}

function createEncryptedChunkBuffer(chunkId: number, nonce: Uint8Array, encryptedChunkDataWithPoly1305Tag: Uint8Array): ArrayBuffer {
	// Allocate buffer with extra space for: magic (4B), chunk id(4B), nonce (24B)
	const buffer = new Uint8Array(encryptedChunkDataWithPoly1305Tag.byteLength + 32);

	// 1. Write magic
	buffer.set(ENCRYPTED_CHUNK_MAGIC_NUMBER, 0);
	
	// 2. Write chunk id
	const encodedChunkId = encodeSignedIntAsFourBytes(chunkId);
	buffer.set(encodedChunkId, 4);
	
	// 3. Write nonce
	buffer.set(nonce, 8);

	// 4. Write encrypted chunk data + tag
	buffer.set(encryptedChunkDataWithPoly1305Tag, 32);

	return buffer.buffer;
}

function getMasterKeyAsUint8ArrayFromLocalStorage(): Uint8Array | null {
	const masterKeyHexString = localStorage.getItem("masterKey");

	if (!masterKeyHexString) {
		console.error("masterKey not found in localStorage!");
		return null;
	}

	return hexStringToUint8Array(masterKeyHexString);
}

function setLocalStorageMasterKeyFromUint8Array(masterKeyArray: Uint8Array): void {
	const masterKeyHexString = uint8ArrayToHexString(masterKeyArray);
	localStorage.setItem("masterKey", masterKeyHexString);
}

function generateSecureRandomHexString(byteLength: number): string {
  let buffer = new Uint8Array(byteLength);
  window.crypto.getRandomValues(buffer);
  
  return Array.from(buffer).map(i => i.toString(16).padStart(2, "0")).join("");
}

// TODO: this isnt really a crypto class but whatever i guess
function containsOnlyAlphaNumericCharacters(str: string): boolean {
	const len = str.length;

	for (let i = 0; i < len; i++) {
		const character = str.charAt(i);
		const code = character.charCodeAt(0);
		const isAlphaNumeric = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
	
		if (!isAlphaNumeric) {
			return false;
		}
	}

	return true;
}

export {
  ENCRYPTED_CHUNK_DATA_SIZE,
	ENCRYPTED_CHUNK_FULL_SIZE,
	ENCRYPTED_FILE_MAGIC_NUMBER,
	ENCRYPTED_CHUNK_MAGIC_NUMBER,
	MAX_TRANSFER_BUSY_CHUNKS,
	PASSWORD_HASH_SETTINGS,
	getEncryptedFileSizeAndChunkCount,
	uint8ArrayToHexString,
	hexStringToUint8Array,
	createEncryptedChunkBuffer,
	encodeSignedIntAsFourBytes,
	convertFourBytesToSignedInt,
	getMasterKeyAsUint8ArrayFromLocalStorage,
	setLocalStorageMasterKeyFromUint8Array,
	generateSecureRandomHexString,
	containsOnlyAlphaNumericCharacters
};
