import {
	getEncryptedFileSizeAndChunkCount,
	getOriginalFileSizeFromEncryptedFileSize,
	containsOnlyAlphaNumericCharacters
} from "../src/common/commonUtils";

import { randomInt } from "crypto";

function testXChaCha20Poly1305() {
	// TODO: test fixed vectors and expected output vectors
}

function testEncryptedFileSize() {
	// TODO: test fixed values and expected values that are hand calculated
}

function testContainsOnlyAlphaNumericCharacters() {
	const okayCharacters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

	for (let i = 0; i < 256; i++) {
		const string = String.fromCharCode(i);
		const isActuallyOkay = (okayCharacters.indexOf(string) != -1);

		if (containsOnlyAlphaNumericCharacters(string) != isActuallyOkay) {
			console.log(`containsOnlyAlphaNumericCharacters FAILED! character: ${string}, is actually okay: ${isActuallyOkay}`);
			return false;
		}
	}

	return true;
}

function testEncryptedFileSizeToOriginal() {
	let success = true;

	for (let i = 0; i < 5000; i++) {
		const original = randomInt(1000000000);
		const encrypted = getEncryptedFileSizeAndChunkCount(original);
		const reverted = getOriginalFileSizeFromEncryptedFileSize(encrypted.encryptedFileSize);

		if (original != reverted) {
			console.log(`ISSUE: o: ${original} r: ${reverted}`);
			success = false;
		}
	}

	if (!success) {
		console.log(`getEncryptedFileSizeAndChunkCount and getOriginalFileSizeFromEncryptedFileSize FAILED!`);
	}

	return success;
}

let pass = true;

if (!testContainsOnlyAlphaNumericCharacters()) {
	pass = false;
}

if (!testEncryptedFileSizeToOriginal()) {
	pass = false;
}

if (pass) {
	console.log(`All tests PASSED!`);
} else {
	console.log(`Some tests FAILED!`);
}
