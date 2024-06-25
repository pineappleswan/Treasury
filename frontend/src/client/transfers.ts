import { randomBytes } from "@noble/ciphers/crypto";
import { FileSystemWritableFileStream } from "native-file-system-adapter";
import { FileMetadata, encryptFileMetadata, encryptFileChunk, FileSignatureBuilder, decryptFileChunk, encryptBuffer } from "./clientCrypto";
import { getEncryptedFileSize, getFileChunkCount, getFormattedBPSText, getFormattedByteSizeText, getUTCTimeInSeconds } from "../utility/commonUtils";
import { TransferListProgressInfoCallback } from "../components/transferList";
import { FilesystemEntry } from "./userFilesystem";
import { MediaProcessor, MediaProcessorProgressCallback, OptimiseVideoOutputData } from "./mediaProcessor";
import { getFileCategoryFromExtension } from "./fileTypes";
import { getFileExtensionFromName } from "../utility/fileNames";
import { UserLocalCryptoInfo, getLocalStorageUserCryptoInfo } from "./localStorage";
import { Zip, ZipPassThrough, zlibSync } from "fflate";
import { DataSizeUnitSetting } from "./userSettings";
import { TransferSpeedCalculator } from "./transferSpeedCalculator";
import cryptoRandomString from "crypto-random-string";
import base64js from "base64-js";
import CONSTANTS from "./constants";

/**
 * An enum denoting the two possible types of transfers users are able to make.
 */
enum TransferType {
  Uploads,
  Downloads
}

/**
 * An enum for the possible statuses of a transfer.
 */
enum TransferStatus {
  Waiting,
  Transferring,
  Finished,
  Failed
}

/**
 * A type containing the settings for file uploads.
 */
type UploadSettings = {
  optimiseVideosForStreaming: boolean;
};

type UploadFileRequest = {
  fileName: string;
  fileSize: number;
  file: File | Uint8Array;
  parentHandle: string;
  progressCallbackHandle: string; // Only used to identify the upload request for progress callbacks
}

type UploadFileResolveInfo = {
  handle: string;
  parentHandle: string;
  fileCryptKey: Uint8Array;
  encryptedFileSize: number;
  signature: Uint8Array;
};

// Utility function that helps to create a new filesystem entry as soon as a file has been uploaded to the server.
function createNewFilesystemEntryFromUploadRequestAndUploadResolveInfo(
  uploadRequest: UploadFileRequest,
  resolveInfo: UploadFileResolveInfo
): FilesystemEntry {
  const fileName = uploadRequest.fileName;
  const fileExtension = getFileExtensionFromName(fileName);
  const fileCategory = getFileCategoryFromExtension(fileExtension);
  
  const newFilesystemEntry: FilesystemEntry = {
    parentHandle: uploadRequest.parentHandle,
    handle: resolveInfo.handle,
    name: uploadRequest.fileName,
    size: uploadRequest.fileSize,
    encryptedFileSize: resolveInfo.encryptedFileSize,
    category: fileCategory,
    dateAdded: getUTCTimeInSeconds(),
    fileCryptKey: resolveInfo.fileCryptKey,
    isFolder: false,
    signature: resolveInfo.signature
  };

  return newFilesystemEntry;
}

