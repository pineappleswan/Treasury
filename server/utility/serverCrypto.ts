import { encodeSignedIntAsFourBytes } from "../../src/common/commonUtils";
import CONSTANTS from "../../src/common/constants";

function createEncryptedChunkBuffer(chunkId: number, encryptedData: Buffer): Buffer {
	// Allocate buffer with extra space for: magic (4B) and chunk id(4B)
	const buffer = Buffer.alloc(encryptedData.byteLength + 8);

	// 1. Write magic number
	buffer.set(CONSTANTS.ENCRYPTED_CHUNK_MAGIC_NUMBER, 0);
	
	// 2. Write chunk id
	const encodedChunkId = encodeSignedIntAsFourBytes(chunkId);
	buffer.set(encodedChunkId, 4);

	// 3. Write encrypted chunk data (it should include a nonce and poly1305 tag already from the client)
	buffer.set(encryptedData, 8);

	return buffer;
}

export {
	createEncryptedChunkBuffer
}
