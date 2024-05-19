import { DataSizeUnitSetting } from "../client/userSettings";
import CONSTANTS from "./constants";

/**
 * A utility function that sleeps for `milliseconds`.
 * @param {number} milliseconds - How long to sleep for in milliseconds.
 * @returns {Promise<void>} A promise that is awaited upon.
*/
function sleepFor(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Returns how many chunks a file of size `rawFileSize` can be split up into.
 * The chunks are of length `CONSTANTS.CHUNK_DATA_SIZE` bytes.
 * @param {number} rawFileSize - The input raw file size.
 * @returns {number} The number of chunks.
*/
function getFileChunkCount(rawFileSize: number): number {
	return Math.ceil(rawFileSize / CONSTANTS.CHUNK_DATA_SIZE);
}

/**
 * Returns the byte length of a file of size `rawFileSize` bytes that is encrypted in the treasury 
 * encrypted file format.
 * @param {number} rawFileSize - The input raw file size.
 * @returns {number} The encrypted file size.
*/
function getEncryptedFileSize(rawFileSize: number): number {
	const chunkCount = getFileChunkCount(rawFileSize);
	const overhead = CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE + (chunkCount * CONSTANTS.CHUNK_EXTRA_DATA_SIZE);
	return overhead + rawFileSize;
}

/**
 * Returns the original byte length of a file that was encrypted in the treasury encrypted file format.
 * @param {number} encryptedFileSize - The encrypted file size.
 * @returns {number} The original unencrypted file size.
*/
function getRawFileSizeFromEncryptedFileSize(encryptedFileSize: number): number {
	const chunkCount = getChunkCountFromEncryptedFileSize(encryptedFileSize);
	return Math.max(0, encryptedFileSize - (CONSTANTS.CHUNK_EXTRA_DATA_SIZE * chunkCount) - CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE);
}

/**
 * Returns the byte length of a file of size `rawFileSize` bytes that is encrypted in the treasury 
 * encrypted file format.
 * @param {number} rawFileSize - The input raw file size.
 * @returns {number} The encrypted file size.
*/
function getChunkCountFromEncryptedFileSize(encryptedFileSize: number): number {
	return Math.ceil((encryptedFileSize - CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE) / CONSTANTS.CHUNK_FULL_SIZE);
}

/**
 * Returns an array of 4 numbers each representing a byte from the input number assumed to be 
 * a 32 bit signed integer. The output array is big endian.
 * @param {number} number - The input 32 bit signed integer.
 * @returns {number} The resulting array of 4 bytes.
*/
function encodeSignedIntAsFourBytes(number: number): number[] {
	return [
		(number >> 24) & 255,
		(number >> 16) & 255,
		(number >> 8) & 255,
		number & 255
	];
}

/**
 * Returns a 32 bit signed integer from an array of 4 numbers each representing a byte.
 * The input array is assumed to be big endian.
 * @param {number[]} fourBytes - An array of exactly 4 numbers each representing a byte.
 * @returns {number} The resulting integer.
*/
function convertFourBytesToSignedInt(fourBytes: number[]): number {
	if (fourBytes.length != 4)
		throw new Error("fourBytes must contain exactly 4 integers!");

	return (fourBytes[0] << 24) | (fourBytes[1] << 16) | (fourBytes[2] << 8) | fourBytes[3];
}

/**
 * Returns a copy of the input string padded with the `fill` character to have a byte length
 * that is a multiple of `blockSize`.
 * @param {string} str - The string to pad.
 * @param {string} fill - The character to use as padding. Must be a single character!
 * @param {number} blockSize - The size of each block in bytes.
 * @returns {string} The padded string.
*/
function padStringToMatchBlockSizeInBytes(str: string, fill: string, blockSize: number): string {
	if (fill.length !== 1)
		throw new Error("fill must be exactly 1 character!");

	// Calculate the byte length of the string because unicode characters take up multiple bytes!
	const textEncoder = new TextEncoder();
	const stringAsBytes = textEncoder.encode(str);
	const byteLength = stringAsBytes.byteLength;

	// Account for enlargement size when padding
	const targetPaddedSize = Math.ceil(byteLength / blockSize) * blockSize;
	const padding = targetPaddedSize - byteLength;

	return str + fill.repeat(padding);
}

/**
 * Returns the formatted text for a number representing a number of bytes.
 * @param {number} bytes An integer representing a size in bytes.
 * @param {DataSizeUnitSetting} dataSizeUnit Specifies the suffix used. e.g. MB vs. MiB
 * @param {number} precision How many decimal places the resulting string has. Defaults to 1.
 * @returns The formatted size text.
*/
function getFormattedByteSizeText(bytes: number, dataSizeUnit: DataSizeUnitSetting, precision: number = 1): string {
	if (bytes == undefined)
		throw new TypeError("bytes is undefined!");

	const isBase2 = (dataSizeUnit == DataSizeUnitSetting.Base2);
	const units = (isBase2 ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] : ["B", "KB", "MB", "GB", "TB", "PB"]);
	const factor = (isBase2 ? 1024 : 1000);
	let unitIndex = 0;
	
	while (bytes >= 1000 && unitIndex < units.length - 1) {
		bytes /= factor;
		unitIndex++;
	}

	if (unitIndex == 0) { // Bytes unit cannot have decimal places
		return bytes.toFixed(0) + " " + units[unitIndex];
	} else {
		return bytes.toFixed(precision) + " " + units[unitIndex];
	}
}