function uploadSingleFileToServer(
  uploadRequest: UploadFileRequest,
  userLocalCryptoInfo: UserLocalCryptoInfo,
  progressCallback?: TransferListProgressInfoCallback
) {
  return new Promise<UploadFileResolveInfo>(async (resolve, reject: (reason: string) => void) => {
    const { file, parentHandle, progressCallbackHandle } = uploadRequest;
    const isFile = (file instanceof File);
    const rawFileSize = (isFile ? file.size : file.byteLength);
    let transferredBytes = 0; // For keeping track of upload progress

    // Calculate encrypted file size and chunk count
    const encryptedFileSize = getEncryptedFileSize(rawFileSize);
    const chunkCount = getFileChunkCount(rawFileSize);
    
    // Generate random file crypt key
    const fileCryptKey = randomBytes(CONSTANTS.XCHACHA20_KEY_LENGTH);
    
    // Request server to start upload
    let response = await fetch("/api/uploads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fileSize: rawFileSize
      })
    });
    
    if (!response.ok) {
      reject("Failed to start upload!");
      return;
    }
    
    // Get the file handle for upload
    const json = await response.json();
    const handle = json.handle;

    // File reading function used in the transfer promise
    let currentReadChunkId = 0;
    
    const getNextRawChunkData = (): Promise<Uint8Array> => {
      return new Promise(async (resolve, reject: (reason: any) => void) => {
        if (isFile) {
          try {
            // Read next file slice
            const blob = file.slice(currentReadChunkId * CONSTANTS.CHUNK_DATA_SIZE, (currentReadChunkId + 1) * CONSTANTS.CHUNK_DATA_SIZE);
            currentReadChunkId++;

            // Read as array buffer and convert to Uint8Array
            const buffer = await blob.arrayBuffer();
            const bufferAsArray = new Uint8Array(buffer);

            resolve(bufferAsArray);
          } catch (error) {
            reject(error);
          }
        } else {
          const start = currentReadChunkId * CONSTANTS.CHUNK_DATA_SIZE;
          const end = Math.min(file.byteLength, (currentReadChunkId + 1) * CONSTANTS.CHUNK_DATA_SIZE);
          currentReadChunkId++;

          if (start >= file.byteLength) {
            resolve(new Uint8Array()); // Cannot read past the end
          } else {
            resolve(file.slice(start, end));
          }
        }
      });
    };

    // Create file signature builder
    const signatureBuilder = new FileSignatureBuilder();
    
    // Uploading loop and logic
    const transferSpeedCalculator = new TransferSpeedCalculator();
    let uploadChunkId = 0;
    let finishedChunks = 0;
    let concurrentCount = 0;
    let concurrentLimit = 1;
    let uploadFailReason = "";

    const nextChunkUploadPromise = () => {
      return new Promise<void>(async (_resolve, _reject) => {
        if (concurrentCount >= concurrentLimit) {
          _resolve();
          return;
        }
        
        const chunkId = uploadChunkId++;
        concurrentCount++;

        // If all chunk uploads have been started, just wait till they are all finished.
        if (uploadChunkId > chunkCount) {
          _resolve();
          return;
        }

        // Read next chunk data from file
        const nextChunk = await getNextRawChunkData();

        // Start next chunk immediately (to maximise transfer speed)
        nextChunkUploadPromise();
        
        // Build signature
        await signatureBuilder.appendFileChunk(nextChunk, chunkId);
        
        // Encrypt and format chunk (adds magic number, nonce, etc.)
        const encryptedChunkBuffer = encryptFileChunk(chunkId, nextChunk, fileCryptKey);

        // Try upload encrypted chunk
        let lastProgressBytes = 0;

        // Start request
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/uploads/chunks", true);

        xhr.upload.onprogress = async (event) => {
          if (!event.lengthComputable)
            return;

          // Update progress
          const deltaBytes = event.loaded - lastProgressBytes;
          lastProgressBytes = event.loaded;
          transferredBytes += deltaBytes;

          transferSpeedCalculator.appendDeltaBytes(deltaBytes);

          if (progressCallback) {
            const progress = Math.min(transferredBytes / encryptedFileSize, 1);
            progressCallback(progressCallbackHandle, TransferType.Uploads, TransferStatus.Transferring, parentHandle, progress, undefined, undefined, "Uploading...");
          }
        };

        xhr.onload = () => {
          concurrentCount--;
          finishedChunks++;

          // Update progress
          const deltaBytes = encryptedChunkBuffer.byteLength - lastProgressBytes;
          transferredBytes += deltaBytes;

          transferSpeedCalculator.appendDeltaBytes(deltaBytes);

          if (progressCallback) {
            const progress = Math.min(transferredBytes / encryptedFileSize, 1);
            progressCallback(progressCallbackHandle, TransferType.Uploads, TransferStatus.Transferring, parentHandle, progress, undefined, undefined, "Uploading...");
          }

          if (xhr.status == 200) {
            _resolve();

            // Start next chunk
            nextChunkUploadPromise();
          } else {
            console.error(`Aborted upload chunk for server returned status: ${xhr.status}`);
            concurrentCount = Number.MAX_SAFE_INTEGER; // Hacky way to ENSURE further chunk uploads are aborted

            if (xhr.status == 429) {
              uploadFailReason = "Reached max concurrent chunks limit.";
            } else {
              uploadFailReason = `Received status code: ${xhr.status}`
            }

            xhr.abort();
            _reject("xhr not success!");
          }
        };

        // Send
        const formData = new FormData();
        formData.append("handle", handle);
        formData.append("chunkId", chunkId.toString());
        formData.append("data", new Blob([ encryptedChunkBuffer ]));

        xhr.send(formData);
      });
    };

    // TODO: FOR DEBUGGING ONLY
    let maxConcurrentCount = 0;

    // Start uploading
    nextChunkUploadPromise();

    // Calculate concurrent limit and also wait till uploads are complete
    await new Promise<void>(resolve => {
      const uploadInterval = setInterval(() => {
        // Fail scenario
        if (uploadFailReason.length != 0) {
          clearInterval(uploadInterval);
          resolve();
          return;
        }

        // Stop loop once all chunks have been finished
        if (finishedChunks >= chunkCount) {
          clearInterval(uploadInterval);
          resolve();
          return;
        }

        // If all chunk uploads have been started, just wait till they are all finished.
        if (uploadChunkId >= chunkCount) {
          return;
        }

        // Determine concurrent chunk upload limit
        concurrentLimit = Math.floor(transferSpeedCalculator.getSpeedGetter() / CONSTANTS.CONCURRENT_CHUNK_TRANSFER_SPEED_INCREMENT);
        concurrentLimit = Math.min(concurrentLimit, CONSTANTS.MAX_UPLOAD_CONCURRENT_CHUNKS);
        concurrentLimit = Math.max(concurrentLimit, 1);

        // TODO: DEBUGGING PURPOSES ONLY
        maxConcurrentCount = Math.max(maxConcurrentCount, concurrentLimit);
      }, 250);
    });

    // Reject if failed
    if (uploadFailReason.length != 0) {
      reject(uploadFailReason);
    }

    console.log(`Max concurrent upload chunk count for file size ${rawFileSize} with handle ${handle} is ${Math.max(maxConcurrentCount, 1)}`);

    // Finalise upload
    const utcTimeAsSeconds = getUTCTimeInSeconds();

    // Create file metadata and encrypt it
    const fileMetadata: FileMetadata = {
      fileName: uploadRequest.fileName,
      dateAdded: utcTimeAsSeconds,
      isFolder: false
    };

    const encFileMetadata = encryptFileMetadata(fileMetadata, userLocalCryptoInfo.masterKey);

    // Encrypt the file crypt key using the user's master key
    const encFileCryptKey = encryptBuffer(fileCryptKey, userLocalCryptoInfo.masterKey);

    // Get file signature
    const fileSignature = signatureBuilder.getSignature(userLocalCryptoInfo.ed25519PrivateKey, handle);
    
    // Finalise upload with the encrypted metadata and file crypt key
    response = await fetch(`/api/uploads/${handle}/finalise`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        handle: handle,
        parentHandle: parentHandle,
        encryptedMetadata: base64js.fromByteArray(encFileMetadata),
        encryptedFileCryptKey: base64js.fromByteArray(encFileCryptKey),
        signature: base64js.fromByteArray(fileSignature)
      })
    });

    if (!response.ok) {
      reject("Failed to finalise upload!");
      return;
    }

    // Resolve with some data about the file that was uploaded
    const resolveInfo: UploadFileResolveInfo = {
      handle: handle,
      parentHandle: parentHandle,
      fileCryptKey: fileCryptKey,
      encryptedFileSize: encryptedFileSize,
      signature: fileSignature
    };

    resolve(resolveInfo);
  });
};

