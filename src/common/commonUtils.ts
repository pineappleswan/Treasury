import { DataSizeUnitSetting } from "../client/userSettings";
import CONSTANTS from "./constants";

function sleepFor(milliseconds: number) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Returns the total file size
function getFileChunkCount(rawFileSize: number) {
	return Math.ceil(rawFileSize / CONSTANTS.CHUNK_DATA_SIZE);
}

function getEncryptedFileSize(rawFileSize: number) {
	const chunkCount = getFileChunkCount(rawFileSize);
	const overhead = CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE + (chunkCount * CONSTANTS.CHUNK_EXTRA_DATA_SIZE);
	return overhead + rawFileSize;
}

function getChunkCountFromEncryptedFileSize(encryptedFileSize: number): number {
	return Math.ceil((encryptedFileSize - CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE) / CONSTANTS.CHUNK_FULL_SIZE);
}

function getRawFileSizeFromEncryptedFileSize(encryptedFileSize: number): number {
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

function isAlphaNumericOnly(str: string): boolean {
	return /^[a-zA-Z0-9]+$/.test(str);
}

// Returns true when every character is an ascii zero. i.e "0".
// This is the only criteria for the root directory handle.
function isRootDirectory(handle: string): boolean {
	return /^[0]+$/.test(handle);
}

function getUTCTimeInSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function verifyFileChunkMagic(fullChunkBuffer: Uint8Array): boolean {
	const magic = CONSTANTS.CHUNK_MAGIC_NUMBER;

	if (fullChunkBuffer.byteLength < magic.length)
		return false;

	for (let i = 0; i < magic.length; i++) {
		if (fullChunkBuffer[i] != magic[i]) {
			return false;
		}
	}

	return true;
}

export {
	sleepFor,
	getFileChunkCount,
	getEncryptedFileSize,
	getChunkCountFromEncryptedFileSize,
	getRawFileSizeFromEncryptedFileSize,
	padStringToMatchBlockSizeInBytes,
	encodeSignedIntAsFourBytes,
	convertFourBytesToSignedInt,
	isAlphaNumericOnly,
	getFormattedBytesSizeText,
	getFormattedBPSText,
	getDateAddedTextFromUnixTimestamp,
	isRootDirectory,
	getUTCTimeInSeconds,
	verifyFileChunkMagic
};
