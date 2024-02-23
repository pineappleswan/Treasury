/*
----* TREASURY ENCRYPTED FILE FORMAT *----

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
----* HOW VIDEO STREAMING WILL WORK *----

	1. ffmpeg performs hls split and generate one binary and m3u8 file with byte range requests.
	2. user uploads binary to server and stores m3u8 as special pointer file

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

// Split files into chunks when uploading.
// Videos optimised for streaming will have variable chunks sizes, so this isn't a strict value to adhere to.

const ENCRYPTED_CHUNK_DATA_SIZE = 32; // DO NOT CHANGE THIS + ENSURE IT'S NOT OVER 2.1 GB!!!
const ENCRYPTED_CHUNK_FULL_SIZE = ENCRYPTED_CHUNK_DATA_SIZE + 48; // Added bytes for storing the magic (4B), chunk id (4B), nonce (24B) and poly1305 authentication tag (16B)
const ENCRYPTED_FILE_MAGIC_NUMBER = [ 0x9B, 0x4F, 0xE7, 0x05 ];
const ENCRYPTED_CHUNK_MAGIC_NUMBER = [ 0x82, 0x7A, 0x3D, 0xE3 ];

// Returns the required file size to store a file after encryption
function getEncryptedFileSizeAndChunkCount(unencryptedFileSize) {
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

function encodeSignedIntAsFourBytes(number) {
	return [
		(number >> 24) & 255,
		(number >> 16) & 255,
		(number >> 8) & 255,
		number & 255
	];
}

function convertFourBytesToSignedInt(fourBytes) {
	return (fourBytes[0] << 24) | (fourBytes[1] << 16) | (fourBytes[2] << 8) | fourBytes[3];
}

function uint8ArrayToHexString(bytes) {
	return Array.from(bytes)
		.map((i) => i.toString(16).padStart(2, "0"))
		.join("");
}

function hexStringToUint8Array(str) {
	const bytes = [];

	for (let i = 0; i < str.length; i += 2)
		bytes.push(parseInt(str.substr(i, 2), 16));

	return new Uint8Array(bytes);
}

function createEncryptedChunkBuffer(chunkId, nonce, encryptedChunkDataWithPoly1305Tag) {
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

/*
let encoded = EncodeSignedIntAsFourBytes(1438753862);
console.log(encoded);
console.log(ConvertFourBytesToSignedInt(encoded));
*/

export {
  ENCRYPTED_CHUNK_DATA_SIZE,
	ENCRYPTED_CHUNK_FULL_SIZE,
	ENCRYPTED_FILE_MAGIC_NUMBER,
	ENCRYPTED_CHUNK_MAGIC_NUMBER,
	getEncryptedFileSizeAndChunkCount,
	uint8ArrayToHexString,
	hexStringToUint8Array,
	createEncryptedChunkBuffer,
	encodeSignedIntAsFourBytes,
	convertFourBytesToSignedInt
};