/**
 * @param {number} progress - A number between 0 and 1.
 * @param {number} deltaBytes - The new number of bytes transferred since the last call to this callback.
 */
type DownloadChunkProgressCallback = (progress: number, deltaBytes: number) => void;

enum DownloadFileMethod {
  /** Transfer will appear in transfer list and it will write data to a filesystem handle */
  WritableStream,

  /** Transfer won't appear in transfer list and it will return data as a large Uint8Array instead */
  Silent
}

type DownloadFileContext = {
  method: DownloadFileMethod;
  writableStream?: FileSystemWritableFileStream;
}

type DownloadFileResolveInfo = {
  data?: Uint8Array;
  fileEntry: FilesystemEntry; // The filesystem entry downloaded
  wasCancelled: boolean;
}

type DownloadFilesAsZipResolveInfo = {
  data?: Uint8Array;
  fileEntries: FilesystemEntry[]; // The filesystem entries downloaded
  wasCancelled: boolean;
}

type DownloadChunkResolveInfo = {
  data?: Uint8Array;
  wasCancelled: boolean;
}

// TODO: singleton?
class ClientDownloadManager {
  private userLocalCryptoInfo: UserLocalCryptoInfo;

  constructor() {
    const userLocalCryptoInfo = getLocalStorageUserCryptoInfo();

    if (userLocalCryptoInfo == null) {
      throw new Error("userLocalCryptoInfo is null!");
    }

    this.userLocalCryptoInfo = userLocalCryptoInfo;
  }

