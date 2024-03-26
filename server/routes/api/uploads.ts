import { getUserSessionInfo } from "../../utility/authentication";
import { generateSecureRandomAlphaNumericString } from "../../../src/common/commonCrypto";
import { Mutex } from "async-mutex"
import { FileInfo, TreasuryDatabase } from "../../database/database";
import { createFullEncryptedChunkBuffer } from "../../utility/serverCrypto";
import base64js from "base64-js";
import Joi from "joi";
import fs from "fs";
import path from "path";
import CONSTANTS from "../../../src/common/constants";
import env from "../../env";

type UploadEntry = {
	handle: string,
	userId: number, // The id of the user that uploaded the file
	fileSize: number, // The encrypted file size (not the raw original file size)
	writtenBytes: number, // Stores how many bytes have been written to the file
	prevWrittenChunkId: number, // Helps ensure that chunks are written in the correct order (MUST BE -1 INITIALLY!)
	uploadFileHandle: fs.promises.FileHandle,
	uploadFilePath: string, // The full path where the temporary upload file will be stored at
	mutex: Mutex // Used to prevent data races
};

type UploadEntryDictionary = {
	[key: string]: UploadEntry
};

let uploadTransferEntries: UploadEntryDictionary = {};

// TODO: remove dead handles function (requested from the client everytime they load their page) (how: store new value of last time written data to entry data, and clear any over a certain time e.g 60 seconds)
// TODO: instead of deleting entry when transfer failed, better to have a cancelled boolean and check against that, then only delete entry when user clears uploads...
// TODO: when a chunk fails to upload, delete destination file on server immediately plz.
// TODO: handle upload fails in a better way...

// TODO: async await??? + THIS FUNCTION should be used more for cleanup reasons!
async function cancelUploadTransferAsync(handle: string) {
	const entry = uploadTransferEntries[handle];

	if (entry) {
		const uploadFilePath = entry.uploadFilePath;
		console.log(`cancelling and deleting upload transfer at: ${uploadFilePath}`);

		delete uploadTransferEntries[handle];

		try {
			await fs.promises.unlink(uploadFilePath);
		} catch (error) {
			console.error(`Cancel upload delete transfer file error: ${error}`);
		}
	} else {
		console.warn(`WARNING: tried to cancel upload transfer with handle '${handle}' but it doesn't exist!`);
	}
}

// check .required everywhere
const startUploadSchema = Joi.object({
	fileSize: Joi.number()
		.integer()
		.positive()
		.allow(0) // Allow 0 because it's not regarded as positive even though it's a valid file size
		.required(),
});

// TODO: async await code inside (not callback hell)
const startUploadApi = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);
	let { fileSize } = req.body; // fileSize is the encrypted file size (aka the size on the server)

	// Check with schema
	try {
		await startUploadSchema.validateAsync({ fileSize: fileSize });
	} catch (error) {
		res.sendStatus(400);
		return;
	}

	// TODO: max file size plz (plus check quota) (e.g 32 GB max size) or not? maybe dont need max file size, it wont matter
	
	// Generate a new handle
	const handle = generateSecureRandomAlphaNumericString(CONSTANTS.FILE_HANDLE_LENGTH);
	const uploadFilePath = path.join(env.USER_UPLOAD_TEMPORARY_STORAGE_PATH, handle + CONSTANTS.ENCRYPTED_FILE_NAME_EXTENSION);

	// Open destination file
	let uploadFileHandle: fs.promises.FileHandle;

	try {
		uploadFileHandle = await fs.promises.open(uploadFilePath, "w");
	} catch (error) {
		console.error(error);
		res.sendStatus(500);
		return;
	}

	// Initialise destination file by appending the file header
	try {
		const header = Buffer.alloc(CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE);
		header.set(CONSTANTS.ENCRYPTED_FILE_MAGIC_NUMBER, 0);

		await uploadFileHandle.appendFile(header);
	} catch (error) {
		console.error(error);
		res.sendStatus(500);
		await uploadFileHandle.close(); // Close (TODO: unlink but tbf this error should never happen, so therefore, a low priority issue)
		return;
	}
	
	// Create upload entry
	let entry: UploadEntry = {
		handle: handle,
		userId: sessionInfo.userId,
		fileSize: fileSize,
		writtenBytes: CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE,
		prevWrittenChunkId: -1,
		uploadFileHandle: uploadFileHandle,
		uploadFilePath: uploadFilePath,
		mutex: new Mutex()
	};
	
	uploadTransferEntries[handle] = entry;

	// Respond with success
	res.json({ message: "Success!", handle: handle });
}

const cancelUploadSchema = Joi.object({
	handle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
		.alphanum()
		.required()
});

