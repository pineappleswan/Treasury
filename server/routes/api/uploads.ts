import { getLoggedInUsername, getUserSessionInfo } from "../../utility/authentication";
import { generateSecureRandomAlphaNumericString } from "../../../src/common/commonCrypto";
import { encodeSignedIntAsFourBytes, hexStringToUint8Array, uint8ArrayToHexString } from "../../../src/common/commonUtils";
import { Mutex } from "async-mutex"
import { FileInfo, TreasuryDatabase } from "../../database/database";
import base64js from "base64-js";
import Joi from "joi";
import fs from "fs";
import path from "path";
import CONSTANTS from "../../../src/common/constants";
import env from "../../env";
import { A } from "@solidjs/router";

type UploadEntry = {
	handle: string,
	userId: number,
	fileSize: number, // The encrypted file size (not the raw original file size)
	writtenBytes: number, // Stores how many bytes have been written to the file
	prevWrittenChunkId: number, // Helps ensure that chunks are written in the correct order (MUST BE -1 INITIALLY!)
	uploadFileHandle: fs.promises.FileHandle,
	uploadFilePath: string, // The full path where the temporary upload file will be stored at
	//mutex: Mutex // Used to prevent data races when accessing values from async functions/routes
};

type UploadEntryDictionary = {
	[key: string]: UploadEntry
};

let uploadTransferEntries: UploadEntryDictionary = {};

// TODO: remove dead handles function (requested from the client everytime they load their page) (how: store new value of last time written data to entry data, and clear any over a certain time e.g 60 seconds)
// TODO: instead of deleting entry when transfer failed, better to have a cancelled boolean and check against that, then only delete entry when user clears uploads...
// TODO: when a chunk fails to upload, delete destination file on server immediately plz.
// TODO: handle upload fails in a better way...

// TODO: async await???
function deleteTransferAndTemporaryFile(handle: string) {
	const entry = uploadTransferEntries[handle];

	if (entry) {
		const uploadFilePath = entry.uploadFilePath;
		delete uploadTransferEntries[handle];
		
		console.log(`deleting transfer and temporary file: ${uploadFilePath}`);
		
		fs.unlink(uploadFilePath, (error) => {
			if (error) {
				console.error(`Failed to unlink temporary upload file at "${uploadFilePath}" error: ${error}`);
			}
		});
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
	let { fileSize } = req.body;

	// Check with schema
	try {
		await startUploadSchema.validateAsync({ fileSize: fileSize });
	} catch (error) {
		res.status(400).json({ message: "Bad request!" });
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
		res.status(500).json({ message: "SERVER ERROR!" });
		return;
	}

	// Initialise destination file by appending the file header
	try {
		const header = Buffer.alloc(CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE);
		header.set(CONSTANTS.ENCRYPTED_FILE_MAGIC_NUMBER, 0);
		header.set(encodeSignedIntAsFourBytes(CONSTANTS.ENCRYPTED_CHUNK_FULL_SIZE), 4);

		await uploadFileHandle.appendFile(header);
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "SERVER ERROR!" });
		await uploadFileHandle.close(); // Close
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
		uploadFilePath: uploadFilePath
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
		res.status(400).json({ message: "Bad request!" });
		return;
	}

	const uploadEntry = uploadTransferEntries[handle];
	
	if (uploadEntry == undefined) {
		res.status(400).json({ message: "Invalid handle!" });
		return;
	}

	// Ensure this is the user's handle
	if (uploadEntry.userId != sessionInfo.userId) {
		res.status(400).json({ message: "Invalid handle!" });
		return;
	}

	const uploadFilePath = uploadEntry.uploadFilePath;
	const uploadFileHandle = uploadEntry.uploadFileHandle;

	// Delete the upload entry
	delete uploadTransferEntries[handle];

	// Try close the file
	let isTreasuryFile = true;

	try {
		// Confirm it's a treasury file while it's still open
		const magic = Buffer.alloc(4);
		await uploadFileHandle.read(magic, 0, 4, 0);

		for (let i = 0; i < magic.length; i++) {
			if (CONSTANTS.ENCRYPTED_FILE_MAGIC_NUMBER[i] != magic[i]) {
				isTreasuryFile = false;
				break;
			}
		}
		
		// Close
		await uploadFileHandle.close();
	} catch (error) {
		console.error(`Failed to close upload destination file! Error: ${error}`);
		res.status(500).json({ message: "SERVER ERROR!" });
		return;
	}
	
	// Confirm it's a treasury file before deleting (better safe than sorry!)
	if (!isTreasuryFile) {
		console.error(`CRITICAL: Cancelling upload file and read header but it does not match the treasury file magic! Path: ${uploadFilePath}`);
		res.status(500).json({ message: "SERVER ERROR!" });
		return;
	}

	// Try delete the temporary upload file
	try {
		await fs.promises.unlink(uploadFilePath);
	} catch (error) {
		console.error(`Cancel upload unlink file error: ${error}`);
		res.status(500).json({ message: "SERVER ERROR!" });
		return;
	}

	res.sendStatus(200);
}

// This API is called when the user logs into treasury
const cleanUploadsApi = async (req: any, res: any) => {
	const username = getLoggedInUsername(req);

	// TODO:
}

const finaliseUploadSchema = Joi.object({
	handle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
		.alphanum()
		.required(),

	encryptedMetadataB64: Joi.string()
		.base64()
		.required(),
		
	encryptedFileCryptKeyB64: Joi.string()
		.base64()
		.required()
});