  downloadFilesAsZip(
    fileEntries: FilesystemEntry[],
    context: DownloadFileContext,
    shouldCancelCallback?: () => boolean,
    progressCallback?: TransferListProgressInfoCallback
  ): Promise<DownloadFilesAsZipResolveInfo> {
    // TODO: download whole file chunk callback option so we can stream chunks as they are downloaded to the zip. file signature is still verified at end, and if fails, zip fails

    return new Promise(async (resolve, reject) => {
      // Sanity checks
      if (context.method == DownloadFileMethod.WritableStream && context.writableStream == undefined)
        throw new Error(`A writableStream must be provided when using the writable stream download method!`);
      
      if (context.method == DownloadFileMethod.Silent && context.writableStream)
        console.warn(`A writableStream was provided using silent download method which is unnecessary!`);

      // Calculate total download size
      let totalDownloadSize = 0;
      fileEntries.forEach(entry => totalDownloadSize += entry.size);

      if (totalDownloadSize > CONSTANTS.MAX_SIGNED_32_BIT_INTEGER) {
        console.warn(`Downloading more than ~2.147 GB worth of files as a zip. Total size: ${totalDownloadSize}`);
      }

      // Start downloads
      const downloadPromises: Promise<DownloadFileResolveInfo>[] = [];

      fileEntries.forEach(entry => {
        const fileDownloadContext: DownloadFileContext = {
          method: DownloadFileMethod.Silent
        };

        // Generate random progress callback handle if a callback is given
        let progressCallbackHandle = undefined;
        
        if (progressCallback !== undefined)
          progressCallbackHandle = cryptoRandomString({ length: CONSTANTS.PROGRESS_CALLBACK_HANDLE_LENGTH, type: "alphanumeric" });

        const promise = this.downloadWholeFile(entry, fileDownloadContext, shouldCancelCallback, progressCallbackHandle, entry.name, progressCallback);
        downloadPromises.push(promise);
      });

      const finalDownloads = await Promise.all(downloadPromises);

      // Create zip
      const zip = new Zip(async (error, data, final) => {
        if (!error) {
          if (context.method == DownloadFileMethod.WritableStream)
            await context.writableStream!.write(data);

          if (final) {
            await context.writableStream!.close();

            resolve({
              data: data,
              fileEntries: fileEntries,
              wasCancelled: false
            });
          }
        } else {
          console.error(error);
          reject(error);
        }
      });

      finalDownloads.forEach(info => {
        if (!info.data) {
          reject("Some downloads failed or were cancelled.");
          return;
        }

        const file = new ZipPassThrough(info.fileEntry.name);
        zip.add(file);
        file.push(info.data, true);
      });

      zip.end();
    });
  }

  // TODO: concurrent download chunks