const cancelUploadApi = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);
	const { handle } = req.body;

	// Check with schema
	try {
		await cancelUploadSchema.validateAsync({
			handle: handle
		});
	} catch (error) {
		res.sendStatus(400);
		return;
	}
	
	const uploadEntry = uploadTransferEntries[handle];
	
	if (uploadEntry == undefined) {
		res.sendStatus(400);
		return;
	}

	// Ensure this is the user's handle
	if (uploadEntry.userId != sessionInfo.userId) {
		res.sendStatus(400);
		return;
	}

	const uploadFilePath = uploadEntry.uploadFilePath;
	const uploadFileHandle = uploadEntry.uploadFileHandle;

	// Delete the upload entry
	delete uploadTransferEntries[handle];

	// Try close the file
	try {
		await uploadFileHandle.close();
	} catch (error) {
		console.error(`Failed to close upload destination file! Error: ${error}`);
		res.sendStatus(500);
		return;
	}

	// Try delete the temporary upload file
	try {
		await fs.promises.unlink(uploadFilePath);
	} catch (error) {
		console.error(`Cancel upload unlink file error: ${error}`);
		res.sendStatus(500);
		return;
	}

	res.sendStatus(200);
}

// This API is called when the user logs into treasury
const cleanUploadsApi = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);

	// TODO:
}

const finaliseUploadSchema = Joi.object({
	handle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
		.alphanum()
		.required(),

	encryptedMetadataB64: Joi.string()
		.base64()
		.max(CONSTANTS.ENCRYPTED_FILE_METADATA_MAX_SIZE, "base64")
		.required(),
		
	encryptedFileCryptKeyB64: Joi.string()
		.base64()
		.length(CONSTANTS.ENCRYPTED_CRYPT_KEY_SIZE, "base64")
		.required(),
	
	signature: Joi.string()
		.hex()
		.length(CONSTANTS.ED25519_SIGNATURE_BYTE_LENGTH, "hex")
		.required()
});

const finaliseUploadApi = async (req: any, res: any) => {
	const userSession = getUserSessionInfo(req);
	const { handle, encryptedMetadataB64, encryptedFileCryptKeyB64, signature } = req.body;

	// Check with schema
	try {
		await finaliseUploadSchema.validateAsync(req.body);
	} catch (error) {
		console.log(error);
		res.status(400).json({ message: "Bad request!" });
		return;
	}

	let transferEntry = uploadTransferEntries[handle];
	
	if (transferEntry == undefined) {
		res.status(400).json({ message: "Invalid handle!" });
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.userId != userSession.userId) {
		res.status(403).json({ message: "Invalid handle!" });
		return;
	}

	// Ensure user has written their specified number of bytes
	if (transferEntry.writtenBytes != transferEntry.fileSize) {
		res.status(400).json({ message: "Not enough data has been written!" });
		return;
	}

	// Close the file
	const release = await transferEntry.mutex.acquire();

	try {
		await transferEntry.uploadFileHandle.close();
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "SERVER ERROR!" });
		return;
	} finally {
		release();
	}
	
	// Delete transfer entry
	const { uploadFilePath, fileSize } = transferEntry;
	delete uploadTransferEntries[handle];

	// Move uploaded file to user file storage path
	try {
		const sourcePath = uploadFilePath;
		const newPath = path.join(env.USER_FILE_STORAGE_PATH, handle + CONSTANTS.ENCRYPTED_FILE_NAME_EXTENSION);

		await fs.promises.rename(sourcePath, newPath);
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "SERVER ERROR!" });
		return;
	}

	// Create database entry
	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance();

		const fileInfo: FileInfo = {
			handle: handle,
			size: fileSize,
			encryptedFileCryptKey: Buffer.from(base64js.toByteArray(encryptedFileCryptKeyB64)),
			encryptedMetadata: Buffer.from(base64js.toByteArray(encryptedMetadataB64)),
			signature: signature
		};

		database.createFileEntry(userSession.userId, fileInfo);
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "SERVER ERROR!" });
		return;
	}

	res.sendStatus(200);
}

const uploadChunkSchema = Joi.object({
	handle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
		.alphanum()
		.required(),

	chunkId: Joi.number()
		.min(0)
		.max(CONSTANTS.MAX_SIGNED_32_BIT_INTEGER)
		.integer()
		.required(),
});

// TODO: maybe just use sendStatus everywhere instead, unless absolutely need a message?

type BufferedChunk = {
	chunkBuffer: Buffer,
	chunkId: number
};

type BufferedChunkStorageDictionary = { [handle: string]: BufferedChunk[] };
const globalUploadBufferedChunkDictionary: BufferedChunkStorageDictionary = {};

