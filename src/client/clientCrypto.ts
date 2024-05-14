import { convertFourBytesToSignedInt, encodeSignedIntAsFourBytes, hexStringToUint8Array, padStringToMatchBlockSizeInBytes, uint8ArrayToHexString } from "../common/commonUtils";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/crypto";
import { FileMetadata, createFileMetadataJsonString } from "./userFilesystem";
import { blake3 } from "hash-wasm";
import { ed25519 } from "@noble/curves/ed25519";
import { verifyChunkMagic } from "../common/commonCrypto";
import base64js from "base64-js";
import CONSTANTS from "../common/constants";

// TODO: tests.ts test function for this!
function encryptBuffer(inputBuffer: Uint8Array, key: Uint8Array): Uint8Array {
	if (key.byteLength != CONSTANTS.XCHACHA20_KEY_LENGTH) {
		throw new Error("Input key is incorrect length!");
	}

	const nonce = randomBytes(CONSTANTS.NONCE_BYTE_LENGTH);
	const resultBuffer = new Uint8Array(inputBuffer.byteLength + CONSTANTS.NONCE_BYTE_LENGTH + CONSTANTS.POLY1305_TAG_BYTE_LENGTH);
	const chacha = xchacha20poly1305(key, nonce);
	const cipherText = chacha.encrypt(inputBuffer);

	resultBuffer.set(nonce, 0); // Append nonce
	resultBuffer.set(cipherText, CONSTANTS.NONCE_BYTE_LENGTH); // Append encrypted file key with poly1305 tag

	return resultBuffer;
}

function decryptBuffer(encryptedBuffer: Uint8Array, key: Uint8Array): Uint8Array {
	if (key.byteLength != CONSTANTS.XCHACHA20_KEY_LENGTH) {
		throw new Error("Input key is incorrect length!");
	}

	const nonce = encryptedBuffer.slice(0, CONSTANTS.NONCE_BYTE_LENGTH);
	const chacha = xchacha20poly1305(key, nonce);
	const plainText = chacha.decrypt(encryptedBuffer.slice(24, encryptedBuffer.byteLength));

	return plainText;
}

// Automatically pads the metadata to meet the obfuscation block size requirement
function createEncryptedFileMetadata(metadata: FileMetadata, key: Uint8Array): Uint8Array {
	// Create metadata json object
	let fileMetadataJsonStr = createFileMetadataJsonString(metadata);

	// Pad json string to obfuscate the exact length of the metadata
	fileMetadataJsonStr = padStringToMatchBlockSizeInBytes(fileMetadataJsonStr, " ", CONSTANTS.FILE_METADATA_OBFUSCATE_PADDING);

	// Convert to Uint8Array
	const textEncoder = new TextEncoder();
	const fileMetadata = textEncoder.encode(fileMetadataJsonStr);

	// Encrypt
	return encryptBuffer(fileMetadata, key);
}

function decryptEncryptedFileMetadata(encryptedMetadata: Uint8Array, key: Uint8Array): FileMetadata {
	const decData = decryptBuffer(encryptedMetadata, key);

	// Convert to string
	const textDecoder = new TextDecoder();
	const str = textDecoder.decode(decData).trim(); // Trim because of the obfuscation padding

	// Parse JSON
	const json = JSON.parse(str);
	const fileName = json.fn as string;
	const isFolder = json.if as boolean;

	return {
		fileName: fileName.trim(), // Must be trimmed due to padding spaces in the file name used for obfuscation
		dateAdded: json.da,
		isFolder: isFolder
	};
}

function encryptFileCryptKey(fileCryptKey: Uint8Array, key: Uint8Array): Uint8Array {
	if (fileCryptKey.byteLength != CONSTANTS.XCHACHA20_KEY_LENGTH) {
		throw new Error("Input fileCryptKey is incorrect length!");
	}

	return encryptBuffer(fileCryptKey, key);
}

function decryptEncryptedFileCryptKey(encryptedCryptKey: Uint8Array, key: Uint8Array): Uint8Array {
	return decryptBuffer(encryptedCryptKey, key);
}

function encryptCurve25519Key(curve25519Key: Uint8Array, key: Uint8Array): Uint8Array {
	if (curve25519Key.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH) {
		throw new Error("Input Curve25519 key is incorrect length!");
	}

	return encryptBuffer(curve25519Key, key);
}

function decryptEncryptedCurve25519Key(encryptedKey: Uint8Array, key: Uint8Array): Uint8Array {
	return decryptBuffer(encryptedKey, key);
}