  // Interactive means that it will prompt the user to select the download file's destination
  downloadWholeFile(
    fileEntry: FilesystemEntry,
    context: DownloadFileContext,
    shouldCancelCallback?: () => boolean, // Return true if the cancel should stop
    progressCallbackHandle?: string,
    outputFileName?: string, // Only needed for progress callback
    progressCallback?: TransferListProgressInfoCallback
  ): Promise<DownloadFileResolveInfo> { // Silent download method will resolve with a Uint8Array
    // Sanity checks
    if (progressCallback && !progressCallbackHandle)
      throw new Error(`progressCallback exists but not progressCallbackHandle!`);
    
    if (!progressCallback && progressCallbackHandle)
      throw new Error(`progressCallbackHandle exists but not progressCallback!`);

    if (context.method == DownloadFileMethod.WritableStream && context.writableStream == undefined)
      throw new Error(`A writableStream must be provided when using the writable stream download method!`);
    
    if (context.method == DownloadFileMethod.Silent && context.writableStream)
      console.warn(`A writableStream was provided using silent download method which is unnecessary!`);

    const startTime = Date.now();

    // Add to transfer list immediately
    if (progressCallback)
      progressCallback(progressCallbackHandle!, TransferType.Downloads, TransferStatus.Transferring, undefined, 0, outputFileName, fileEntry.size, "Downloading...");

    // Calculate chunk count
    const chunkCount = getFileChunkCount(fileEntry.size);

    // Silent downloads return
    let fileContentsData: Uint8Array | undefined;

    if (context.method == DownloadFileMethod.Silent) {
      fileContentsData = new Uint8Array(fileEntry.size);
    }

    // Used to prevent duplicate calls to the transfer list progress callback
    let previousProgressValue = 0;

    return new Promise<DownloadFileResolveInfo>(async (resolve, reject) => {
      // Since this function downloads a whole file, the signature must be verified
      const signatureBuilder: FileSignatureBuilder = new FileSignatureBuilder();
      let transferredBytes = 0;

      const chunkDownloadProgressCallback: DownloadChunkProgressCallback = (progress: number, deltaBytes: number) => {
        transferredBytes += deltaBytes;

        if (transferredBytes > fileEntry.size) {
          transferredBytes = fileEntry.size;
        }

        // Calculate total progress
        if (progressCallback) {
          const totalProgress = Math.min(transferredBytes / fileEntry.size, 1);

          if (totalProgress != previousProgressValue) {
            previousProgressValue = totalProgress;
            progressCallback(progressCallbackHandle!, TransferType.Downloads, TransferStatus.Transferring, undefined, totalProgress, outputFileName, fileEntry.size, "Downloading...");
          }
        }
      }

      for (let i = 0; i < chunkCount; i++) {
        // Check if the download should be cancelled
        if (shouldCancelCallback) {
          const shouldCancel = shouldCancelCallback();

          if (shouldCancel) {
            if (progressCallback)
              progressCallback(progressCallbackHandle!, TransferType.Downloads, TransferStatus.Failed, undefined, undefined, undefined, undefined, "Cancelled");

            reject("Download cancelled");
            return;
          }
        }

        let chunkData: DownloadChunkResolveInfo;
        
        try {
          chunkData = await this.downloadChunk(fileEntry.handle, i, fileEntry.fileCryptKey, shouldCancelCallback, chunkDownloadProgressCallback);

          // Check if it was cancelled
          if (chunkData.wasCancelled) {
            resolve({
              data: undefined,
              fileEntry: fileEntry,
              wasCancelled: true
            });

            return;
          }

          const chunkBinary = chunkData.data!;
          await signatureBuilder.appendFileChunk(chunkBinary, i);

          if (context.method == DownloadFileMethod.WritableStream) {
            await context.writableStream!.write(chunkBinary);
          } else {
            const writeOffset = i * CONSTANTS.CHUNK_DATA_SIZE;
            fileContentsData!.set(chunkBinary, writeOffset);
          }
        } catch (error) {
          // Failed progress callback
          if (progressCallback)
            progressCallback(progressCallbackHandle!, TransferType.Downloads, TransferStatus.Failed, undefined, undefined, undefined, undefined, "");
        
          if (context.method == DownloadFileMethod.WritableStream)
            await context.writableStream!.abort();

          reject(error);
          return;
        }
      }

      // Ensure the signature's byte length is correct
      if (fileEntry.signature.byteLength != CONSTANTS.ED25519_SIGNATURE_BYTE_LENGTH) {
        reject("Signature length is incorrect!");
        return;
      }

      // Verify download signature
      const verified = signatureBuilder.verifyDownload(
        this.userLocalCryptoInfo.ed25519PublicKey,
        fileEntry.signature,
        fileEntry.handle
      );
      
      if (!verified) {
        reject("Signature mismatch!");
        return;
      }

      // Finish progress callback
      if (progressCallback)
        progressCallback(progressCallbackHandle!, TransferType.Downloads, TransferStatus.Finished, undefined, 1, undefined, undefined, "");
      
      if (context.method == DownloadFileMethod.WritableStream)
        await context.writableStream!.close();
      
      // TODO: this is temporary for debugging only
      const msElapsed = Date.now() - startTime;
      console.log(`downloaded whole file (${getFormattedByteSizeText(fileEntry.size, DataSizeUnitSetting.Base10)}) in: ${msElapsed}ms. speed=${getFormattedBPSText(fileEntry.size / (msElapsed / 1000), DataSizeUnitSetting.Base10, 3)}`)

      resolve({ data: fileContentsData, fileEntry: fileEntry, wasCancelled: false });
    });
  };

