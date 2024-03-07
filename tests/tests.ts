import { getEncryptedFileSizeAndChunkCount, getOriginalFileSizeFromEncryptedFileSize } from "../src/common/common";
import { randomInt } from "crypto";

let allSuccess = true;

function testXChaCha20Poly1305() {
	// TODO: test fixed vectors and expected output vectors
}

function testEncryptedFileSize() {
	// TODO: test fixed values and expected values that are hand calculated
}

function testEncryptedFileSizeToOriginal() {
	let success = true;

	for (let i = 0; i < 100; i++) {
		const original = randomInt(1000000000);
		const encrypted = getEncryptedFileSizeAndChunkCount(original);
		const reverted = getOriginalFileSizeFromEncryptedFileSize(encrypted.encryptedFileSize);

		if (original != reverted) {
			console.log(`ISSUE: o: ${original} r: ${reverted}`);
			success = false;
		}
	}

	if (!success)
		allSuccess = false;

	return success;
}

if (!testEncryptedFileSizeToOriginal()) {
	console.log(`encrypted file size and its reverse calculations FAILED!`);
}

if (allSuccess) {
	console.log(`All tests PASSED!`);
} else {
	console.log(`Some tests FAILED!`);
}
