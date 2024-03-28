import { hexStringToUint8Array, padStringToMatchBlockSizeInBytes, uint8ArrayToHexString } from "../common/commonUtils";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/crypto";
import { FileMetadata, createFileMetadataJsonString } from "./userFilesystem";
import { blake3 } from "hash-wasm";
import { ed25519 } from "@noble/curves/ed25519";
import CONSTANTS from "../common/constants";

// Automatically pads the metadata to meet the obfuscation block size requirement
function createEncryptedFileMetadata(metadata: FileMetadata, masterKey: Uint8Array): Uint8Array {
	// Create metadata json object
	let fileMetadataJsonStr = createFileMetadataJsonString(metadata);

	// Pad json string for obfuscation reasons
	fileMetadataJsonStr = padStringToMatchBlockSizeInBytes(fileMetadataJsonStr, " ", CONSTANTS.FILE_METADATA_OBFUSCATE_PADDING);

	// Convert to Uint8Array
	const textEncoder = new TextEncoder();
	const fileMetadata = textEncoder.encode(fileMetadataJsonStr);

	// Encrypt
	const encFileMetadata = new Uint8Array(fileMetadata.byteLength + 40); // + 24 for nonce + 16 for poly1305 tag

	const nonce = randomBytes(24); // 192 bit
	const chacha = xchacha20poly1305(masterKey, nonce);
	const encData = chacha.encrypt(fileMetadata);
	encFileMetadata.set(nonce, 0); // Append nonce
	encFileMetadata.set(encData, 24); // Append encrypted data with poly1305 tag

	return encFileMetadata;
}

function encryptFileCryptKey(fileCryptKey: Uint8Array, masterKey: Uint8Array): Uint8Array {
	const encFileCryptKey = new Uint8Array(CONSTANTS.ENCRYPTED_CRYPT_KEY_SIZE);

	const nonce = randomBytes(24); // 192 bit
	const chacha = xchacha20poly1305(masterKey, nonce);
	const encKey = chacha.encrypt(fileCryptKey);
	encFileCryptKey.set(nonce, 0); // Append nonce
	encFileCryptKey.set(encKey, 24); // Append encrypted file key with poly1305 tag

	return encFileCryptKey;
}

// TODO: this code could be generalised like the encryption of the file crypt key too... but whatever
function encryptCurve25519Key(key: Uint8Array, masterKey: Uint8Array): Uint8Array {
	if (key.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH) {
		throw new Error("Input Curve25519 key is incorrect length!");
	}

	const resultBuffer = new Uint8Array(CONSTANTS.ENCRYPTED_CURVE25519_KEY_BYTE_LENGTH);

	const nonce = randomBytes(24); // 192 bit
	const chacha = xchacha20poly1305(masterKey, nonce);
	const encKey = chacha.encrypt(key);
	resultBuffer.set(nonce, 0); // Append nonce
	resultBuffer.set(encKey, 24); // Append encrypted file key with poly1305 tag

	return resultBuffer;
}

function decryptEncryptedCurve25519Key(encryptedKey: Uint8Array, masterKey: Uint8Array): Uint8Array {
	const nonce = encryptedKey.slice(0, 24);
	const encData = encryptedKey.slice(24);
	const chacha = xchacha20poly1305(masterKey, nonce);
	const key = chacha.decrypt(encData);

	return key;
}

function decryptFileMetadataAsJsonObject(encryptedMetadata: Uint8Array, masterKey: Uint8Array): FileMetadata {
	const nonce = encryptedMetadata.slice(0, 24);
	const encData = encryptedMetadata.slice(24);
	const chacha = xchacha20poly1305(masterKey, nonce);
	const decData = chacha.decrypt(encData);

	// Convert to string
	const textDecoder = new TextDecoder();
	const str = textDecoder.decode(decData).trim(); // Trim because of the obfuscation padding

	// Parse JSON
	const json = JSON.parse(str);
	const fileName = json.fn as string;
	const isFolder = json.if as boolean;

	return {
		parentHandle: json.ph,
		fileName: fileName.trim(), // Must be trimmed due to padding spaces in the file name used for obfuscation
		dateAdded: json.da,
		isFolder: isFolder
	};
}

function decryptEncryptedFileCryptKey(encryptedCryptKey: Uint8Array, masterKey: Uint8Array): Uint8Array {
	const nonce = encryptedCryptKey.slice(0, 24);
	const encData = encryptedCryptKey.slice(24);
	const chacha = xchacha20poly1305(masterKey, nonce);
	const fileCryptKey = chacha.decrypt(encData);

	return fileCryptKey;
}

function encryptRawChunkBuffer(rawChunkBuffer: Uint8Array, fileCryptKey: Uint8Array): Uint8Array {
	const nonce = randomBytes(24);
	const chacha = xchacha20poly1305(fileCryptKey, nonce);
	const encryptedBufferWithTag = chacha.encrypt(rawChunkBuffer);

	const fullChunk = new Uint8Array(rawChunkBuffer.byteLength + 40); // nonce + poly1305 auth tag
	fullChunk.set(nonce, 0); // Add nonce
	fullChunk.set(encryptedBufferWithTag, 24); // Add data

	return fullChunk;
}

type ChunkHashInfo = {
	hash: string,
	chunkId: number
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

	async getSignature(ed25519PrivateKey: Uint8Array): Promise<string> {
		if (ed25519PrivateKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
			throw new Error(`ed25519PrivateKey has an incorrect length!`);

		return new Promise<string>(resolve => {
			// Sort in order of chunk id
			this.chunkHashes.sort((a, b) => a.chunkId - b.chunkId);
	
			// Concatenate all hashes into one big hex string
			let hashChain = "";

			for (let i = 0; i < this.chunkHashes.length; i++) {
				hashChain += this.chunkHashes[i].hash;
			}
	
			// Convert to Uint8Array
			const hashChainAsUint8Array = hexStringToUint8Array(hashChain);

			// Sign hash chain to produce signature
			const signature = uint8ArrayToHexString(ed25519.sign(hashChainAsUint8Array, ed25519PrivateKey));
	
			//console.log(hashChainAsUint8Array);
			//console.log(`hash chain: ${hashChain}`);
			console.log(`signature: ${signature}`);

			resolve(signature);
		});
	}
}

export type {
	FileMetadata
}

export {
	createFileMetadataJsonString,
	createEncryptedFileMetadata,
	encryptFileCryptKey,
	decryptFileMetadataAsJsonObject,
	decryptEncryptedFileCryptKey,
	encryptRawChunkBuffer,
	encryptCurve25519Key,
	decryptEncryptedCurve25519Key,
	FileSignatureBuilder
}