  downloadChunk(
    handle: string,
    chunkId: number,
    fileCryptKey: Uint8Array,
    shouldCancelCallback?: () => boolean,
    progressCallback?: DownloadChunkProgressCallback
  ): Promise<DownloadChunkResolveInfo> {
    return new Promise<DownloadChunkResolveInfo>(async (resolve, reject: (reason: any) => void) => {
      // Download chunk
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `/api/downloads/${handle}/chunks/${chunkId}`, true);
      xhr.responseType = "arraybuffer";

      let transferredBytes = 0;
      let lastProgressBytes = 0;
      const clientChunkSize = CONSTANTS.CHUNK_FULL_SIZE - 8; // The size of chunks received from the server should be the full chunk minus the header data

      xhr.onload = () => {
        if (xhr.status == 200) {
          const rawFullChunkArrayBuffer = xhr.response as ArrayBuffer;
          const fullChunkBuffer = new Uint8Array(rawFullChunkArrayBuffer);

          // Update progress
          if (progressCallback) {
            const deltaBytes = fullChunkBuffer.byteLength - lastProgressBytes;
            transferredBytes += deltaBytes;

            const progress = Math.min(transferredBytes / clientChunkSize, 1);
            progressCallback(progress, deltaBytes);
          }

          // Decrypt
          try {
            const decryptedChunk = decryptFileChunk(fullChunkBuffer, fileCryptKey);
            
            if (decryptedChunk.chunkId != chunkId) {
              throw new Error(`Chunk id mismatch!`);
            }

            // Resolve
            resolve({
              data: decryptedChunk.buffer,
              wasCancelled: false
            });
          } catch (error) {
            reject(error);
            return;
          }
        } else {
          // TODO: clear dead download on the server, preferably at the location where the fail status code is returned.
          // if its a TRUE server error, then clear download loop should catch it (this todo message also applies to every place
          // in this code that has an abort and reject)

          xhr.abort();
          reject(`Bad response code: ${xhr.status}`);
        }
      }

      // Do progress callback
      xhr.onprogress = (event) => {
        if (!event.lengthComputable || !progressCallback)
          return;

        if (shouldCancelCallback) {
          if (shouldCancelCallback() == true) {
            xhr.abort();
            resolve({
              data: undefined,
              wasCancelled: true
            });

            return;
          }
        }

        const deltaBytes = event.loaded - lastProgressBytes;
        lastProgressBytes = event.loaded;
        transferredBytes += deltaBytes;

        const progress = Math.min(transferredBytes / clientChunkSize, 1);
        progressCallback(progress, deltaBytes);
      }

      // Start request
      xhr.send();
    });
  };
}

type UploadFinishCallback = (progressCallbackHandle: string, newFilesystemEntries: FilesystemEntry[]) => void;
type UploadFailCallback = (progressCallbackHandle: string) => void;

