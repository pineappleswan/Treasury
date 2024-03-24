import { padStringToMatchBlockSizeInBytes } from "../common/commonUtils";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/crypto";
import { FileMetadata, createFileMetadataJsonString } from "./userFilesystem";
import CONSTANTS from "../common/constants";

// Automatically pads the metadata to meet the obfuscation block size requirement
function createEncryptedFileMetadata(metadata: FileMetadata, masterKey: Uint8Array): Uint8Array {
	// Create metadata json object
	let fileMetadataJsonStr = createFileMetadataJsonString(metadata);

	// Pad json string for obfuscation reasons
	fileMetadataJsonStr = padStringToMatchBlockSizeInBytes(fileMetadataJsonStr, " ", CONSTANTS.FILE_METADATA_OBFUSCATE_PADDING);

	// Convert to Uint8Array
	const textEncoder = new TextEncoder();
	const fileMetadata = textEncoder.encode(fileMetadataJsonStr);

	// Encrypt
	const encFileMetadata = new Uint8Array(fileMetadata.byteLength + 40); // + 24 for nonce + 16 for poly1305 tag

	const nonce = randomBytes(24); // 192 bit
	const chacha = xchacha20poly1305(masterKey, nonce);
	const encData = chacha.encrypt(fileMetadata);
	encFileMetadata.set(nonce, 0); // Append nonce
	encFileMetadata.set(encData, 24); // Append encrypted data with poly1305 tag

	return encFileMetadata;
}

function encryptFileCryptKey(fileCryptKey: Uint8Array, masterKey: Uint8Array): Uint8Array {
	const encFileCryptKey = new Uint8Array(CONSTANTS.ENCRYPTED_CRYPT_KEY_SIZE);

	const nonce = randomBytes(24); // 192 bit
	const chacha = xchacha20poly1305(masterKey, nonce);
	const encKey = chacha.encrypt(fileCryptKey);
	encFileCryptKey.set(nonce, 0); // Append nonce
	encFileCryptKey.set(encKey, 24); // Append encrypted file key with poly1305 tag

	return encFileCryptKey;
}

function decryptFileMetadataAsJsonObject(encryptedMetadata: Uint8Array, masterKey: Uint8Array): FileMetadata {
	const nonce = encryptedMetadata.slice(0, 24);
	const encData = encryptedMetadata.slice(24);
	const chacha = xchacha20poly1305(masterKey, nonce);
	const decData = chacha.decrypt(encData);

	// Convert to string
	const textDecoder = new TextDecoder();
	const str = textDecoder.decode(decData).trim(); // Trim because of the obfuscation padding

	// Parse JSON
	const json = JSON.parse(str);
	const fileName = json.fn as string;
	const isFolder = json.if as boolean;

	return {
		parentHandle: json.ph,
		fileName: fileName.trim(), // Must be trimmed due to padding spaces in the file name used for obfuscation
		dateAdded: json.da,
		isFolder: isFolder
	};
}

function decryptEncryptedFileCryptKey(encryptedCryptKey: Uint8Array, masterKey: Uint8Array): Uint8Array {
	const nonce = encryptedCryptKey.slice(0, 24);
	const encData = encryptedCryptKey.slice(24);
	const chacha = xchacha20poly1305(masterKey, nonce);
	const fileCryptKey = chacha.decrypt(encData);

	return fileCryptKey;
}

function encryptRawChunkBuffer(rawChunkBuffer: Uint8Array, fileCryptKey: Uint8Array): Uint8Array {
	const nonce = randomBytes(24);
	const chacha = xchacha20poly1305(fileCryptKey, nonce);
	const encryptedBufferWithTag = chacha.encrypt(rawChunkBuffer);

	const fullChunk = new Uint8Array(rawChunkBuffer.byteLength + 40); // nonce + poly1305 auth tag
	fullChunk.set(nonce, 0); // Add nonce
	fullChunk.set(encryptedBufferWithTag, 24); // Add data

	return fullChunk;
}

export type {
	FileMetadata
}

export {
	createFileMetadataJsonString,
	createEncryptedFileMetadata,
	encryptFileCryptKey,
	decryptFileMetadataAsJsonObject,
	decryptEncryptedFileCryptKey,
	encryptRawChunkBuffer
}
