// TODO: On client, try to not create 3 requests unless upload time per chunk is so low that multiple requests need to be made to maximise upload speed.
//       This prevents the rare case where the upload speed is distributed over many requests where one chunk might take >60 seconds (or whatever the
//       threshold is) to upload, causing them to timeout

import { DataSizeUnitSetting } from "../client/userSettings";
import CONSTANTS from "./constants";

// This enum determines how a user's storage quota is calculated
enum StorageQuotaMeasurementMode {
	// Only counts the real unencrypted size of files in a user's filesystem towards their storage quota
	NORMAL,

	// Counts the size of files on the server and the metadata associated with them (including folders) towards their storage quota
	STRICT,

	// Counts the size of files on the server and rounds them to their filesystem cluster size.
	// All metadata stored in the server database for the user and their files is also counted.
	SUPER_STRICT
};

type EncryptedFileRequirements = {
	encryptedFileSize: number;
	chunkCount: number;
};

function sleepFor(milliseconds: number) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Returns the required file size to store a file after encryption
function getEncryptedFileSizeAndChunkCount(unencryptedFileSize: number): EncryptedFileRequirements {
	let chunkCount = Math.ceil(unencryptedFileSize / CONSTANTS.CHUNK_DATA_SIZE);

	return {
		encryptedFileSize: CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE + (chunkCount * CONSTANTS.CHUNK_EXTRA_DATA_SIZE) + unencryptedFileSize,
		chunkCount: chunkCount
	}
}

function getChunkCountFromEncryptedFileSize(encryptedFileSize: number): number {
	return Math.ceil((encryptedFileSize - CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE) / CONSTANTS.CHUNK_FULL_SIZE);
}

function getOriginalFileSizeFromEncryptedFileSize(encryptedFileSize: number): number {
	const chunkCount = getChunkCountFromEncryptedFileSize(encryptedFileSize);
	return Math.max(0, encryptedFileSize - (CONSTANTS.CHUNK_EXTRA_DATA_SIZE * chunkCount) - CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE);
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

// Pads a string with specified 'fill' character until it reaches a byte length that is divisible by 'blockSize'
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

function containsOnlyAlphaNumericCharacters(str: string): boolean {
	const alphanumericRegex = /^[a-zA-Z0-9]+$/;
	return alphanumericRegex.test(str);
}

// Returns the formatted text for a number representing a number of bytes. e.g 1,000,000 = 1 MB
function getFormattedBytesSizeText(byteCount: number, dataSizeUnit: DataSizeUnitSetting, optionalPrecision: number = 1) {
	if (byteCount == undefined)
		throw new TypeError("byteCount is undefined!");

	const isBase2 = (dataSizeUnit == DataSizeUnitSetting.Base2);
	const units = (isBase2 ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] : ["B", "KB", "MB", "GB", "TB", "PB"]);
	const factor = (isBase2 ? 1024 : 1000);
	let unitIndex = 0;
	
	while (byteCount >= 1000 && unitIndex < units.length - 1) {
		byteCount /= factor;
		unitIndex++;
	}

	if (unitIndex == 0) { // Bytes unit cannot have decimal places
		return byteCount.toFixed(0) + " " + units[unitIndex];
	} else {
		return byteCount.toFixed(optionalPrecision) + " " + units[unitIndex];
	}
}

// Returns the formatted text for a number representing transfer speed in bytes/second. e.g 1,000,000 = "1 MB/s"
function getFormattedBPSText(bps: number, dataSizeUnit: DataSizeUnitSetting, optionalPrecision: number = 1) {
	return getFormattedBytesSizeText(bps, dataSizeUnit, optionalPrecision) + "/s";
}

// Returns a formatted timestamp using a unix timestamp given in seconds for the date added text in file lists
// You can specify an american format of date where the month comes before the day
function getDateAddedTextFromUnixTimestamp(seconds: number, isAmericanFormat: boolean) {
	if (seconds == undefined)
		throw new TypeError("seconds is undefined!");

	if (isAmericanFormat == undefined)
		throw new TypeError("isAmericanFormat is undefined!");

	let date = new Date(seconds * 1000);
	let hours = date.getUTCHours();
	let minutes = date.getUTCMinutes();
	let day = date.getUTCDate();
	let month = date.getUTCMonth() + 1; // January starts from zero, so we add 1 to get 1-12 month range
	let year = date.getUTCFullYear();

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

// TODO: use regex
// Returns true when every character is an ascii zero. i.e "0". That is the only criteria for the root directory handle
function isHandleTheRootDirectory(handle: string): boolean {
	for (let i = 0; i < handle.length; i++) {
		if (handle.at(i) != "0") {
			return false;
		}
	}

	return true;
}

function getUTCTimeInSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

export {
	StorageQuotaMeasurementMode,
	sleepFor,
	getEncryptedFileSizeAndChunkCount,
	getChunkCountFromEncryptedFileSize,
	getOriginalFileSizeFromEncryptedFileSize,
	uint8ArrayToHexString,
	hexStringToUint8Array,
	padStringToMatchBlockSizeInBytes,
	encodeSignedIntAsFourBytes,
	convertFourBytesToSignedInt,
	containsOnlyAlphaNumericCharacters,
	getFormattedBytesSizeText,
	getFormattedBPSText,
	getDateAddedTextFromUnixTimestamp,
	isHandleTheRootDirectory,
	getUTCTimeInSeconds
};
