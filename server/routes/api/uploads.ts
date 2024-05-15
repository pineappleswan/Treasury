import { getUserSessionInfo } from "../../utility/authUtils";
import { generateSecureRandomAlphaNumericString, verifyChunkMagic } from "../../../src/common/commonCrypto";
import { Mutex } from "async-mutex"
import { ServerFileInfo, TreasuryDatabase } from "../../database/database";
import base64js from "base64-js";
import Joi from "joi";
import fs from "fs";
import path from "path";
import CONSTANTS from "../../../src/common/constants";
import env from "../../env";
import { getOriginalFileSizeFromEncryptedFileSize } from "../../../src/common/commonUtils";

type UploadEntry = {
	handle: string;
	userId: number; // The id of the user that uploaded the file
	fileSize: number; // The encrypted file size (not the raw original file size)
	writtenBytes: number; // Stores how many bytes have been written to the file
	prevWrittenChunkId: number; // Helps ensure that chunks are written in the correct order (MUST BE -1 INITIALLY!)
	uploadFileHandle: fs.promises.FileHandle;
	uploadFilePath: string; // The full path where the temporary upload file will be stored at
	mutex: Mutex; // Used to prevent data races
};

const uploadEntryMap = new Map<string, UploadEntry>();

async function cancelUploadTransferAsync(handle: string) {
	const entry = uploadEntryMap.get(handle);

	if (entry) {
		const uploadFilePath = entry.uploadFilePath;
		console.log(`cancelling and deleting upload transfer at: ${uploadFilePath}`);

		uploadEntryMap.delete(handle);

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
		.max(CONSTANTS.MAX_FILE_SIZE)
		.min(CONSTANTS.CHUNK_EXTRA_DATA_SIZE) // Anything below this value is invalid
		.allow(0) // Allow 0 because it's not regarded as positive even though it's a valid file size
		.required()
});

const startUploadApi = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);
	const { fileSize } = req.body; // fileSize is the encrypted file size (aka the size on the server)

	// Check with schema
	try {
		await startUploadSchema.validateAsync({ fileSize: fileSize });
	} catch (error) {
		console.error(`User (${sessionInfo.userId}) tried to start upload but failed the schema!`);
		res.sendStatus(400);

		if (env.DEVELOPMENT_MODE)
			console.error(error);

		return;
	}

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
	uploadEntryMap.set(handle, {
		handle: handle,
		userId: sessionInfo.userId!,
		fileSize: fileSize,
		writtenBytes: CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE,
		prevWrittenChunkId: -1,
		uploadFileHandle: uploadFileHandle,
		uploadFilePath: uploadFilePath,
		mutex: new Mutex()
	});

	// Respond with the new upload handle
	res.json({ handle: handle });
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
		console.error(`User (${sessionInfo.userId}) tried to cancel upload but failed the schema!`);

		if (env.DEVELOPMENT_MODE)
			console.error(error);

		return;
	}
	
	const uploadEntry = uploadEntryMap.get(handle);
	
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
	
	// Try close the file
	try {
		await uploadEntry.uploadFileHandle.close();
	} catch (error) {
		console.error(`Failed to close upload destination file! Error: ${error}`);
		res.sendStatus(500);
		return;
	}

	// Delete the upload entry
	uploadEntryMap.delete(handle);

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

const finaliseUploadSchema = Joi.object({
	handle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
		.alphanum()
		.required(),

	parentHandle: Joi.string()
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
		.base64()
		.length(CONSTANTS.ED25519_SIGNATURE_BYTE_LENGTH, "base64")
		.required()
});

