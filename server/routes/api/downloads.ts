import { getLoggedInUsername, getUserSessionInfo } from "../../utility/authentication";
import { TreasuryDatabase } from "../../database/database";
import { Mutex } from "async-mutex";
import fs from "fs";
import path from "path";
import CONSTANTS from "../../../src/common/constants";
import Joi from "joi";
import env from "../../env";
import { convertFourBytesToSignedInt } from "../../../src/common/common";

type DownloadEntry = {
  handle: string,
  ownerUserId: number, // The user who started the download AND who owns the file too
  mutex: Mutex,
  lastUsedTime: number,
  fileHandle: fs.promises.FileHandle,
  encryptedFileSize: number,
  fullChunkSize: number
};

type DownloadEntryEntryDictionary = {
  [key: string]: DownloadEntry
};

// Download entries are never removed from the dictionary
const downloadEntries: DownloadEntryEntryDictionary = {};

// Type checking schemas
const startDownloadSchema = Joi.object({
	handle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
    .alphanum()
});

const endDownloadSchema = Joi.object({
  handle: Joi.string()
  .length(CONSTANTS.FILE_HANDLE_LENGTH)
  .alphanum()
});

const downloadChunkSchema = Joi.object({
  handle: Joi.string()
    .length(CONSTANTS.FILE_HANDLE_LENGTH)
    .alphanum(),
  
  chunkId: Joi.number()
    .min(0)
});

// API
const startDownloadApi = async (req: any, res: any) => {
  const sessionInfo = getUserSessionInfo(req);
  const loggedInUserId = sessionInfo.userId;
	const { handle } = req.body;

  // Check with schema
  try {
    await startDownloadSchema.validateAsync({
      handle: handle
    });
  } catch (error) {
    res.sendStatus(400);
    return;
  }

  const database = TreasuryDatabase.getInstance();
  const existingEntry = downloadEntries[handle];

  // If entry doesn't exist yet, then load the file and create the entry
  if (existingEntry == undefined) {
    // Check if file handle exists and belongs to the user
    const fileOwnerId = database.getFileHandleOwnerUserId(handle);

    if (fileOwnerId == undefined || fileOwnerId != loggedInUserId) {
      res.sendStatus(400);
      return;
    }

    // Get encrypted file crypt key
    const encryptedFileCryptKey = database.getEncryptedFileCryptKey(handle);

    if (encryptedFileCryptKey == undefined) {
      console.error(`Failed to get encrypted file crypt key! handle: ${handle}`)
      res.sendStatus(500);
      return;
    }
    
    // Sanity check
    if (encryptedFileCryptKey.byteLength != CONSTANTS.ENCRYPTED_CRYPT_KEY_SIZE) {
      console.error(`encrypted file crypt key size does not match value in constants! handle: ${handle}`);
      res.sendStatus(500);
      return;
    }

    // Create entry
    const nowTime = Date.now();

    // Open file and get chunk metadata. File remains open while download entry exists.
    const filePath = path.join(env.USER_FILE_STORAGE_PATH, handle + CONSTANTS.ENCRYPTED_FILE_NAME_EXTENSION);
    let fileHandle: fs.promises.FileHandle | undefined;
    
    try {
      fileHandle = await fs.promises.open(filePath, "r");
    } catch (error) {
      console.error(error);
      res.sendStatus(500);
      return;
    }
    
    // Get file stats
    let fileStats: fs.Stats;

    try {
      fileStats = await fileHandle.stat();
    } catch (error) {
      console.error(error);
      res.sendStatus(500);
      return;
    }

    // Read header
    const headerBuffer = Buffer.alloc(8);

    try {
      await fileHandle.read(headerBuffer, 0, 8, 0);
    } catch (error) {
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
      console.error(`User requested to download file at ${filePath} which has incorrect magic number!`);
      res.sendStatus(400);
      return;
    }
    
    // Get chunk metadata
    const chunkSize = convertFourBytesToSignedInt([
      headerBuffer[4],
      headerBuffer[5],
      headerBuffer[6],
      headerBuffer[7]
    ]);

    if (chunkSize < 0) {
      console.error(`User requested to download file at ${filePath} which has negative chunk size!`);
      res.sendStatus(400);
      return;
    }

    // Create entry
    downloadEntries[handle] = {
      handle: handle,
      ownerUserId: fileOwnerId,
      mutex: new Mutex(),
      lastUsedTime: nowTime,
      fileHandle: fileHandle,
      encryptedFileSize: fileStats.size,
      fullChunkSize: chunkSize
    };

    // Send encrypted file crypt key which is a success
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(encryptedFileCryptKey);
  } else {
    // Cannot start a download that is already started
    res.sendStatus(409); // 409 Conflict
  }
};