class ClientUploadManager {
  private userLocalCryptoInfo: UserLocalCryptoInfo;
  private transferListInfoCallback?: TransferListProgressInfoCallback;
  private uploadFinishCallback: UploadFinishCallback;
  private uploadFailCallback: UploadFailCallback;
  private uploadSettings: UploadSettings;
  private mediaProcessor: MediaProcessor;
  private uploadFileRequests: UploadFileRequest[] = [];
  private activeUploadCount = 0;

  constructor(
    uploadFinishCallback: UploadFinishCallback,
    uploadFailCallback: UploadFailCallback,
    uploadSettings: UploadSettings
  ) {
    const userLocalCryptoInfo = getLocalStorageUserCryptoInfo();

    if (userLocalCryptoInfo == null) {
      throw new Error("Failed to get user local crypto info!");
    }

    this.userLocalCryptoInfo = userLocalCryptoInfo;

    this.uploadFinishCallback = uploadFinishCallback;
    this.uploadFailCallback = uploadFailCallback;
    this.uploadSettings = uploadSettings;
    this.mediaProcessor = new MediaProcessor();

    // Try run the next upload every second just in case the loop stalls.
    setInterval(() => {
      this.runNextUpload();
    }, 1000);
  }

  // TODO: upload finish callback and upload fail callback is really annoying to deal with when needing to upload single files automatically like with thumbnails... use promises.
  //       and make adding to the upload queue only for user transfers. EDIT: thumbnails now stored in indexeddb but still, still needs
  //       to be better