const finaliseUploadApi = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);
	const { handle, parentHandle, encryptedMetadataB64, encryptedFileCryptKeyB64, signature } = req.body;

	// Check with schema
	try {
		await finaliseUploadSchema.validateAsync(req.body);
	} catch (error) {
		res.sendStatus(400);
		console.error(`User (${sessionInfo.userId}) tried to finalise upload but failed the schema!`);

		if (env.DEVELOPMENT_MODE)
			console.error(error);

		return;
	}
	
	const transferEntry = uploadEntryMap.get(handle);
	
	if (transferEntry == undefined) {
		console.error(`User (${sessionInfo.userId}) tried to finalise transfer with invalid handle!`);
		res.sendStatus(400);
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.userId != sessionInfo.userId) {
		console.error(`User (${sessionInfo.userId}) tried to finalise upload with handle that doesn't belong to them!`);
		res.sendStatus(400);
		return;
	}

	// Acquire mutex
	const release = await transferEntry.mutex.acquire();

	try {
		// Ensure user has written their specified number of bytes
		if (transferEntry.writtenBytes != transferEntry.fileSize) {
			console.error(`User (${sessionInfo.userId}) tried to finalise upload with incorrect written bytes! Written: ${transferEntry.writtenBytes} Reserved: ${transferEntry.fileSize}`);
			res.sendStatus(400);
			return;
		}

		await transferEntry.uploadFileHandle.close();
	} catch (error) {
		console.error(error);
		res.sendStatus(500);
		return;
	} finally {
		release();
	}
	
	// Delete transfer entry
	const { uploadFilePath, fileSize } = transferEntry;
	uploadEntryMap.delete(handle);

	// Move uploaded file to user file storage path
	try {
		const sourcePath = uploadFilePath;
		const newPath = path.join(env.USER_FILE_STORAGE_PATH, handle + CONSTANTS.ENCRYPTED_FILE_NAME_EXTENSION);

		await fs.promises.rename(sourcePath, newPath);
	} catch (error) {
		console.error(error);
		res.sendStatus(500);
		return;
	}

	// Create database entry
	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance();
		const unencryptedSize = getOriginalFileSizeFromEncryptedFileSize(fileSize);

		const fileInfo: ServerFileInfo = {
			handle: handle,
			parentHandle: parentHandle,
			size: unencryptedSize,
			encryptedFileCryptKey: Buffer.from(base64js.toByteArray(encryptedFileCryptKeyB64)),
			encryptedMetadata: Buffer.from(base64js.toByteArray(encryptedMetadataB64)),
			signature: signature
		};

		database.createFileEntry(sessionInfo.userId, fileInfo);
	} catch (error) {
		console.error(error);
		res.sendStatus(500);
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

type BufferedChunk = {
	chunkBuffer: Buffer;
	chunkId: number;
};

const bufferedChunksMap = new Map<string, BufferedChunk[]>();

// TODO: cancel upload on server side when any errors are thrown!

const uploadChunkApi = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);

	if (req.file == undefined) {
		console.error(`User (${sessionInfo.userId}) tried to upload chunk but did not provide a file!`);
		res.sendStatus(400);
		return;
	}

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
		res.sendStatus(400);
		console.error(`User (${sessionInfo.userId}) tried to upload chunk but failed the schema!`);
		
		if (env.DEVELOPMENT_MODE)
			console.error(error);

		return;
	}

	// Get transfer handle and confirm that it exists
	const transferEntry = uploadEntryMap.get(handle);
	
	if (transferEntry == undefined) {
		console.error(`User (${sessionInfo.userId}) tried to upload chunk with invalid handle!`);
		res.sendStatus(400);
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.userId != sessionInfo.userId) {
		console.error(`User (${sessionInfo.userId}) tried to upload chunk to transfer entry with handle that doesn't belong to them!`);
		res.sendStatus(400);
		return;
	}

	// Validate the received chunk buffer. Check if size is less than chunk extra data size because in that case, the chunk is completely empty.
	if (receivedChunkSize < CONSTANTS.CHUNK_EXTRA_DATA_SIZE || receivedChunkSize > CONSTANTS.CHUNK_FULL_SIZE) {
		console.error(`User (${sessionInfo.userId}) tried to upload chunk with incorrect chunk size! Received chunk size: ${receivedChunkSize} `);
		res.sendStatus(400);
		return;
	}

	if (!verifyChunkMagic(receivedChunkBuffer)) {
		console.error(`User (${sessionInfo.userId}) tried to upload chunk with incorrect magic number!`);
		res.sendStatus(400);
		return;
	}

	// Create full chunk buffer by adding the header and also convert to Uint8Array
	const newBufferedChunk: BufferedChunk = {
		chunkBuffer: receivedChunkBuffer,
		chunkId: chunkId
	};

	// Create new storage if not created already
	if (!bufferedChunksMap.has(handle))
		bufferedChunksMap.set(handle, []);
	
	// Append this new chunk to the buffered chunks
	const bufferedChunkList = bufferedChunksMap.get(handle)!;
	bufferedChunkList.push(newBufferedChunk);

	// Check if too many chunks are buffered
	if (bufferedChunkList.length > CONSTANTS.MAX_UPLOAD_CONCURRENT_CHUNKS) {
		console.error(`User (${sessionInfo.userId}) has too many chunks buffered!`);
		res.sendStatus(429); // Too many requests
		return;
	}

	// Sort buffered chunks by their chunk id in ascending order
	bufferedChunkList.sort((a, b) => a.chunkId < b.chunkId ? -1 : 1);

	// Append as many chunks in order as possible
	let appendedBufferIndices: number[] = [];

	// Acquire mutex firstly
	const release = await transferEntry.mutex.acquire();
	
	try {
		for (let i = 0; i < bufferedChunkList.length; i++) {
			const bufferedChunkInfo = bufferedChunkList[i];
			const bufferedChunkId = bufferedChunkInfo.chunkId;
			const bufferedChunk = bufferedChunkInfo.chunkBuffer;

			//console.log(`loop: cid: ${bufferedChunk.chunkId} pwcid: ${transferEntry.prevWrittenChunkId}`);
			
			if (bufferedChunkId - transferEntry.prevWrittenChunkId == 1) {
				transferEntry.prevWrittenChunkId = bufferedChunkId;

				// Calculate the expected chunk size
				const bytesLeftToWrite = Math.max(transferEntry.fileSize - transferEntry.writtenBytes, 0);
				const expectedFullChunkSize = Math.min(bytesLeftToWrite, CONSTANTS.CHUNK_FULL_SIZE);

				// Check if user is writing too much data
				if (bytesLeftToWrite == 0) {
					console.error(`User (${sessionInfo.userId}) wrote too much data! Excess bytes: ${bufferedChunk.byteLength}`);
					res.sendStatus(413);
					return;
				}

				// console.log(`trying to write chunk ${bufferedChunkId} of size: ${bufferedChunk.byteLength}. Expected size: ${expectedFullChunkSize}`);

				// Verify chunk size
				if (bufferedChunk.byteLength != expectedFullChunkSize || bytesLeftToWrite == 0) {
					console.error(`User (${sessionInfo.userId}):`);
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
		};
	} catch (error) {
		console.error(`User (${sessionInfo.userId}): Append buffer to file error: ${error}`);
		res.status(500);
	} finally {
		release();
	}

	// Sort in descending order to avoid indice shifting issues  
	appendedBufferIndices.sort((a, b) => a < b ? 1 : -1);
	
	// Delete buffered chunks that have been written
	appendedBufferIndices.forEach(indice => bufferedChunkList.splice(indice, 1));

	res.sendStatus(200);
}

export {
	startUploadApi,
	cancelUploadApi,
	finaliseUploadApi,
	uploadChunkApi
}
