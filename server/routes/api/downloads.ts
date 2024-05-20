import { getUserSessionInfo } from "../../utility/authUtils";
import { TreasuryDatabase } from "../../database/database";
import { Mutex } from "async-mutex";
import { verifyFileChunkMagic } from "../../../src/common/commonUtils";
import fs from "fs";
import path from "path";
import CONSTANTS from "../../../src/common/constants";
import Joi from "joi";
import env from "../../env";

type DownloadRequest = {
	handle: string;
	ownerUserId: number; // The user who started the download AND who owns the file too (TODO: what if file is shared? hmmm)
	mutex: Mutex;
	expireTimeout: NodeJS.Timeout | undefined; // The timeout that will expire the download
	fileHandle: fs.promises.FileHandle;
	encryptedFileSize: number;
};

const downloadRequestMap = new Map<string, DownloadRequest>();

// API
const downloadChunkSchema = Joi.object({
	handle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
		.alphanum()
		.required(),
	
	chunkId: Joi.number()
		.integer()
		.allow(0) // Allow 0 because it's not regarded as positive even though it's a valid chunk id
		.positive()
		.min(0)
		.required()
});

const downloadChunkApi = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);
	const { handle, chunkId } = req.body;

	// Check with schema
	try {
		await downloadChunkSchema.validateAsync(req.body);
	} catch (error) {
		if (env.DEVELOPMENT_MODE)
			console.error(error);
		
		res.sendStatus(400);
		return;
	}

	let downloadRequest = downloadRequestMap.get(handle);

	// If entry doesn't exist, then open the target file and create a new download request
	if (downloadRequest === undefined) {
		const database = TreasuryDatabase.getInstance();
		const userFile = database.getUserFile(handle);

		// Ensure user file is valid and exists
		if (userFile === null) {
			res.sendStatus(400);
			return;
		}

		// Ensure file ownership
		if (userFile.ownerId != sessionInfo.userId) {
			console.error(`User (${sessionInfo.userId}) tried to download chunk of file owned by: ${userFile.ownerId}`);
			res.sendStatus(400);
			return;
		}

		// Create entry
		const filePath = path.join(env.USER_FILE_STORAGE_PATH, handle + CONSTANTS.ENCRYPTED_FILE_NAME_EXTENSION);
		
		// Check if the file path for the handle exists. If not, it's probably a folder.
		if (!fs.existsSync(filePath)) {
			console.error(`User (${sessionInfo.userId}) tried to download a file that doesn't have a physical file associated with the handle. Maybe it's a folder?`);
			res.sendStatus(400);
			return;
		}
		
		// Open file and get chunk metadata. File remains open while download request exists.
		let fileHandle: fs.promises.FileHandle | undefined;
		
		try {
			fileHandle = await fs.promises.open(filePath, "r");
		} catch (error) {
			if (env.DEVELOPMENT_MODE)
				console.error(error);

			res.sendStatus(500);
			return;
		}
		
		// Get file stats
		let fileStats: fs.Stats;

		try {
			fileStats = await fileHandle.stat();
		} catch (error) {
			if (env.DEVELOPMENT_MODE)
				console.error(error);

			res.sendStatus(500);
			return;
		}

		// Read header
		const headerBuffer = Buffer.alloc(8);

		try {
			await fileHandle.read(headerBuffer, 0, 8, 0);
		} catch (error) {
			if (env.DEVELOPMENT_MODE)
				console.error(error);

			res.sendStatus(500);
			return;
		}

		// Verify magic
		let magicCorrect = true;

		for (let i = 0; i < CONSTANTS.ENCRYPTED_FILE_MAGIC_NUMBER.length; i++) {
			if (headerBuffer[i] != CONSTANTS.ENCRYPTED_FILE_MAGIC_NUMBER[i]) {
				magicCorrect = false;
				break;
			}
		}

		if (!magicCorrect) {
			console.error(`User (${sessionInfo.userId}) requested to download file at ${filePath} which has incorrect magic number!`);
			res.sendStatus(400);
			return;
		}

		// Create entry
		downloadRequestMap.set(handle, {
			handle: handle,
			ownerUserId: userFile.ownerId,
			mutex: new Mutex(),
			expireTimeout: undefined,
			fileHandle: fileHandle,
			encryptedFileSize: fileStats.size
		});

		downloadRequest = downloadRequestMap.get(handle)!;
	}

	// Ensure user owns the download request
	if (downloadRequest.ownerUserId != sessionInfo.userId) {
		console.error(`User (${sessionInfo.userId}) tried to download data from download request started by user (${downloadRequest.ownerUserId})`);
		res.sendStatus(400);
		return;
	}

	// Calculate byte range to read and send to client
	const readOffset = chunkId * CONSTANTS.CHUNK_FULL_SIZE + CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE;

	if (readOffset > downloadRequest.encryptedFileSize) { // Cannot start reading after file
		console.error(`User (${sessionInfo.userId}): Range not satisfiable. Chunk id: ${chunkId} Read offset: ${readOffset} Enc. file size: ${downloadRequest.encryptedFileSize}`);
		res.sendStatus(416); // 416 Range Not Satisfiable
		return;
	}

	// Read chunk data from file
	const readSize = Math.min(CONSTANTS.CHUNK_FULL_SIZE, downloadRequest.encryptedFileSize - readOffset);
	const fullChunkBuffer = Buffer.alloc(readSize);

	try {
		await downloadRequest.fileHandle.read(fullChunkBuffer, 0, readSize, readOffset);
	} catch (error) {
		console.error(`User (${sessionInfo.userId}): Failed to read file! Read size: ${readSize} Read offset: ${readOffset} Enc. file size: ${downloadRequest.encryptedFileSize}`);
		res.sendStatus(500);
		return;
	}

	// Verify chunk magic
	if (!verifyFileChunkMagic(fullChunkBuffer)) {
		console.error(`User (${sessionInfo.userId}): Incorrect chunk header magic number! handle: ${downloadRequest.handle}`);
		res.sendStatus(400);
		return;
	}

	// Send chunk (TODO: chunk caching doesnt work i think)
	const chunkExpiryTimestamp = new Date(Date.now() + 3600 * 1000).toUTCString(); // 1 hour till expiry

	res.setHeader("Content-Type", "application/octet-stream");
	res.setHeader("Cache-Control", "public, max-age=3600"); // 1 hour till expiry
	res.setHeader("Expires", chunkExpiryTimestamp);
	res.send(fullChunkBuffer);

	// Clear any existing expiry timeouts
	if (downloadRequest.expireTimeout)
		clearTimeout(downloadRequest.expireTimeout);

	// When a chunk has finished transferring, a timeout will start that will eventually close the file and delete the download request
	// due to inactivity. The download is kept alive by continually downloading chunks which will keep resetting the timeout function.
	res.on("finish", () => {
		downloadRequest.expireTimeout = setTimeout(async () => {
			// Close the file handle
			try {
				await downloadRequest.fileHandle.close();
			} catch (error) {
				console.error(error);
			}

			// Delete the download request
			downloadRequestMap.delete(handle);
		}, CONSTANTS.DOWNLOAD_ENTRY_EXPIRE_TIME_MS);
	});
};

export {
	downloadChunkApi
}
