import { hexStringToUint8Array, uint8ArrayToHexString } from "./common";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";

type EncryptedFileMetadataInfo = {
  parentHandle: string,
  fileName: string,
  dateAdded: number,
  fileType: string
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

function generateSecureRandomBytesAsHexString(byteLength: number): string {
  let buffer = new Uint8Array(byteLength);
  window.crypto.getRandomValues(buffer);

  return Array.from(buffer).map(i => i.toString(16).padStart(2, "0")).join("");
}

function createFileMetadataJsonString(parentHandle: string, fileName: string, dateAdded: number, fileType: string): string {
	return JSON.stringify({
		ph: parentHandle,
		fn: fileName,
		da: dateAdded,
		ft: fileType
	});
}

// Next two functions should be put in a try-catch body in case they throw
function decryptFileMetadataJsonString(encryptedMetadata: Uint8Array, masterKey: Uint8Array): Uint8Array {
	const nonce = encryptedMetadata.slice(0, 24);
	const encData = encryptedMetadata.slice(24);
	const chacha = xchacha20poly1305(masterKey, nonce);
	const decData = chacha.decrypt(encData);

	return decData;
}

function decryptEncryptedFileCryptKey(encryptedCryptKey: Uint8Array, masterKey: Uint8Array): Uint8Array {
	const nonce = encryptedCryptKey.slice(0, 24);
	const encData = encryptedCryptKey.slice(24);
	const chacha = xchacha20poly1305(masterKey, nonce);
	const fileCryptKey = chacha.decrypt(encData);

	return fileCryptKey;
}

export type {
	EncryptedFileMetadataInfo
}

export {
  getMasterKeyAsUint8ArrayFromLocalStorage,
  setLocalStorageMasterKeyFromUint8Array,
  generateSecureRandomBytesAsHexString,
	createFileMetadataJsonString,
	decryptFileMetadataJsonString,
	decryptEncryptedFileCryptKey
}
