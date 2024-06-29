import { convertFourBytesToSignedInt, encodeSignedIntAsFourBytes, padStringToMatchBlockSizeInBytes } from "../utility/commonUtils";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/crypto";
import { FileMetadata, createFileMetadataJsonString } from "./userFilesystem";
import CONSTANTS from "./constants";

/**
 * Encrypts a Uint8Array buffer with a given key and random nonce using XChaCha20-Poly1305.
 * The returned buffer contains the nonce at the beginning and the poly1305 authentication 
 * tag at the end.
 * @param {Uint8Array} buffer The buffer to encrypt.
 * @param {Uint8Array} key The key for encryption.
 * @returns {Uint8Array} The encrypted buffer.
 */
function encryptBuffer(buffer: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.byteLength !== CONSTANTS.XCHACHA20_KEY_LENGTH) {
    throw new Error("Input key is incorrect length!");
  }

  const nonce = randomBytes(CONSTANTS.NONCE_BYTE_LENGTH);
  const resultBuffer = new Uint8Array(buffer.byteLength + CONSTANTS.NONCE_BYTE_LENGTH + CONSTANTS.POLY1305_TAG_BYTE_LENGTH);
  const chacha = xchacha20poly1305(key, nonce);
  const cipherText = chacha.encrypt(buffer);

  resultBuffer.set(nonce, 0); // Append nonce
  resultBuffer.set(cipherText, CONSTANTS.NONCE_BYTE_LENGTH); // Append encrypted file key with poly1305 tag

  return resultBuffer;
}

/**
 * Decrypts a Uint8Array buffer that was encrypted using the `encryptBuffer` function.
 * @param {Uint8Array} encryptedBuffer The buffer to decrypt.
 * @param {Uint8Array} key The key used for encryption.
 * @returns {Uint8Array} The decrypted buffer.
 */
function decryptBuffer(encryptedBuffer: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.byteLength !== CONSTANTS.XCHACHA20_KEY_LENGTH) {
    throw new Error("Input key is incorrect length!");
  }

  const nonce = encryptedBuffer.slice(0, CONSTANTS.NONCE_BYTE_LENGTH);
  const chacha = xchacha20poly1305(key, nonce);
  const plainText = chacha.decrypt(encryptedBuffer.slice(CONSTANTS.NONCE_BYTE_LENGTH, encryptedBuffer.byteLength));

  return plainText;
}

/**
 * Encrypts a `FileMetadata` object by first converting it to a JSON string and padding it to a 
 * byte length of `CONSTANTS.FILE_METADATA_OBFUSCATE_PADDING` and then encrypts it.
 * @param {FileMetadata} metadata The file metadata to encrypt.
 * @param {Uint8Array} key The key used for encryption.
 * @returns {Uint8Array} The encrypted metadata buffer.
 */
function encryptFileMetadata(metadata: FileMetadata, key: Uint8Array): Uint8Array {
  // Create json string from the metadata
  let fileMetadataJsonStr = createFileMetadataJsonString(metadata);

  // Pad json string to obfuscate the exact length of the metadata
  fileMetadataJsonStr = padStringToMatchBlockSizeInBytes(fileMetadataJsonStr, " ", CONSTANTS.FILE_METADATA_OBFUSCATE_PADDING);

  // Convert to Uint8Array
  const textEncoder = new TextEncoder();
  const fileMetadata = textEncoder.encode(fileMetadataJsonStr);

  // Encrypt
  return encryptBuffer(fileMetadata, key);
}

/**
 * Decrypts a `FileMetadata` object that was encrypted using `encryptFileMetadata`.
 * @param {Uint8Array} encryptedMetadata The encrypted metadata.
 * @param {Uint8Array} key The key used for encryption.
 * @returns {FileMetadata} The decrypted metadata object.
 */
function decryptEncryptedFileMetadata(encryptedMetadata: Uint8Array, key: Uint8Array): FileMetadata {
  const decData = decryptBuffer(encryptedMetadata, key);

  // Convert to string
  const textDecoder = new TextDecoder();
  const str = textDecoder.decode(decData).trim(); // Trim because of the obfuscation padding.

  // Parse JSON
  const json = JSON.parse(str);
  const fileName = json.fn as string;
  const dateAdded = json.da as number;
  const isFolder = json.if as boolean;

  return {
    fileName: fileName.trim(), // Must be trimmed due to padding added to the file name used for obfuscation.
    dateAdded: dateAdded,
    isFolder: isFolder
  };
}

/**
 * Encrypts a file chunk and includes the chunk id into the encrypted data.
 * @param {number} chunkId The id of the chunk starting from 0.
 * @param {Uint8Array} fileChunk The file chunk buffer.
 * @param {Uint8Array} key The key used for encryption.
 * @returns {Uint8Array} The encrypted file chunk.
 */
function encryptFileChunk(chunkId: number, fileChunk: Uint8Array, key: Uint8Array): Uint8Array {
  const chunkIdArray = encodeSignedIntAsFourBytes(chunkId);
  const chunkIdBuffer = new Uint8Array(chunkIdArray);
  
  const chunkBuffer = new Uint8Array(fileChunk.byteLength + 4); // + 4 for the chunk id
  chunkBuffer.set(chunkIdBuffer, 0); // Write chunk id
  chunkBuffer.set(fileChunk, 4); // Write raw chunk buffer

  return encryptBuffer(chunkBuffer, key);
}

/**
 * A type that contains the chunk id and buffer of an **unencrypted** file chunk.
 * @type
 */
type FileChunkBuffer = {
  chunkId: number;
  buffer: Uint8Array;
};

/**
 * Decrypts a file chunk that was encrypted using `encryptFileChunk`.
 * @param {Uint8Array} encryptedBuffer The encrypted file chunk buffer.
 * @param {Uint8Array} key The key used for encryption.
 * @returns {FileChunkBuffer} The decrypted file chunk.
 */
function decryptFileChunk(encryptedBuffer: Uint8Array, key: Uint8Array): FileChunkBuffer {
  const nonceLength = CONSTANTS.NONCE_BYTE_LENGTH;

  // Extract nonce and cipher text
  const nonce = new Uint8Array(encryptedBuffer.slice(0, nonceLength));
  const cipherText = new Uint8Array(encryptedBuffer.slice(nonceLength, encryptedBuffer.byteLength));
  
  // Decrypt
  const chacha = xchacha20poly1305(key, nonce);
  const rawPlainText = chacha.decrypt(cipherText);
  const rawChunkId = rawPlainText.slice(0, 4);

  return {
    chunkId: convertFourBytesToSignedInt( [ rawChunkId[0], rawChunkId[1], rawChunkId[2], rawChunkId[3] ]),
    buffer: rawPlainText.slice(4, rawPlainText.byteLength)
  }
}

export type {
  FileMetadata
}

export {
  createFileMetadataJsonString,
  encryptFileMetadata,
  decryptEncryptedFileMetadata,
  encryptFileChunk,
  decryptFileChunk,
  encryptBuffer,
  decryptBuffer
}
