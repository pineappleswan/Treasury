import { hexStringToUint8Array, uint8ArrayToHexString } from "../common/commonUtils";
import CONSTANTS from "../common/constants";

function getMasterKeyAsUint8ArrayFromLocalStorage(): Uint8Array | undefined {
	const masterKeyHexString = localStorage.getItem("masterKey");

	if (!masterKeyHexString) {
		console.error("masterKey not found in localStorage!");
		return undefined;
	}

	const bytes = hexStringToUint8Array(masterKeyHexString);
  const requiredLength = CONSTANTS.PASSWORD_HASH_SETTINGS.HASH_LENGTH;

  if (bytes.byteLength != requiredLength) {
    console.error(`masterkey bytelength is ${bytes.byteLength} which doesn't match the constant's password hash settings hash length of ${requiredLength}!`);
  }

	// TODO: check if 32 bytes aka 256 bits? with CONSTANTS?

	return bytes;
}

function setLocalStorageMasterKeyFromUint8Array(masterKeyArray: Uint8Array): void {
	const masterKeyHexString = uint8ArrayToHexString(masterKeyArray);
	localStorage.setItem("masterKey", masterKeyHexString);
}

export {
  getMasterKeyAsUint8ArrayFromLocalStorage,
  setLocalStorageMasterKeyFromUint8Array
}