  private async runNextUpload() {
    if (this.uploadFileRequests.length == 0 || this.activeUploadCount >= CONSTANTS.TARGET_CONCURRENT_UPLOADS_COUNT)
      return;

    const uploadRequest = this.uploadFileRequests.pop();

    if (!uploadRequest)
      return;

    try {
      this.activeUploadCount++;
      
      // Immediately run next upload to maximise concurrency
      this.runNextUpload();

      // Get upload request metadata
      const fileName = uploadRequest.fileName;
      const fileExtension = getFileExtensionFromName(fileName);

      // Determine if file is a video AND the user wants to optimise them for streaming
      if (this.uploadSettings.optimiseVideosForStreaming) {
        // TODO: get user settings

        if (fileExtension == "mp4") {
          const mediaProcessorProgressCallback: MediaProcessorProgressCallback = (progress) => {
            console.log(`ffmpeg progress: ${progress}`);
          };
          
          // Get binary data
          let inputDataArray;
          
          if (uploadRequest.file instanceof File) {
            const inputData = await uploadRequest.file.arrayBuffer();
            inputDataArray = new Uint8Array(inputData);
          } else {
            inputDataArray = uploadRequest.file;
          }

          // Update progress
          this.transferListInfoCallback?.(
            uploadRequest.progressCallbackHandle,
            TransferType.Uploads,
            TransferStatus.Waiting,
            uploadRequest.parentHandle,
            0,
            undefined,
            undefined,
            "Optimising..."
          );

          // Begin optimising video for streaming
          let outputData: OptimiseVideoOutputData;

          try {
            outputData = await this.mediaProcessor.optimiseVideoForStreaming(inputDataArray!, mediaProcessorProgressCallback);
          } catch (error) {
            console.error(`Failed to optimise video for streaming: ${error}`);
            this.uploadFailCallback(uploadRequest.progressCallbackHandle);
            return;
          }

          const videoBinaryData = outputData.videoBinaryData;
          const m3u8 = outputData.m3u8Data;

          // Upload video as new upload file entry
          const videoUploadEntry: UploadFileRequest = {
            fileName: uploadRequest.fileName,
            fileSize: videoBinaryData.byteLength,
            file: videoBinaryData,
            parentHandle: uploadRequest.parentHandle,
            progressCallbackHandle: uploadRequest.progressCallbackHandle
          };

          const videoResolveInfo = await uploadSingleFileToServer(videoUploadEntry, this.userLocalCryptoInfo, this.transferListInfoCallback);
          const videoFileHandle = videoResolveInfo.handle;
          
          // Set progress to waiting for the m3u8 to upload
          this.transferListInfoCallback?.(
            uploadRequest.progressCallbackHandle,
            TransferType.Uploads,
            TransferStatus.Waiting,
            uploadRequest.parentHandle,
            1,
            undefined,
            undefined,
            "Uploading m3u8..."
          );
          
          // Compress m3u8 for upload
          const m3u8compressed = zlibSync(m3u8, {
            level: 9
          });

          // Upload compressed m3u8
          const m3u8UploadEntry: UploadFileRequest = {
            fileName: "m3u8",
            fileSize: m3u8compressed.byteLength,
            file: m3u8compressed,
            parentHandle: videoFileHandle, // Parent handle is the video file
            progressCallbackHandle: "" // Empty because the m3u8 upload
          };

          const m3u8ResolveInfo = await uploadSingleFileToServer(m3u8UploadEntry, this.userLocalCryptoInfo);

          // Set progress to finish
          this.transferListInfoCallback?.(
            uploadRequest.progressCallbackHandle,
            TransferType.Uploads,
            TransferStatus.Finished,
            uploadRequest.parentHandle,
            1,
            undefined,
            undefined,
            ""
          );

          // Add new uploaded file as a filesystem entry (ignores the m3u8 because it's not visible anyways)
          const videoBinaryFsEntry = createNewFilesystemEntryFromUploadRequestAndUploadResolveInfo(videoUploadEntry, videoResolveInfo);
          const m3u8FsEntry = createNewFilesystemEntryFromUploadRequestAndUploadResolveInfo(m3u8UploadEntry, m3u8ResolveInfo);
          this.uploadFinishCallback(videoUploadEntry.progressCallbackHandle, [ videoBinaryFsEntry, m3u8FsEntry ]);

          // Return here because it's already uploaded as an optimised video
          return;
        }
      }

      // Upload file as a normal file
      const resolveInfo = await uploadSingleFileToServer(uploadRequest, this.userLocalCryptoInfo, this.transferListInfoCallback);
      
      // Set progress to finish
      this.transferListInfoCallback?.(
        uploadRequest.progressCallbackHandle,
        TransferType.Uploads,
        TransferStatus.Finished,
        uploadRequest.parentHandle,
        1,
        undefined,
        undefined,
        ""
      );

      // Add new uploaded file as a filesystem entry
      const newFilesystemEntry = createNewFilesystemEntryFromUploadRequestAndUploadResolveInfo(uploadRequest, resolveInfo);
      this.uploadFinishCallback(uploadRequest.progressCallbackHandle, [ newFilesystemEntry ]);
    } catch (error) {
      console.error(`Failed to upload single file to server! Error: ${error}`);

      // TODO: if video m3u8 upload failed but not binary data then delete the binary data on the server

      this.uploadFailCallback(uploadRequest.progressCallbackHandle);
    } finally {
      this.activeUploadCount--;
    }

    // Try run next upload
    this.runNextUpload();
  }

  setInfoListCallback(progressCallback: TransferListProgressInfoCallback) {
    this.transferListInfoCallback = progressCallback;
  }

  addToUploadQueue(entry: UploadFileRequest) {
    this.uploadFileRequests.push(entry);

    // Sort because transfer lists are sorted alphabetically
    this.uploadFileRequests.sort((a, b) => {
      return b.fileName.localeCompare(a.fileName);
    });

    // Add to transfer list
    this.transferListInfoCallback?.(
      entry.progressCallbackHandle,
      TransferType.Uploads,
      TransferStatus.Waiting,
      entry.parentHandle,
      0,
      entry.fileName,
      entry.fileSize,
      "Waiting..."
    );

    this.runNextUpload();
  }
}

export type {
  UploadSettings,
  UploadFileRequest,
  DownloadFileContext,
  UploadFileResolveInfo,
  UploadFinishCallback,
  UploadFailCallback,
  DownloadFileResolveInfo,
  DownloadFilesAsZipResolveInfo
}

export {
  TransferType,
  TransferStatus,
  DownloadFileMethod,
  ClientUploadManager,
  ClientDownloadManager
};
