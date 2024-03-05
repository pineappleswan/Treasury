import { getLoggedInUsername } from "../../utility/authentication";
import { generateSecureRandomAlphaNumericString } from "../../serverCrypto";
import { encodeSignedIntAsFourBytes } from "../../../src/common/common";
import { Mutex } from "async-mutex"
import fs from "fs";
import path from "path";
import CONSTANTS from "../../../src/common/constants";
import env from "../../env";

type UploadTransferEntry = {
	handle: string,
	username: string,
	fileSize: number,
	chunkCount: number, // TODO: i dont think this value is needed anymore
	writtenBytes: number, // Stores how many bytes have been written to the file
	prevWrittenChunkId: number, // Helps ensure that chunks are written in the correct order (MUST BE -1 INITIALLY!)
	uploadFileDescriptor: number | null,
	uploadFilePath: string, // The path where the temporary upload file will be stored at
	mutex: Mutex // Used to prevent data races when accessing values from async functions/routes
};

type UploadTransferEntryDictionary = {
	[key: string]: UploadTransferEntry
};

let uploadTransferEntries: UploadTransferEntryDictionary = {};

// TODO: remove dead handles function (requested from the client everytime they load their page)
// TODO: instead of deleting entry when transfer failed, better to have a cancelled boolean and check against that, then only delete entry when user clears uploads...
// TODO: when a chunk fails to upload, delete destination file on server immediately plz.
// TODO: move this function elsewhere... some uploading server .ts file
function createUploadTransferEntry(username: string, fileSize: number, chunkCount: number) {
	const handle = generateSecureRandomAlphaNumericString(CONSTANTS.FILE_HANDLE_LENGTH);
	const uploadFilePath = path.join(env.USER_UPLOAD_TEMPORARY_STORAGE_PATH!, handle);

	let entry: UploadTransferEntry = {
		handle: handle,
		username: username,
		fileSize: fileSize,
		chunkCount: chunkCount,
		writtenBytes: 0, // Stores how many bytes have been written to the file
		prevWrittenChunkId: -1, // Helps ensure that chunks are written in the correct order (MUST BE -1 INITIALLY!)
		uploadFileDescriptor: null,
		uploadFilePath: uploadFilePath,
		mutex: new Mutex()
	};
	
	uploadTransferEntries[handle] = entry;
	return entry;
}

const startUploadApi = (req: any, res: any) => {
	const username = getLoggedInUsername(req);
	const { encFileCryptKeyWithNonceStr, fileSize, chunkCount } = req.body;

	if (typeof(fileSize) != "number") {
		res.status(400).json({ success: false, message: "fileSize must be a number!" });
		return;
	}

	if (typeof(chunkCount) != "number") {
		res.status(400).json({ success: false, message: "chunkCount must be a number!" });
		return;
	}

	// TODO: max file size plz (plus check quota) (e.g 32 GB max size) or not? maybe dont need max file size, it wont matter

	//console.log(`Upload start: encFileCryptKeyWithNonceStr ${encFileCryptKeyWithNonceStr}`);
	//console.log(`As blob: ${hexStringToUint8Array(encFileCryptKeyWithNonceStr)}`); // TODO: STORE ON SERVER AS BLOB

	// Create upload transfer entry
	const uploadEntry = createUploadTransferEntry(username, fileSize, chunkCount);

	// Open new transfer destination file
	try {
		fs.open(uploadEntry.uploadFilePath, "w", (error, fileDescriptor) => {
			if (error)
				throw error;

			uploadEntry.uploadFileDescriptor = fileDescriptor;

			// Append magic number + chunk count + chunk size
			const header = Buffer.alloc(12);
			header.set(CONSTANTS.ENCRYPTED_FILE_MAGIC_NUMBER, 0);
			header.set(encodeSignedIntAsFourBytes(chunkCount), 4);
			header.set(encodeSignedIntAsFourBytes(CONSTANTS.ENCRYPTED_CHUNK_FULL_SIZE), 8);

			fs.appendFile(fileDescriptor, header, (error) => {
				if (error) {
					throw error;
				} else {
					uploadEntry.writtenBytes = header.byteLength;
				}
			});
		});
		
		res.json({ success: true,	message: "", handle: uploadEntry.handle });
	} catch (error) {
		res.status(500).json({ success: false, message: "SERVER ERROR!" });
		console.error(error);
		return;
	}
}

