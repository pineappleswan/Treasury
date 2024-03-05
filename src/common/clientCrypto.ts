import { hexStringToUint8Array, uint8ArrayToHexString } from "./common";

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

function generateSecureRandomBytesAsHexString(byteLength: number): string {
  let buffer = new Uint8Array(byteLength);
  window.crypto.getRandomValues(buffer);
  
  return Array.from(buffer).map(i => i.toString(16).padStart(2, "0")).join("");
}

export {
  getMasterKeyAsUint8ArrayFromLocalStorage,
  setLocalStorageMasterKeyFromUint8Array,
  generateSecureRandomBytesAsHexString
}