// TODO: cancel upload on server side when any errors are thrown!

const uploadChunkApi = async (req: any, res: any) => {
	if (req.file == undefined) {
		res.sendStatus(400);
		return;
	}

	const sessionInfo = getUserSessionInfo(req);
	const { handle, chunkId } = req.body;
	const receivedChunkBuffer = req.file.buffer; // Should contain nonce at beginning and poly1305 tag at the end
	const receivedChunkSize = receivedChunkBuffer.byteLength;

	// Check with schema
	try {
		await uploadChunkSchema.validateAsync({
			handle: handle,
			chunkId: chunkId
		});
	} catch (error) {
		console.log(error);
		res.sendStatus(400);
		return;
	}

	// Get transfer handle and confirm that it exists
	const transferEntry = uploadTransferEntries[handle];
	
	if (transferEntry == undefined) {
		res.sendStatus(400);
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.userId != sessionInfo.userId) {
		res.sendStatus(400);
		return;
	}

	// Create full chunk buffer by adding the header and also convert to Uint8Array
	const newBufferedChunk: BufferedChunk = {
		chunkBuffer: createFullEncryptedChunkBuffer(chunkId, receivedChunkBuffer),
		chunkId: chunkId
	};

	// Create new storage if not created already
	if (globalUploadBufferedChunkDictionary[handle] == undefined) {
		globalUploadBufferedChunkDictionary[handle] = [];
	}
	
	// Append this new chunk to the buffered chunks
	const bufferedChunkList = globalUploadBufferedChunkDictionary[handle];
	bufferedChunkList.push(newBufferedChunk);

	// Check if too many chunks are buffered
	if (bufferedChunkList.length > CONSTANTS.MAX_TRANSFER_PARALLEL_CHUNKS + 1) {
		console.error("User has too many chunks buffered!");
		res.sendStatus(429); // Too many requests
		return;
	}

	// Sort buffered chunks by their chunk id in ascending order
	bufferedChunkList.sort((a, b) => a.chunkId < b.chunkId ? -1 : 1);

	// Append as many chunks in order as possible
	let appendedBufferIndices: number[] = [];

	for (let i = 0; i < bufferedChunkList.length; i++) {
		const bufferedChunkInfo = bufferedChunkList[i];
		const bufferedChunkId = bufferedChunkInfo.chunkId;
		const bufferedChunk = bufferedChunkInfo.chunkBuffer;

		//console.log(`loop: cid: ${bufferedChunk.chunkId} pwcid: ${transferEntry.prevWrittenChunkId}`);

		const release = await transferEntry.mutex.acquire();
		
		try {
			if (bufferedChunkId - transferEntry.prevWrittenChunkId == 1) {
				transferEntry.prevWrittenChunkId = bufferedChunkId;

				// Calculate the expected chunk size
				const bytesLeftToWrite = Math.max(transferEntry.fileSize - transferEntry.writtenBytes, 0);
				const expectedFullChunkSize = Math.min(bytesLeftToWrite, CONSTANTS.CHUNK_FULL_SIZE);

				// Check if user is writing too much data
				if (bytesLeftToWrite == 0) {
					console.error("User wrote too much data!");
					res.sendStatus(413);
					return;
				}

				// console.log(`trying to write chunk ${bufferedChunkId} of size: ${bufferedChunk.byteLength}. Expected size: ${expectedFullChunkSize}`);

				// Verify chunk size
				if (bufferedChunk.byteLength != expectedFullChunkSize || bytesLeftToWrite == 0) {
					console.error(`failed: cs: ${bufferedChunk.byteLength} ecds: ${expectedFullChunkSize} bltw: ${bytesLeftToWrite}`);
					console.error(`stats: final expected size: ${transferEntry.fileSize}`);
					res.sendStatus(400);
					return;
				}

				// Append
				await transferEntry.uploadFileHandle.appendFile(bufferedChunk);
				transferEntry.writtenBytes += bufferedChunk.byteLength;
				appendedBufferIndices.push(i);
			}
		} catch (error) {
			console.error(`Append buffer to file error: ${error}`);
			res.status(500);
		} finally {
			release();
		}
	};

	// Sort in descending order to avoid indice shifting issues  
	appendedBufferIndices.sort((a, b) => a < b ? 1 : -1);
	
	// Delete buffered chunks that have been written
	appendedBufferIndices.forEach(indice => bufferedChunkList.splice(indice, 1));

	res.sendStatus(200);
}

export {
  startUploadApi,
  cancelUploadApi,
  cleanUploadsApi,
  finaliseUploadApi,
  uploadChunkApi
}