// TODO: tests.ts test function
function encryptRawChunkBuffer(chunkId: number, rawChunkBuffer: Uint8Array, fileCryptKey: Uint8Array): Uint8Array {
	const chunkIdArray = encodeSignedIntAsFourBytes(chunkId);
	const chunkIdBuffer = new Uint8Array(chunkIdArray);
	
	const chunkBuffer = new Uint8Array(rawChunkBuffer.byteLength + 4); // + 4 for the chunk id
	chunkBuffer.set(chunkIdBuffer, 0); // Write chunk id
	chunkBuffer.set(rawChunkBuffer, 4); // Write raw chunk buffer
	
	const nonce = randomBytes(CONSTANTS.NONCE_BYTE_LENGTH);
	const chacha = xchacha20poly1305(fileCryptKey, nonce);
	const encryptedBuffer = chacha.encrypt(chunkBuffer);

	const magicBuffer = new Uint8Array(CONSTANTS.CHUNK_MAGIC_NUMBER);

	const fullChunk = new Uint8Array(rawChunkBuffer.byteLength + CONSTANTS.CHUNK_EXTRA_DATA_SIZE);
	fullChunk.set(magicBuffer, 0);
	fullChunk.set(nonce, 4);
	fullChunk.set(encryptedBuffer, 28);

	return fullChunk;
}

// Assumes the magic number is not sent to the client
type DecryptedChunkBuffer = {
	chunkId: number;
	plainText: Uint8Array;
};

function decryptFullChunkBuffer(fullChunkBuffer: Uint8Array, fileCryptKey: Uint8Array): DecryptedChunkBuffer {
	// Verify magic
	if (!verifyChunkMagic(fullChunkBuffer)) {
		throw new Error("Incorrect chunk magic!");
	}

	// Extract nonce and cipher text
	const nonce = new Uint8Array(fullChunkBuffer.slice(4, 28)); // Start from byte 4 due to magic number
	const cipherText = new Uint8Array(fullChunkBuffer.slice(28, fullChunkBuffer.byteLength));
	
	// Decrypt
	const chacha = xchacha20poly1305(fileCryptKey, nonce);
	const rawPlainText = chacha.decrypt(cipherText);
	const rawChunkId = rawPlainText.slice(0, 4);

	return {
		chunkId: convertFourBytesToSignedInt( [ rawChunkId[0], rawChunkId[1], rawChunkId[2], rawChunkId[3] ]),
		plainText: rawPlainText.slice(4, rawPlainText.byteLength)
	}
}

type ChunkHashInfo = {
	hash: string;
	chunkId: number;
};

class FileSignatureBuilder {
	private chunkHashes: ChunkHashInfo[] = [];

	async appendChunk(chunk: Uint8Array, chunkId: number) {
		const hashBits = CONSTANTS.CHUNK_HASH_BYTE_LENGTH * 8;
		const chunkHash = await blake3(chunk, hashBits); // Hash the chunk's binary contents
		
		this.chunkHashes.push({
			hash: chunkHash,
			chunkId: chunkId
		});
	}

	clear() {
		this.chunkHashes = [];
	}
	
	getHashChain(): string {
		// Sort in order of chunk id
		this.chunkHashes.sort((a, b) => a.chunkId - b.chunkId);
		
		let hashChain = "";
		this.chunkHashes.forEach(chunkInfo => hashChain += chunkInfo.hash);

		return hashChain;
	}

	getSignature(ed25519PrivateKey: Uint8Array, fileHandle: string): string {
		if (ed25519PrivateKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
			throw new Error(`ed25519PrivateKey length is incorrect!`);

		const rawSignatureStr = fileHandle + this.getHashChain();
		const rawSignature = new TextEncoder().encode(rawSignatureStr); // Convert to Uint8Array
		const signature = base64js.fromByteArray(ed25519.sign(rawSignature, ed25519PrivateKey));

		return signature;
	}

	verifyDownload(ed25519PublicKey: Uint8Array, signature: Uint8Array, fileHandle: string): boolean {
		if (ed25519PublicKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
			throw new Error(`ed25519PublicKey length is incorrect!`);

		const rawSignatureStr = fileHandle + this.getHashChain();
		const rawSignature = new TextEncoder().encode(rawSignatureStr); // Convert to Uint8Array
		const result = ed25519.verify(signature, rawSignature, ed25519PublicKey);

		return result;
	}
}

export type {
	FileMetadata,
	DecryptedChunkBuffer
}

export {
	createFileMetadataJsonString,
	createEncryptedFileMetadata,
	decryptEncryptedFileMetadata,
	encryptFileCryptKey,
	decryptEncryptedFileCryptKey,
	encryptRawChunkBuffer,
	decryptFullChunkBuffer,
	encryptCurve25519Key,
	decryptEncryptedCurve25519Key,
	encryptBuffer,
	decryptBuffer,
	FileSignatureBuilder
}