const cancelUploadApi = async (req: any, res: any) => {
	const username = getLoggedInUsername(req);
	const handle = req.body.handle;

	if (typeof(handle) != "string") {
		res.status(400).json({success: false, message: "handle must be a string!" });
		return;
	}

	const transferEntry = uploadTransferEntries[handle];
	
	if (transferEntry == undefined) {
		res.status(400).json({ success: false, message: "invalid handle!" });
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.username != username) {
		res.status(403).json({ success: false, message: "not your handle!" });
		return;
	}

	const uploadFilePath = transferEntry.uploadFilePath;
	const fileDescriptor = transferEntry.uploadFileDescriptor;
	delete uploadTransferEntries[handle];

	if (fileDescriptor == null) {
		console.error(`Trying to cancel upload with a null uploadFileDescriptor`);
		return;
	}

	// Try close the file
	fs.close(fileDescriptor, (error) => {
		if (error) {
			console.error(`FAILED TO CLOSE FILE! fd: ${fileDescriptor} message: ${error}`);
			res.status(500).json({ success: false, message: "SERVER ERROR!" });
		}
	});

	// Try remove upload file
	fs.unlink(uploadFilePath, (error) => {
		if (error) {
			console.error(`Cancel upload unlink file error: ${error}`);
			res.status(500).json({ success: false, message: "SERVER ERROR!" });
		} else {
			res.sendStatus(200);
		}
	});
}

const cancelAllUploadsApi = (req: any, res: any) => {

}

const finaliseUploadApi = (req: any, res: any) => {
	const username = getLoggedInUsername(req);
	const handle = req.body.handle;

	if (typeof(handle) != "string") {
		res.status(400).json({success: false, message: "handle must be a string!" });
		return;
	}

	let transferEntry = uploadTransferEntries[handle];
	
	if (transferEntry == undefined) {
		res.status(400).json({ success: false, message: "invalid handle!" });
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.username != username) {
		res.status(403).json({ success: false, message: "not your handle!" });
		return;
	}

	// Ensure user has written their specified number of bytes
	if (transferEntry.writtenBytes != transferEntry.fileSize) {
		res.status(400).json({ success: false, message: "not enough data has been written!" });
		return;
	}

	if (transferEntry.uploadFileDescriptor == null) {
		console.error(`Trying to finalise a transfer entry with a null uploadFileDescriptor! Handle: ${transferEntry.uploadFileDescriptor}`);
		return;
	}

	// Close the file
	fs.close(transferEntry.uploadFileDescriptor, (error) => {
		if (error) {
			console.error(error);
			delete uploadTransferEntries[handle];
			res.status(500).json({ success: false, message: "couldnt finalise transfer!", cancelUpload: true });
			return;
		} else {
			console.log(`Successfully finalised upload: ${handle}`);
			res.sendStatus(200);
			delete uploadTransferEntries[handle];
		}
	});
}

