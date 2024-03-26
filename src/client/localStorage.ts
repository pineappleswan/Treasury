import base64js from "base64-js";
import CONSTANTS from "../common/constants";

type LocalStorageKeypairInfo = {
	ed25519PrivateKey: Uint8Array,
	ed25519PublicKey: Uint8Array,
	x25519PrivateKey: Uint8Array,
	x25519PublicKey: Uint8Array
}

function setLocalStorageMasterKey(masterKeyArray: Uint8Array): void {
	const masterKeyB64 = base64js.fromByteArray(masterKeyArray);
	localStorage.setItem("masterKey", masterKeyB64);
}

function getMasterKeyFromLocalStorage(): Uint8Array | undefined {
	const masterKeyB64 = localStorage.getItem("masterKey");

	if (!masterKeyB64) {
		console.error("masterKey not found in localStorage!");
		return;
	}

	const masterKey = base64js.toByteArray(masterKeyB64);
  const requiredLength = CONSTANTS.PASSWORD_HASH_SETTINGS.HASH_LENGTH;

  if (masterKey.byteLength != requiredLength) {
    throw new Error(`masterkey bytelength is incorrect!`);
  }

	return masterKey;
}

function setLocalStorageKeypairs(info: LocalStorageKeypairInfo): void {
	if (info.ed25519PrivateKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
		throw new Error(`ed25519PrivateKey byte length is incorrect!`);

	if (info.ed25519PublicKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
		throw new Error(`ed25519PublicKey byte length is incorrect!`);

	if (info.x25519PrivateKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
		throw new Error(`x25519PrivateKey byte length is incorrect!`);

	if (info.x25519PublicKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
		throw new Error(`x25519PublicKey byte length is incorrect!`);

	const ed25519PrivateKeyB64 = base64js.fromByteArray(info.ed25519PrivateKey);
	const ed25519PublicKeyB64 = base64js.fromByteArray(info.ed25519PublicKey);
	const x25519PrivateKeyB64 = base64js.fromByteArray(info.x25519PrivateKey);
	const x25519PublicKeyB64 = base64js.fromByteArray(info.x25519PublicKey);
	
	localStorage.setItem("ed25519PrivateKey", ed25519PrivateKeyB64);
	localStorage.setItem("ed25519PublicKey", ed25519PublicKeyB64);
	localStorage.setItem("x25519PrivateKey", x25519PrivateKeyB64);
	localStorage.setItem("x25519PublicKey", x25519PublicKeyB64);
}

function getLocalStorageKeypairs(): LocalStorageKeypairInfo | undefined {
	const ed25519PrivateKeyB64 = localStorage.getItem("ed25519PrivateKey");
	const ed25519PublicKeyB64 = localStorage.getItem("ed25519PublicKey");
	const x25519PrivateKeyB64 = localStorage.getItem("x25519PrivateKey");
	const x25519PublicKeyB64 = localStorage.getItem("x25519PublicKey");

	if (!ed25519PrivateKeyB64 || !ed25519PublicKeyB64 || !x25519PrivateKeyB64 || !x25519PublicKeyB64) {
		return;
	}

	const ed25519PrivateKey = base64js.toByteArray(ed25519PrivateKeyB64);
	const ed25519PublicKey = base64js.toByteArray(ed25519PublicKeyB64);
	const x25519PrivateKey = base64js.toByteArray(x25519PrivateKeyB64);
	const x25519PublicKey = base64js.toByteArray(x25519PublicKeyB64);

	if (ed25519PrivateKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
		throw new Error(`ed25519PrivateKey byte length is incorrect!`);

	if (ed25519PublicKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
		throw new Error(`ed25519PublicKey byte length is incorrect!`);

	if (x25519PrivateKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
		throw new Error(`x25519PrivateKey byte length is incorrect!`);

	if (x25519PublicKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
		throw new Error(`x25519PublicKey byte length is incorrect!`);

	const info: LocalStorageKeypairInfo = {
		ed25519PrivateKey: ed25519PrivateKey,
		ed25519PublicKey: ed25519PublicKey,
		x25519PrivateKey: x25519PrivateKey,
		x25519PublicKey: x25519PublicKey,
	};

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

export {
  getMasterKeyFromLocalStorage,
  setLocalStorageMasterKey,
	setLocalStorageKeypairs,
	getLocalStorageKeypairs,
	clearLocalStorageAuthenticationData
}