// TODO: MAKE ALL ASYNC
const finaliseUploadApi = async (req: any, res: any) => {
	const userSession = getUserSessionInfo(req);
	const { handle, encryptedMetadataB64, encryptedFileCryptKeyB64 } = req.body;

	// Check with schema
	try {
		await finaliseUploadSchema.validateAsync({
			handle: handle,
			encryptedMetadataB64: encryptedMetadataB64,
			encryptedFileCryptKeyB64: encryptedFileCryptKeyB64
		});

		// Check length
		if (base64js.toByteArray(encryptedFileCryptKeyB64).byteLength != CONSTANTS.ENCRYPTED_CRYPT_KEY_SIZE) {
			throw new Error("encryptedFileCryptKeyB64 size is incorrect!");
		}
		
		if (base64js.toByteArray(encryptedMetadataB64).byteLength > CONSTANTS.ENCRYPTED_FILE_METADATA_MAX_SIZE) {
			throw new Error("encryptedMetadataB64 is too big!");
		}
	} catch (error) {
		//console.log(error);
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
	try {
		await transferEntry.uploadFileHandle.close();
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "SERVER ERROR!" });
		return;
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
			encryptedMetadata: Buffer.from(base64js.toByteArray(encryptedMetadataB64))
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
		.allow(0) // Allow 0 because it's not regarded as positive even though it's a valid chunk id
		.positive()
		.integer()
		.required()
});

// TODO: need much more simple chunk buffering system without the use of intervals/timeouts. better error handling and cancelling the upload (i.e delete entry and also the file)
const uploadChunkApi = async (req: any, res: any) => {
	if (req.file == undefined) {
		res.status(400).json({ message: "No file was uploaded!" });
		return;
	}

	const sessionInfo = getUserSessionInfo(req);
	const { handle, chunkId } = req.body;
	const chunkBuffer = req.file.buffer;

	// Check with schema
	try {
		await uploadChunkSchema.validateAsync({
			handle: handle,
			chunkId: chunkId
		});
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
	if (transferEntry.userId != sessionInfo.userId) {
		res.status(400).json({ message: "Invalid handle!" });
		return;
	}

	// TODO: error handling! if error then cancel upload!
	const appendBufferToFile = async () => {
		try {
			// Check chunk size
			// Will fail if the chunk size does not match the config AND it isn't trying to write the remaining bytes of the file where
			// it makes sense that the chunkSize would be different
			const chunkSize = chunkBuffer.byteLength;
			const bytesLeftToWrite = transferEntry.fileSize - transferEntry.writtenBytes;

			if (chunkSize != CONSTANTS.ENCRYPTED_CHUNK_FULL_SIZE && chunkSize != bytesLeftToWrite) {
				// console.error(`failed: cs: ${chunkSize} ecfs: ${ENCRYPTED_CHUNK_FULL_SIZE} bltw: ${bytesLeftToWrite}`);
				res.status(400).json({ message: "Incorrect chunk size!" });
				return;
			}

			// Ensure user does not upload more data than they requested
			if (transferEntry.writtenBytes + chunkSize > transferEntry.fileSize) {
				res.status(413).json({ message: "Wrote too much data!" });
				return;
			}

			transferEntry.writtenBytes += chunkSize;
			transferEntry.prevWrittenChunkId = chunkId;
			
			try {
				await fs.promises.appendFile(transferEntry.uploadFilePath, chunkBuffer);
				
				// Successful upload of chunk here
				res.sendStatus(200);
			} catch (error) {
				console.error(`Append buffer to file error: ${error}`);
				res.status(500).json({ message: "Failed to upload chunk" }); // TODO: fail chunk function? prevent code repeating
			}
		} catch (error) {
			console.error(`Failed to append buffer to file for reason: ${error}`);
		}
	};

	// If the current chunk arrives ahead of time, then buffer it until the next chunk gets written.
	let timeSpentRetrying = 0;

	const tryAppendChunk = async () => {
		//let prevWrittenChunkId = await getPrevWrittenChunkId();
		let prevWrittenChunkId = transferEntry.prevWrittenChunkId;
		let chunkIdDifference = chunkId - prevWrittenChunkId;

		// If this chunk should come next in the file, then proceed. Otherwise, buffer it.
		if (chunkIdDifference == 1) {
			await appendBufferToFile();
		} else {
			// Check if too many chunks are being buffered by this user
			if (chunkId - prevWrittenChunkId > CONSTANTS.MAX_TRANSFER_PARALLEL_CHUNKS) {
				// Cancel the upload
				deleteTransferAndTemporaryFile(handle);
				res.status(400).json({ message: "Too many chunks are buffered" });
				return;
			}

			// console.log(`buffered: ${chunkId} prev: ${prevWrittenChunkId}`);

			// Cap the amount of time the server can spend trying to write a buffered chunk to the file
			if (timeSpentRetrying > CONSTANTS.BUFFERED_CHUNK_WRITE_RETRY_TIMEOUT_MS) {
				// Cancel the upload
				deleteTransferAndTemporaryFile(handle);
				res.status(400).json({ message: "Chunk buffered for too long" });
			} else {
				timeSpentRetrying += CONSTANTS.BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS;
				setTimeout(tryAppendChunk, CONSTANTS.BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS);
			}
		}
	};

	await tryAppendChunk();
}

export {
  startUploadApi,
  cancelUploadApi,
  cleanUploadsApi,
  finaliseUploadApi,
  uploadChunkApi
}
