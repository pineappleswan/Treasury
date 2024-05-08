import base64js from "base64-js";
import CONSTANTS from "../common/constants";

type UserLocalCryptoInfo = {
	masterKey: Uint8Array;
	ed25519PrivateKey: Uint8Array;
	ed25519PublicKey: Uint8Array;
	x25519PrivateKey: Uint8Array;
	x25519PublicKey: Uint8Array;
}

function setLocalStorageUserCryptoInfo(info: UserLocalCryptoInfo) {
	const setValueAsB64 = (key: string, value: Uint8Array, expectedLength: number) => {
		if (value.byteLength != expectedLength) {
			console.error(`CRITICAL: Incorrect length provided when setting local storage user crypto for key: ${key} with array length: ${value.byteLength} when expected length was: ${expectedLength}`);
			return;
		}

		const b64 = base64js.fromByteArray(value);
		localStorage.setItem(key, b64);
	}

	const masterKeyLength = CONSTANTS.XCHACHA20_KEY_LENGTH;
	const curve25519KeyLength = CONSTANTS.CURVE25519_KEY_BYTE_LENGTH;
	
	setValueAsB64("masterKey", info.masterKey, masterKeyLength);
	setValueAsB64("ed25519PrivateKey", info.ed25519PrivateKey, curve25519KeyLength);
	setValueAsB64("ed25519PublicKey", info.ed25519PublicKey, curve25519KeyLength);
	setValueAsB64("x25519PrivateKey", info.x25519PrivateKey, curve25519KeyLength);
	setValueAsB64("x25519PublicKey", info.x25519PublicKey, curve25519KeyLength);
}

function getLocalStorageUserCryptoInfo(): UserLocalCryptoInfo | null {
	const getB64Value = (key: string, expectedLength: number) => {
		const b64 = localStorage.getItem(key);

		if (!b64) {
			console.error(`Failed to get item from local storage with key: ${key}`);
			return null;
		}

		const data = base64js.toByteArray(b64);
		
		if (data.byteLength != expectedLength) {
			console.error(`CRITICAL: Expected length mismatch with key: ${key} that has byte length of: ${data.byteLength} but expected length was: ${expectedLength}`);
			return null;
		}

		return data;
	}

	const masterKeyLength = CONSTANTS.XCHACHA20_KEY_LENGTH;
	const curve25519KeyLength = CONSTANTS.CURVE25519_KEY_BYTE_LENGTH;

	const masterKey = getB64Value("masterKey", masterKeyLength);
	const ed25519PrivateKey = getB64Value("ed25519PrivateKey", curve25519KeyLength);
	const ed25519PublicKey = getB64Value("ed25519PublicKey", curve25519KeyLength);
	const x25519PrivateKey = getB64Value("x25519PrivateKey", curve25519KeyLength);
	const x25519PublicKey = getB64Value("x25519PublicKey", curve25519KeyLength);

	// If any property is null, then return null
	if (!masterKey || !ed25519PrivateKey || !ed25519PublicKey || !x25519PrivateKey || !x25519PublicKey) {
		return null;
	}
	
	const info: UserLocalCryptoInfo = {
		masterKey: masterKey,
		ed25519PrivateKey: ed25519PrivateKey,
		ed25519PublicKey: ed25519PublicKey,
		x25519PrivateKey: x25519PrivateKey,
		x25519PublicKey: x25519PublicKey
	}

	return info;
}

// Deletes the master key and key pair information
function clearLocalStorageAuthenticationData() {
	localStorage.removeItem("masterKey");
	localStorage.removeItem("ed25519PrivateKey");
	localStorage.removeItem("ed25519PublicKey");
	localStorage.removeItem("x25519PrivateKey");
	localStorage.removeItem("x25519PublicKey");
}

export type {
	UserLocalCryptoInfo
}

export {
	setLocalStorageUserCryptoInfo,
	getLocalStorageUserCryptoInfo,
	clearLocalStorageAuthenticationData
}