/**
 * Returns the formatted text for a number representing transfer speed in bytes/second.
 * @param {number} bps The number representing a bytes/second speed.
 * @param {DataSizeUnitSetting} dataSizeUnit Specifies the suffix used. e.g. MB/s vs. MiB/s
 * @param {number} precision How many decimal places the resulting string has. Defaults to 1.
 * @returns The formatted size text.
*/
function getFormattedBPSText(bps: number, dataSizeUnit: DataSizeUnitSetting, precision: number = 1): string {
	return getFormattedByteSizeText(bps, dataSizeUnit, precision) + "/s";
}

/**
 * Returns a formatted timestamp using a unix timestamp given in seconds.
 * @param {number} seconds The UTC time in seconds as an integer
 * @param {boolean} isAmericanFormat True if the returned format should be in MM/DD/YYYY format; otherwise DD/MM/YYYY is used.
 * @returns {string} The formatted timestamp.
*/
function getTimestampFromUTCSeconds(seconds: number, isAmericanFormat: boolean): string {
	if (seconds == undefined)
		throw new TypeError("seconds is undefined!");

	if (isAmericanFormat == undefined)
		throw new TypeError("isAmericanFormat is undefined!");

	const date = new Date(seconds * 1000);
	const hours = date.getUTCHours();
	const minutes = date.getUTCMinutes();
	const day = date.getUTCDate();
	const month = date.getUTCMonth() + 1; // January starts from zero, so we add 1 to get 1-12 month range
	const year = date.getUTCFullYear();

	const amOrPmText = (hours >= 12 ? "PM" : "AM");
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

/**
 * Checks whether the given string is alphanumeric.
 * @param {string} str The input string.
 * @returns {boolean} True if the input string is alphanumeric; false otherwise.
*/
function isAlphaNumericOnly(str: string): boolean {
	return /^[a-zA-Z0-9]+$/.test(str);
}

/**
 * Returns true when every character is an ascii zero. i.e "0".
 * This is the only criteria for the root directory handle.
 * @param {string} handle The handle of the file entry.
 * @returns {boolean} True if the handle is the root directory; false otherwise.
*/
function isRootDirectory(handle: string): boolean {
	return /^[0]+$/.test(handle);
}

/**
 * Gets the current UTC time in seconds.
 * @returns {number} The UTC time in seconds as an integer
*/
function getUTCTimeInSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * Checks that the first few bytes (i.e. the magic number) of the given chunk buffer matches the
 * defined magic number in `CONSTANTS.CHUNK_MAGIC_NUMBER`.
 * @param {Uint8Array} chunkBuffer The chunk buffer
 * @returns {boolean} True if the chunk's magic number is correct; false otherwise.
*/
function verifyChunkMagic(chunkBuffer: Uint8Array): boolean {
	const magic = CONSTANTS.CHUNK_MAGIC_NUMBER;

	if (chunkBuffer.byteLength < magic.length)
		return false;

	for (let i = 0; i < magic.length; i++) {
		if (chunkBuffer[i] != magic[i]) {
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
	getFormattedByteSizeText,
	getFormattedBPSText,
	getTimestampFromUTCSeconds,
	isRootDirectory,
	getUTCTimeInSeconds,
	verifyChunkMagic
};
