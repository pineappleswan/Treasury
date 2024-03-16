import { hexStringToUint8Array, padStringToMatchBlockSizeInBytes, uint8ArrayToHexString } from "./commonUtils";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/crypto";
import CONSTANTS from "./constants";

type FileMetadata = {
	parentHandle: string,
	fileName: string,
	dateAdded: number, // UTC time in seconds
	isFolder: boolean
};

function getMasterKeyAsUint8ArrayFromLocalStorage(): Uint8Array | null {
	const masterKeyHexString = localStorage.getItem("masterKey");

	if (!masterKeyHexString) {
		console.error("masterKey not found in localStorage!");
		return null;
	}

	const bytes = hexStringToUint8Array(masterKeyHexString);

	// TODO: check if 32 bytes aka 256 bits? with CONSTANTS?

	return bytes;
}

function setLocalStorageMasterKeyFromUint8Array(masterKeyArray: Uint8Array): void {
	const masterKeyHexString = uint8ArrayToHexString(masterKeyArray);
	localStorage.setItem("masterKey", masterKeyHexString);
}

function createFileMetadataJsonString(metadata: FileMetadata): string {
	// Smaller keys to save space
	return JSON.stringify({
		ph: metadata.parentHandle,
		fn: metadata.fileName,
		da: metadata.dateAdded,
		if: metadata.isFolder
	});
}

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

export type {
	FileMetadata
}

export {
  getMasterKeyAsUint8ArrayFromLocalStorage,
  setLocalStorageMasterKeyFromUint8Array,
	createFileMetadataJsonString,
	createEncryptedFileMetadata,
	encryptFileCryptKey,
	decryptFileMetadataAsJsonObject,
	decryptEncryptedFileCryptKey
}
