/*
----* TREASURY ENCRYPTED FILE FORMAT (.tef) *---- (TODO: move to documentation somewhere else)

FILE HEADER:
	1. Magic (4B -> 9B 4F E7 05)
	2. Chunk full size (4B -> signed 32 bit integer) (big endian)
	   -> (the number of bytes from the start of the magic of one chunk to the start of the magic of the next chunk)
		 -> NOTE: is not valid for the last chunk of course... last chunk's size can be calculated as distance to end of file

CHUNK (1. and 2. are part of the chunk's "header")
	1. Magic (4B -> 82 7A 3D E3) (verifies the beginning of a chunk)
	2. Chunk id (4B) (big endian)
	3. Nonce (24B)
	4. Encrypted data (max ~2.147 GB)
	5. poly1305 authentication tag (16B) 
	
*/

// This value describes the max number of chunks that can be downloaded/uploaded in parallel
// TODO: On client, try to not create 3 requests unless upload time per chunk is so low that multiple requests need to be made to maximise upload speed.
//       This prevents the rare case where the upload speed is distributed over many requests where one chunk might take >60 seconds (or whatever the
//       threshold is) to upload, causing them to timeout

import CONSTANTS from "./constants";

type EncryptedFileRequirements = {
	encryptedFileSize: number,
	chunkCount: number
};

// Returns the required file size to store a file after encryption
function getEncryptedFileSizeAndChunkCount(unencryptedFileSize: number): EncryptedFileRequirements {
	let chunkCount = Math.floor(unencryptedFileSize / CONSTANTS.ENCRYPTED_CHUNK_DATA_SIZE) + 1;
	const fileHeaderSize = CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE;
	const extraChunkSize = CONSTANTS.ENCRYPTED_CHUNK_EXTRA_DATA_SIZE;
	
	return {
		encryptedFileSize: fileHeaderSize + (chunkCount * extraChunkSize) + unencryptedFileSize,
		chunkCount: chunkCount
	}
}

function getChunkCountFromEncryptedFileSize(encryptedFileSize: number): number {
	return Math.floor((encryptedFileSize - CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE) / (CONSTANTS.ENCRYPTED_CHUNK_FULL_SIZE)) + 1;
}

function getOriginalFileSizeFromEncryptedFileSize(encryptedFileSize: number): number {
	const chunkCount = getChunkCountFromEncryptedFileSize(encryptedFileSize);
	return encryptedFileSize - (CONSTANTS.ENCRYPTED_CHUNK_EXTRA_DATA_SIZE * chunkCount) - CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE;
}

function encodeSignedIntAsFourBytes(number: number): Array<number> {
	return [
		(number >> 24) & 255,
		(number >> 16) & 255,
		(number >> 8) & 255,
		number & 255
	];
}

function convertFourBytesToSignedInt(fourBytes: Array<number>): number {
	return (fourBytes[0] << 24) | (fourBytes[1] << 16) | (fourBytes[2] << 8) | fourBytes[3];
}

function uint8ArrayToHexString(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((byte) => {
			if (byte < 0 || byte > 255) {
				throw new Error(`Invalid hex string!`);
			}

			return byte.toString(16).padStart(2, "0");
		})
		.join("");
}

function hexStringToUint8Array(str: string): Uint8Array {
	const bytes = [];

	for (let i = 0; i < str.length; i += 2) {
		let byte = parseInt(str.substring(i, i + 2), 16);

		if (byte < 0 || byte > 255) {
			throw new Error(`Invalid hex string!`);
		}

		bytes.push(byte);
	}

	return new Uint8Array(bytes);
}

// Pads a string with specified 'fill' character until it reaches a size that is divisible by 'blockSize'
// ('fill' must be one character or else undefined behaviour will occur)
//
// e.g "hello" + 8 = "hello   " (8 chars)
// e.g "hello there friend" + 8 = "hello there friend      " (24 chars)
function padStringToMatchBlockSizeInBytes(str: string, fill: string, blockSize: number) {
	// Calculate the byte length of the string because unicode characters take up multiple bytes!
	const textEncoder = new TextEncoder();
	const stringAsBytes = textEncoder.encode(str);
	const byteLength = stringAsBytes.byteLength;

	// Account for enlargement size when padding
	const targetPaddedSize = Math.ceil(byteLength / blockSize) * blockSize;
	const padding = targetPaddedSize - byteLength;

	return str + fill.repeat(padding);
}