const uploadChunkApi = async (req: any, res: any) => {
	if (req.file == undefined) {
		res.status(400).json({success: false, message: "No file was uploaded!" });
		return;
	}

	const username = getLoggedInUsername(req);
	const handle = req.body.handle;
	const chunkId = parseInt(req.body.chunkId);
	const chunkBuffer = req.file.buffer;

	if (typeof(handle) != "string") {
		res.status(400).json({success: false, message: "Handle must be a string!" });
		return;
	}

	if (isNaN(chunkId)) {
		res.status(400).json({success: false, message: "chunkId must be a valid number!" });
		return;
	}

	let transferEntry = uploadTransferEntries[handle];
	
	if (transferEntry == undefined) {
		res.status(400).json({ success: false, message: "Invalid handle!" });
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.username != username) {
		res.status(403).json({ success: false, message: "Invalid handle!" });
		return;
	}

	const appendBufferToFile = async () => {
		const release = await transferEntry.mutex.acquire();

		try {
			// console.log(`Appending: ${chunkId}`);

			// Check chunk size
			// Will fail if the chunk size does not match the config AND it isn't trying to write the remaining bytes of the file where
			// it makes sense that the chunkSize would be different
			const chunkSize = chunkBuffer.byteLength;
			const bytesLeftToWrite = transferEntry.fileSize - transferEntry.writtenBytes;

			if (chunkSize != CONSTANTS.ENCRYPTED_CHUNK_FULL_SIZE && chunkSize != bytesLeftToWrite) {
				// console.error(`failed: cs: ${chunkSize} ecfs: ${ENCRYPTED_CHUNK_FULL_SIZE} bltw: ${bytesLeftToWrite}`);
				res.status(400).json({ success: false, message: "incorrect chunk size!" });
				return;
			}

			// Ensure user does not upload more data than they requested
			if (transferEntry.writtenBytes + chunkSize > transferEntry.fileSize) {
				res.status(413).json({ success: false, message: "wrote too much data!" });
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
				res.status(500).json({ success: false, message: "Failed to upload chunk" }); // TODO: fail chunk function? prevent code repeating
			}
		} catch (error) {
			console.error(`Failed to append buffer to file for reason: ${error}`);
		} finally {
			release();
		};
	};

	// Helps prevent data races
	const getPrevWrittenChunkId = async () => {
		const release = await transferEntry.mutex.acquire();
		
		try {
			return transferEntry.prevWrittenChunkId;
		} finally {
			release();
		}
	};

	// If the current chunk arrives ahead of time, then buffer it until the next chunk gets written.
	const retryDelayMs = CONSTANTS.BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS;
	let timeSpentRetrying = 0;

	const tryAppendChunk = async () => {
		let prevWrittenChunkId = await getPrevWrittenChunkId();
		let chunkIdDifference = chunkId - prevWrittenChunkId;

		// If this chunk should come next in the file, then proceed. Otherwise, buffer it.
		if (chunkIdDifference == 1) {
			await appendBufferToFile();
		} else {
			// Check if too many chunks are being buffered by this user
			if (chunkId - prevWrittenChunkId > CONSTANTS.MAX_TRANSFER_BUSY_CHUNKS) {
				// Cancel the upload
				delete uploadTransferEntries[handle];
				res.status(400).json({ success: false, message: "Too many chunks are buffered", cancelUpload: true });
				return;
			}

			// console.log(`buffered: ${chunkId} prev: ${prevWrittenChunkId}`);

			// Cap the amount of time the server can spend trying to write a buffered chunk to the file
			if (timeSpentRetrying > CONSTANTS.BUFFERED_CHUNK_WRITE_RETRY_TIMEOUT_MS) {
				// Cancel the upload
				delete uploadTransferEntries[handle];
				res.status(400).json({ success: false, message: "Chunk buffered for too long", cancelUpload: true });
			} else {
				timeSpentRetrying += retryDelayMs;
				setTimeout(tryAppendChunk, retryDelayMs);
			}
		}
	};

	await tryAppendChunk();

	/*
	if (!res.headersSent) {
		console.error("No headers were sent in uploadchunk route!");
		res.status(500).json({ success: false, message: "SERVER ERROR" });
	}
	*/
}

export {
  startUploadApi,
  cancelUploadApi,
  cancelAllUploadsApi,
  finaliseUploadApi,
  uploadChunkApi
}