const endDownloadApi = async (req: any, res: any) => {
  const sessionInfo = getUserSessionInfo(req);
	const { handle } = req.body;

  // Check with schema
  try {
    await endDownloadSchema.validateAsync({
      handle: handle
    });
  } catch (error) {
    res.sendStatus(400);
    return;
  }

  const entry = downloadEntries[handle];

  // Doesn't matter if entry doesn't exist, just return success
  if (entry == undefined) {
    res.sendStatus(200);
    return;
  }

  // Check if user owns the download entry
  if (entry.ownerUserId != sessionInfo.userId) {
    res.sendStatus(400);
    return;
  }

  // Close file handle
  const fileHandle = entry.fileHandle;

  // Delete entry
  delete downloadEntries[handle];

  try {
    await fileHandle.close();
    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
};

const downloadChunkApi = async (req: any, res: any) => {
  const sessionInfo = getUserSessionInfo(req);
	const { handle, chunkId } = req.body;

  // Check with schema
  try {
    await downloadChunkSchema.validateAsync({
      handle: handle,
      chunkId: chunkId
    });
  } catch (error) {
    res.sendStatus(400);
    return;
  }

  const entry = downloadEntries[handle];

  if (entry == undefined) {
    res.sendStatus(400);
    return;
  }

  // Ensure user owns the download entry
  if (entry.ownerUserId != sessionInfo.userId) {
    res.sendStatus(400);
    return;
  }

  // Calculate byte range to read and send to client
  const startOffset = chunkId * entry.fullChunkSize + CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE;

  if (startOffset > entry.encryptedFileSize) {
    res.sendStatus(416); // 416 Range Not Satisfiable
    return;
  }

  // Read chunk data from file
  const fullBufferSize = Math.min(entry.fullChunkSize, entry.encryptedFileSize - startOffset);
  const headerBuffer = Buffer.alloc(8); // Chunk magic (4B) + chunk id (4B)
  const dataBuffer = Buffer.alloc(fullBufferSize - 8);

  try {
    await entry.fileHandle.read(headerBuffer, 0, 8, startOffset); // Read chunk header
    await entry.fileHandle.read(dataBuffer, 0, fullBufferSize - 8, startOffset + 8); // Read chunk data
  } catch (error) {
    res.sendStatus(500);
    return;
  }

  // Verify chunk magic
  let magicCorrect = true;

  for (let i = 0; i < CONSTANTS.ENCRYPTED_CHUNK_MAGIC_NUMBER.length; i++) {
    if (headerBuffer[i] != CONSTANTS.ENCRYPTED_CHUNK_MAGIC_NUMBER[i]) {
      magicCorrect = false;
      break;
    }
  }

  if (!magicCorrect) {
    console.error(`Incorrect chunk header magic number! handle: ${entry.handle}`);
    res.sendStatus(400);
    return;
  }

  // Verify chunk id
  const fileChunkId = convertFourBytesToSignedInt([
    headerBuffer[4],
    headerBuffer[5],
    headerBuffer[6],
    headerBuffer[7]
  ]);

  if (chunkId != fileChunkId) {
    console.error(`User requested chunk id of ${chunkId} but chunk id in file at calculated position is ${fileChunkId}! handle: ${entry.handle}`);
    res.sendStatus(500);
    return;
  }

  // Send data buffer
  res.setHeader("Content-Type", "application/octet-stream");
  res.send(dataBuffer);
};

// TODO: use mutex for downloads?

export {
  startDownloadApi,
  endDownloadApi,
  downloadChunkApi
}