function createEncryptedChunkBuffer(chunkId: number, nonce: Uint8Array, encryptedChunkDataWithPoly1305Tag: Uint8Array): ArrayBuffer {
	// Allocate buffer with extra space for: magic (4B), chunk id(4B), nonce (24B)
	const buffer = new Uint8Array(encryptedChunkDataWithPoly1305Tag.byteLength + 32);

	// 1. Write magic
	buffer.set(CONSTANTS.ENCRYPTED_CHUNK_MAGIC_NUMBER, 0);
	
	// 2. Write chunk id
	const encodedChunkId = encodeSignedIntAsFourBytes(chunkId);
	buffer.set(encodedChunkId, 4);
	
	// 3. Write nonce
	buffer.set(nonce, 8);

	// 4. Write encrypted chunk data + tag
	buffer.set(encryptedChunkDataWithPoly1305Tag, 32);

	return buffer.buffer;
}

function containsOnlyAlphaNumericCharacters(str: string): boolean {
	const len = str.length;

	for (let i = 0; i < len; i++) {
		const character = str.charAt(i);
		const code = character.charCodeAt(0);
		const isAlphaNumeric = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
	
		if (!isAlphaNumeric) {
			return false;
		}
	}

	return true;
}

// Returns the formatted text for a number representing a number of bytes. e.g 1,000,000 = 1 MB
function getFormattedBytesSizeText(byteCount: number) {
  if (byteCount == undefined)
    throw new TypeError("byteCount is undefined!");

	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let unitIndex = 0;
  
	while (byteCount >= 1000 && unitIndex < units.length - 1) {
		byteCount /= 1000;
		unitIndex++;
	}

	if (unitIndex == 0) { // Bytes unit cannot have decimal places
		return byteCount.toFixed(0) + " " + units[unitIndex];
	} else {
		return byteCount.toFixed(1) + " " + units[unitIndex];
	}
}

// Returns the formatted text for a number representing transfer speed in bytes/second. e.g 1,000,000 = "1 MB/s"
function getFormattedBPSText(bps: number) {
	/* DEPRECATED CODE
  if (bps == undefined)
    throw new TypeError("bps is undefined!");

	const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s", "PB/s"];
	let unitIndex = 0;

	while (bps >= 1000 && unitIndex < units.length - 1) {
		bps /= 1000;
		unitIndex++;
	}

	return bps.toFixed(1) + " " + units[unitIndex];
	*/

	return getFormattedBytesSizeText(bps) + "/s";
}

// Returns a formatted timestamp using a unix timestamp given in seconds for the date added text in file lists
// You can specify an american format of date where the month comes before the day
function getDateAddedTextFromUnixTimestamp(seconds: number, isAmericanFormat: boolean) {
	if (seconds == undefined)
		throw new TypeError("seconds is undefined!");

	if (isAmericanFormat == undefined)
		throw new TypeError("isAmericanFormat is undefined!");

	let date = new Date(seconds * 1000);
	let hours = date.getHours();
	let minutes = date.getMinutes();
	let day = date.getDate();
	let month = date.getMonth() + 1; // January starts from zero, so we add 1 to get 1-12 month range
	let year = date.getFullYear();

	let amOrPmText = (hours >= 12 ? "PM" : "AM");
	let hours12 = hours % 12;
	hours12 = (hours12 == 0 ? 12 : hours12); // hour 0 is always 12

	// Pad some numbers (e.g 7:6 pm = 7:06pm)
	const minutesStr = minutes.toString().padStart(2, "0");

	if (isAmericanFormat) {
		return `${hours12}:${minutesStr} ${amOrPmText} ${month}/${day}/${year}`;
	} else {
		return `${hours12}:${minutesStr} ${amOrPmText} ${day}/${month}/${year}`;
	}
}

export {
	getEncryptedFileSizeAndChunkCount,
	getChunkCountFromEncryptedFileSize,
	getOriginalFileSizeFromEncryptedFileSize,
	uint8ArrayToHexString,
	hexStringToUint8Array,
	padStringToMatchBlockSizeInBytes,
	createEncryptedChunkBuffer,
	encodeSignedIntAsFourBytes,
	convertFourBytesToSignedInt,
	containsOnlyAlphaNumericCharacters,
	getFormattedBytesSizeText,
	getFormattedBPSText,
	getDateAddedTextFromUnixTimestamp
};
