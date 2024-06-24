import { convertFourBytesToSignedInt, encodeSignedIntAsFourBytes, padStringToMatchBlockSizeInBytes } from "../utility/commonUtils";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/crypto";
import { FileMetadata, createFileMetadataJsonString } from "./userFilesystem";
import { blake3 } from "hash-wasm";
import { ed25519 } from "@noble/curves/ed25519";
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

/**
 * A type that contains the Blake3 hash and chunk id of a file chunk.
 */
type ChunkHashInfo = {
  /**
   * The Blake3 hash of the file chunk buffer.
   */
  hash: string;
  /**
    * A type that contains the Blake3 hash and chunk id of a file chunk.
   */
  chunkId: number;
};

/**
 * A utility class for signing a file that is uploaded to the server by users in the browser using
 * Ed25519.
 */
class FileSignatureBuilder {
  /**
   * An array of all the hashes of the file chunks.
   */
  private chunkHashes: ChunkHashInfo[] = [];

  /**
   * Hashes a file chunk and records the chunk id of the hash internally.
   * 
   * @param {Uint8Array} chunk - The unencrypted file chunk buffer.
   * @param {number} chunkId - The id of the chunk starting from 0.
   */
  async appendFileChunk(chunk: Uint8Array, chunkId: number) {
    const hashBits = CONSTANTS.CHUNK_HASH_BYTE_LENGTH * 8;
    const chunkHash = await blake3(chunk, hashBits); // Hash the chunk's binary contents
    
    this.chunkHashes.push({
      hash: chunkHash,
      chunkId: chunkId
    });
  }

  /**
   * Resets the internal state of the class. This is used when you want to create a signature for 
   * the next file.
   */
  clear() {
    this.chunkHashes = [];
  }
  
  /**
   * Gets the internal file hashes sorted by chunk id in ascending order and concatenated together 
   * in a string. This is known as the 'hash chain'.
   * @returns {string} The file hash chain.
   */
  private getHashChain(): string {
    // Sort in order of chunk id
    this.chunkHashes.sort((a, b) => a.chunkId - b.chunkId);
    
    let hashChain = "";
    this.chunkHashes.forEach(chunkInfo => hashChain += chunkInfo.hash);

    return hashChain;
  }

  /**
   * Signs all the file chunks using Ed25519.
   * @param {Uint8Array} ed25519PrivateKey - The Ed25519 private key for signing.
   * @param {string} fileHandle - The handle of the file being signed.
   * @returns {Uint8Array} The resulting Ed25519 signature of the file.
   */
  getSignature(ed25519PrivateKey: Uint8Array, fileHandle: string): Uint8Array {
    if (ed25519PrivateKey.byteLength != CONSTANTS.CURVE25519_KEY_BYTE_LENGTH)
      throw new Error(`ed25519PrivateKey length is incorrect!`);

    const rawSignatureStr = fileHandle + this.getHashChain();
    const rawSignature = new TextEncoder().encode(rawSignatureStr); // Convert to Uint8Array

    return ed25519.sign(rawSignature, ed25519PrivateKey);
  }

  /**
   * Verifies that the downloaded file chunks are made by whoever signed the file originally.
   * @param {Uint8Array} ed25519PublicKey - The Ed25519 public key of the signer.
   * @param {Uint8Array} signature - The Ed25519 signature of the file.
   * @param {string} fileHandle - The handle of the file that was signed.
   * @returns {boolean} True if the signature is verified; false otherwise.
   */
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
  FileMetadata
}

export {
  createFileMetadataJsonString,
  encryptFileMetadata,
  decryptEncryptedFileMetadata,
  encryptFileChunk,
  decryptFileChunk,
  encryptBuffer,
  decryptBuffer,
  FileSignatureBuilder
}
