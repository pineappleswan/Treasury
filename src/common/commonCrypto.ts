// The following code works in node.js and in the browser

import getRandomValues from "get-random-values";

function generateSecureRandomBytesAsHexString(byteLength: number) {
  const randomBuffer = new Uint8Array(byteLength);
  getRandomValues(randomBuffer);
  return Array.from(randomBuffer).map(i => i.toString(16).padStart(2, "0")).join("");
}

function generateSecureRandomAlphaNumericString(length: number) {
	const alphaNumericSet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const randomBuffer = new Uint8Array(length);
  getRandomValues(randomBuffer);
  
	let str = "";

	for (let i = 0; i < length; i++) {
    const index = randomBuffer[i] % alphaNumericSet.length;
		str += alphaNumericSet[index];
	}

	return str;
}

export {
  generateSecureRandomBytesAsHexString,
  generateSecureRandomAlphaNumericString
}
