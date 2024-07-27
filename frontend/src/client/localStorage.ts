import base64js from "base64-js";
import CONSTANTS from "./constants";

type UserLocalCryptoInfo = {
  masterKey: Uint8Array;
  ed25519PrivateKey: Uint8Array;
  ed25519PublicKey: Uint8Array;
  x25519PrivateKey: Uint8Array;
  x25519PublicKey: Uint8Array;
}

/**
 * Sets the user crypto info in the browser's session storage.
 * @param info The crypto info to set
 */
function setLocalUserCryptoInfo(info: UserLocalCryptoInfo) {
  const setValueAsB64 = (key: string, value: Uint8Array, expectedLength: number) => {
    if (value.byteLength != expectedLength) {
      console.error(`CRITICAL: Incorrect length provided when setting local storage user crypto for key: ${key} with array length: ${value.byteLength} when expected length was: ${expectedLength}`);
      return;
    }

    const b64 = base64js.fromByteArray(value);
    sessionStorage.setItem(key, b64);
  }

  const masterKeyLength = CONSTANTS.XCHACHA20_KEY_LENGTH;
  const curve25519KeyLength = CONSTANTS.CURVE25519_KEY_BYTE_LENGTH;
  
  setValueAsB64("masterKey", info.masterKey, masterKeyLength);
  setValueAsB64("ed25519PrivateKey", info.ed25519PrivateKey, curve25519KeyLength);
  setValueAsB64("ed25519PublicKey", info.ed25519PublicKey, curve25519KeyLength);
  setValueAsB64("x25519PrivateKey", info.x25519PrivateKey, curve25519KeyLength);
  setValueAsB64("x25519PublicKey", info.x25519PublicKey, curve25519KeyLength);
}

/**
 * Gets the local user crypto info stored in the brower's session storage.
 * @returns The local user crypto info or **null** if it either doesn't exist or an error occurred.
 */
function getLocalUserCryptoInfo(): UserLocalCryptoInfo | null {
  const getB64Value = (key: string, expectedLength: number) => {
    const b64 = sessionStorage.getItem(key);

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

/**
 * Clears the local user crypto info stored in in the browser's session storage.
 */
function clearLocalUserCryptoInfo() {
  sessionStorage.removeItem("masterKey");
  sessionStorage.removeItem("ed25519PrivateKey");
  sessionStorage.removeItem("ed25519PublicKey");
  sessionStorage.removeItem("x25519PrivateKey");
  sessionStorage.removeItem("x25519PublicKey");
}

export type {
  UserLocalCryptoInfo
}

export {
  setLocalUserCryptoInfo,
  getLocalUserCryptoInfo,
  clearLocalUserCryptoInfo
}
