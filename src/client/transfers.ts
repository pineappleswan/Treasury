import { randomBytes } from "@noble/ciphers/crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { FileSystemWritableFileStream, showSaveFilePicker } from "native-file-system-adapter";
import { decryptEncryptedFileCryptKey, FileMetadata, encryptFileCryptKey, createEncryptedFileMetadata, encryptRawChunkBuffer, FileSignatureBuilder } from "./clientCrypto";
import { getEncryptedFileSizeAndChunkCount } from "../common/commonUtils";
import { PromiseQueue } from "../common/promiseQueue";
import { TransferListProgressInfoCallback } from "../components/transferList";
import { FilesystemEntry } from "./userFilesystem";
import { MediaProcessor, MediaProcessorProgressCallback } from "./mediaProcessor";
import { getFileExtensionFromName, getFileCategoryFromExtension } from "../utility/fileTypes";
import { zipSync } from "fflate";
import base64js from "base64-js";
import CONSTANTS from "../common/constants";

/*
---* OPTIMISED VIDEO STRATEGY *----

upload video:
	1. Split video into hls files and generate m3u8 for it too but make sure the .ts file output is one big binary (ONLY if video is larger than a certain threshold! e.g 8 MB)
	2. Upload m3u8 file as a pointer file ($.m3u8->HANDLE) OR store m3u8 under a video .ts file! (use parentHandle + it wont show in explorer)

download video:
	1. Download big .ts file and transmux back to mp4 (or maybe confirm with user with a warning, and fallback to downloading the .ts when it fails (let user know))

watch video:
	1. Fragment downloader must check if fragment overlaps two chunks, and if so, download them accordingly

*/

// TODO: HANDLE FOLDER UPLOADS!!!
// TODO: message string in resolve info?

enum TransferType {
	Uploads,
	Downloads
}

enum TransferStatus {
	Waiting,
	Transferring,
	Finished,
	Failed
}

type UploadFileEntry = {
	fileName: string,
	fileSize: number,
  file: File | Uint8Array,
	parentHandle: string,
	progressCallbackHandle: string // Only used to identify the upload entry for progress callbacks
}

type DownloadFileEntry = {
	handle: string,
	fileName: string,
	encryptedFileSize: number,
	realFileSize: number,
	fileCryptKey: Uint8Array
}

type FileUploadResolveInfo = {
	handle: string,
	parentHandle: string,
	fileCryptKey: Uint8Array,
	encryptedFileSize: number
};

type FileUploadRejectInfo = {
	handle?: string,
	reason: string
};

// Utility function that helps to create a new filesystem entry as soon as a file has been uploaded to the server.
function createNewFilesystemEntryFromUploadEntryAndUploadResolveInfo(
	uploadEntry: UploadFileEntry,
	resolveInfo: FileUploadResolveInfo,
	fileCryptKey: Uint8Array
): FilesystemEntry {
	const fileName = uploadEntry.fileName;
	const fileExtension = getFileExtensionFromName(fileName);
	const fileCategory = getFileCategoryFromExtension(fileExtension);
	
	const newFilesystemEntry: FilesystemEntry = {
		parentHandle: uploadEntry.parentHandle,
		handle: resolveInfo.handle,
		name: uploadEntry.fileName,
		size: uploadEntry.fileSize,
		encryptedFileSize: resolveInfo.encryptedFileSize,
		category: fileCategory,
		dateAdded: Math.floor(Date.now() / 1000),
		fileCryptKey: fileCryptKey,
		isFolder: false
	};

	return newFilesystemEntry;
}

function uploadSingleFileToServer(
	uploadEntry: UploadFileEntry,
	masterKey: Uint8Array,
	ed25519PrivateKey: Uint8Array,
	progressCallback?: TransferListProgressInfoCallback
) {
	return new Promise<FileUploadResolveInfo>(async (resolve, reject: (info: FileUploadRejectInfo) => void) => {
		const { file, parentHandle, progressCallbackHandle } = uploadEntry;
		const isFile = (file instanceof File);
		const rawFileSize = (isFile ? file.size : file.byteLength);
		const { encryptedFileSize, chunkCount } = getEncryptedFileSizeAndChunkCount(rawFileSize);
		let transferredBytes = 0; // For keeping track of upload progress
		
		// Generate a random file encryption key (256 bit)
		const fileCryptKey = randomBytes(32);
		
		// Request server to start upload
		let response = await fetch("/api/transfer/startupload", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				fileSize: encryptedFileSize,
				chunkCount: chunkCount
			})
		});
		
		if (!response.ok) {
			reject({ reason: "Failed to start upload!" });
			return;
		}
		
		// Get json data
		let json = await response.json();
		const handle = json.handle;

		// Create next chunk promise
		let currentReadChunkId = 0;
		
		const getNextRawChunkData = (): Promise<Uint8Array> => {
			return new Promise(async (resolve, reject: (reason: any) => void) => {
				if (isFile) {
					/*
					const fileReader = new FileReader(); // TODO: super inefficient to make new file reader inside every chunk? maybe not

					fileReader.onload = async (event) => {
						if (!event.target) {
							reject("Failed to read file chunk!");
							return;
						}
	
						if (event.target.error) {
							reject(event.target.error);
							return;
						}

						const rawChunkArrayBuffer = event.target.result as ArrayBuffer;
						const rawChunkUint8Array = new Uint8Array(rawChunkArrayBuffer);
						resolve(rawChunkUint8Array);
					};

					if (currentReadChunkId > chunkCount) {
						reject("Read more chunks than is possible!");
					}

					// Read next chunk
					const blob = file.slice(currentReadChunkId * CONSTANTS.CHUNK_DATA_SIZE, (currentReadChunkId + 1) * CONSTANTS.CHUNK_DATA_SIZE);
					currentReadChunkId++;

					const buffer = await blob.arrayBuffer();
					*/
					
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

		// console.log(`h: ${handle} - total chunk count: ${chunkCount}`);
		
		// Create file signature builder
		const fileSignatureBuilder = new FileSignatureBuilder();
		
		const nextChunkUploadPromise = (chunkId: number) => {
			return new Promise<void>(async (_resolve, _reject) => {
				const nextChunk = await getNextRawChunkData();

				// console.log(`h: ${handle} - uploading chunk: ${chunkId}`);
			
				// Add randomness to test uploading many chunks at random (TODO: only for testing)
				/*
				await new Promise((res) => {
					setTimeout(res, Math.random() * 1000);
				});
				*/

				// Build signature
				await fileSignatureBuilder.appendChunk(nextChunk, chunkId);
				
				// Encrypt chunk
				const encryptedChunkBuffer = encryptRawChunkBuffer(nextChunk, fileCryptKey);

				// Try upload encrypted chunk
				let lastProgressBytes = 0;

				// Start request
				const xhr = new XMLHttpRequest();
				xhr.open("POST", "/api/transfer/uploadchunk", true);

				xhr.upload.onprogress = async (event) => {
					if (!event.lengthComputable || !progressCallback)
						return;

					// Update progress
					const deltaBytes = event.loaded - lastProgressBytes;
					lastProgressBytes = event.loaded;
					transferredBytes += deltaBytes;

					const progress = Math.min(transferredBytes / encryptedFileSize, 1);
					progressCallback(progressCallbackHandle, TransferType.Uploads, TransferStatus.Transferring, parentHandle, progress, undefined, undefined, "Uploading...");
				};

				xhr.onload = () => {
					// Update progress
					if (progressCallback) {
						const deltaBytes = encryptedChunkBuffer.byteLength - lastProgressBytes;
						transferredBytes += deltaBytes;

						const progress = Math.min(transferredBytes / encryptedFileSize, 1);
						progressCallback(progressCallbackHandle, TransferType.Uploads, TransferStatus.Transferring, parentHandle, progress, undefined, undefined, "Uploading...");
					}

					if (xhr.status == 200) {
						_resolve();
					} else {
						xhr.abort();

						console.error(`Aborted upload chunk for server returned status: ${xhr.status}`);
						
						// Try parse json response
						try {
							let json = JSON.parse(xhr.response);

							if (json.message) {
								console.error(`message: ${json.message}`);
								_reject(json.message);
								return;
							}
						} catch (error) {}

						_reject("Upload failed!");
					}
				};

				// Send
				const formData = new FormData();
				formData.append("handle", handle);
				formData.append("chunkId", chunkId.toString());
				formData.append("data", new Blob([encryptedChunkBuffer]));

				xhr.send(formData);
			});
		};

		let success = true;
		let failReason = "";

		const transferQueue = new PromiseQueue(
			CONSTANTS.MAX_TRANSFER_PARALLEL_CHUNKS,
			chunkCount,
			true, // Ordered
			nextChunkUploadPromise,
			() => {}, // Successful promise resolve data (empty because it's not needed for uploads)
			// Success callback
			() => {},
				// Fail callback
			(reason: string) => {
				success = false;
				failReason = reason;
			}
		);
	
		await transferQueue.run();

		if (!success) {
			reject({ reason: failReason });
			return;
		}

		// Finalise upload
		const utcTimeAsSeconds: number = Math.floor(Date.now() / 1000); // Store as seconds, not milliseconds

		// Create metadata and encrypt the file crypt key
		const fileMetadata: FileMetadata = {
			parentHandle: parentHandle,
			fileName: uploadEntry.fileName,
			dateAdded: utcTimeAsSeconds,
			isFolder: false
		};

		const encFileCryptKey = encryptFileCryptKey(fileCryptKey, masterKey);
		const encFileMetadata = createEncryptedFileMetadata(fileMetadata, masterKey);

		// Get file signature
		const fileSignature = await fileSignatureBuilder.getSignature(ed25519PrivateKey);
		
		// Finalise upload with the encrypted metadata and file crypt key
		response = await fetch("/api/transfer/finaliseupload", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				handle: handle,
				encryptedMetadataB64: base64js.fromByteArray(encFileMetadata),
				encryptedFileCryptKeyB64: base64js.fromByteArray(encFileCryptKey),
				signature: fileSignature
			})
		});

		if (!response.ok) {
			const json = await response.json();

			if (json.message) {
				reject({ reason: json.message });
			} else {
				reject({ reason: "Failed to finalise upload!" });
			}

			return;
		}

		// Resolve with some data about the file that was uploaded
		resolve({
			handle: handle,
			parentHandle: parentHandle,
			fileCryptKey: fileCryptKey,
			encryptedFileSize: encryptedFileSize
		});
	});
};

type FileDownloadResolveInfo = {
	handle: string
};

type FileDownloadRejectInfo = {
	handle: string,
	reason: string
};

// progress is a value between 0 and 1
type DownloadChunkProgressCallback = (progress: number, deltaBytes: number) => void;

enum DownloadFileMethod {
	WritableStream, // Transfer will appear in transfer list and it will write data to a filesystem handle
	Silent // Transfer won't appear in transfer list and it will return data as a large Uint8Array instead
}

type DownloadFileContext = {
	method: DownloadFileMethod,
	writableStream?: FileSystemWritableFileStream
}

class ClientDownloadManager {
	// TODO: SIMPLE BUFFERING SYSTEM LIKE SERVER (only for downloadWholeFile)

	// Interactive means that it will prompt the user to select the download file's destination
	downloadWholeFile(
		handle: string,
		realFileSize: number,
		outputFileName: string,
		fileCryptKey: Uint8Array,
		context: DownloadFileContext,
		progressCallbackHandle?: string,
		progressCallback?: TransferListProgressInfoCallback
	): Promise<Uint8Array | undefined> { // Silent download method will resolve with a Uint8Array
		// Sanity checks
		if (progressCallback && !progressCallbackHandle)
			throw new Error(`progressCallback exists but not progressCallbackHandle!`);
		
		if (!progressCallback && progressCallbackHandle)
			throw new Error(`progressCallbackHandle exists but not progressCallback!`);

		if (context.method == DownloadFileMethod.WritableStream && context.writableStream == undefined)
			throw new Error(`A writableStream must be provided when using the writable stream download method!`);
		
		if (context.method == DownloadFileMethod.Silent && context.writableStream)
			console.warn(`A writableStream was provided using silent download method which is unnecessary!`);

		// Add to transfer list immediately
		if (progressCallback)
			progressCallback(handle, TransferType.Downloads, TransferStatus.Transferring, undefined, 0, outputFileName, realFileSize, "Downloading...");

		// Calculate chunk count
		const { chunkCount } = getEncryptedFileSizeAndChunkCount(realFileSize);

		// Silent downloads return
		let fileContentsData: Uint8Array | undefined;

		if (context.method == DownloadFileMethod.Silent) {
			fileContentsData = new Uint8Array(realFileSize);
		}

		return new Promise<Uint8Array | undefined>(async (resolve, reject) => {
			// Since this function downloads a whole file, the signature must be verified (TODO: if store chunk id inside encrypted data, this may not be necessary!)
			const signatureBuilder: FileSignatureBuilder = new FileSignatureBuilder();
			let transferredBytes = 0;

			const chunkDownloadProgressCallback: DownloadChunkProgressCallback = (progress: number, deltaBytes: number) => {
				transferredBytes += deltaBytes;

				if (transferredBytes > realFileSize) {
					transferredBytes = realFileSize;
				}

				// Calculate total progress (TODO: 250ms delay to stop too many callbacks?)
				if (progressCallback) {
					const totalProgress = Math.min(transferredBytes / realFileSize, 1);
					progressCallback(handle, TransferType.Downloads, TransferStatus.Transferring, undefined, totalProgress, outputFileName, realFileSize, "Downloading...");
				}
			}

			for (let i = 0; i < chunkCount; i++) {
				let chunkData: Uint8Array | undefined;
				
				try {
					chunkData = await this.downloadChunk(handle, i, fileCryptKey, chunkDownloadProgressCallback);

					if (context.method == DownloadFileMethod.WritableStream) {
						await context.writableStream!.write(chunkData);
					} else {
						const writeOffset = i * CONSTANTS.CHUNK_DATA_SIZE;
						fileContentsData!.set(chunkData, writeOffset);
					}
				} catch (error) {
					// Failed progress callback
					if (progressCallback)
						progressCallback(handle, TransferType.Downloads, TransferStatus.Failed);
				
					if (context.method == DownloadFileMethod.WritableStream)
						await context.writableStream!.abort();

					reject(error);
					return;
				}
			}

			// Finish progress callback
			if (progressCallback)
				progressCallback(handle, TransferType.Downloads, TransferStatus.Finished, undefined, 1);
			
			if (context.method == DownloadFileMethod.WritableStream)
				await context.writableStream!.close();

			resolve(fileContentsData);
		});
	};

	downloadChunk(handle: string, chunkId: number, fileCryptKey: Uint8Array, progressCallback?: DownloadChunkProgressCallback): Promise<Uint8Array> {
		return new Promise<Uint8Array>(async (resolve, reject: (reason: any) => void) => {
			// Download chunk
			const xhr = new XMLHttpRequest();
			xhr.open("POST", "/api/transfer/downloadchunk", true);
			xhr.setRequestHeader("Content-Type", "application/json");
			xhr.responseType = "arraybuffer";

			let transferredBytes = 0;
			let lastProgressBytes = 0;
			const clientChunkSize = CONSTANTS.CHUNK_FULL_SIZE - 8; // The size of chunks received from the server should be the full chunk minus the header data

			xhr.onload = () => {
				if (xhr.status == 200) {
					const rawChunkArrayBuffer = xhr.response as ArrayBuffer;
					const chunkBuffer = new Uint8Array(rawChunkArrayBuffer);

					// Update progress
					if (progressCallback) {
						const deltaBytes = chunkBuffer.byteLength - lastProgressBytes;
						transferredBytes += deltaBytes;

						const progress = Math.min(transferredBytes / clientChunkSize, 1);
						progressCallback(progress, deltaBytes);
					}

					// Extract nonce and cipher text
					const nonce = new Uint8Array(chunkBuffer.slice(0, 24));
					const cipherText = new Uint8Array(chunkBuffer.slice(24, chunkBuffer.byteLength));
					
					// Decrypt
					try {
						const chacha = xchacha20poly1305(fileCryptKey, nonce);
						const plainText = chacha.decrypt(cipherText);
						
						// Resolve
						resolve(plainText);
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

				const deltaBytes = event.loaded - lastProgressBytes;
				lastProgressBytes = event.loaded;
				transferredBytes += deltaBytes;

				const progress = Math.min(transferredBytes / clientChunkSize, 1);
				progressCallback(progress, deltaBytes);
			}

			// Start request
			xhr.send(JSON.stringify({
				handle: handle,
				chunkId: chunkId
			}));
		});
	};
}

// TODO: class to manage downloads. 1. ability to manually start and stop downloads 2. ability to manually download whatever chunk of the file the user wants
// function downloadChunkFromServer()

type UploadFinishCallback = (progressCallbackHandle: string, newFilesystemEntry: FilesystemEntry) => void;
type UploadFailCallback = (progressCallbackHandle: string) => void;

class ClientUploadManager {
	private masterKey: Uint8Array;
	private ed25519PrivateKey: Uint8Array;
	private transferListInfoCallback: TransferListProgressInfoCallback;
	private uploadFinishCallback: UploadFinishCallback;
	private uploadFailCallback: UploadFailCallback;
	private uploadFileEntries: UploadFileEntry[] = [];
	private activeUploadCount = 0;

	constructor(
		masterKey: Uint8Array,
		ed25519PrivateKey: Uint8Array,
		transferListInfoCallback: TransferListProgressInfoCallback,
		uploadFinishCallback: UploadFinishCallback,
		uploadFailCallback: UploadFailCallback
	) {
		this.masterKey = masterKey;
		this.ed25519PrivateKey = ed25519PrivateKey;
		this.transferListInfoCallback = transferListInfoCallback;
		this.uploadFinishCallback = uploadFinishCallback;
		this.uploadFailCallback = uploadFailCallback;
	}

	private async runNextUpload() {
		if (this.uploadFileEntries.length == 0 || this.activeUploadCount >= CONSTANTS.MAX_PARALLEL_UPLOADS)
			return;

		const uploadEntry = this.uploadFileEntries.pop();

		if (!uploadEntry)
			return;

		try {
			this.activeUploadCount++;

			// TODO: /ffmpeg-core.worker.js ?

			//const m3u8Modified = m3u8Lines.join("\n");
			//console.log(m3u8Modified);

			/* TODO: THIS IS TEMPORARY
			// Open output file
			const outputFileHandle = await showSaveFilePicker({
				suggestedName: "output.mp3"
			});
			
			// Open output stream
			const writableStream = await outputFileHandle.createWritable();
			await writableStream.write(outputData);
			await writableStream.close();
			*/

			// Get upload entry metadata
			const fileName = uploadEntry.fileName;
			const fileExtension = getFileExtensionFromName(fileName);
			const fileCategory = getFileCategoryFromExtension(fileExtension);

			// Determine if file is a video AND the user wants to optimise them for streaming
			if (true) { // TODO: check user settings
				if (fileExtension == "mp4") {
					console.log("SPLITTING VIDEO!");

					const mediaProcessor = new MediaProcessor();
					
					const mediaProcessorProgressCallback: MediaProcessorProgressCallback = (progress) => {
						console.log(`ffmpeg progress: ${progress}`);
					};
					
					// Get binary data
					let inputDataArray;
					
					if (uploadEntry.file instanceof File) {
						const inputData = await uploadEntry.file.arrayBuffer();
						inputDataArray = new Uint8Array(inputData);
					} else {
						inputDataArray = uploadEntry.file;
					}

					const outputData = await mediaProcessor.optimiseVideoForStreaming(inputDataArray!, mediaProcessorProgressCallback);
					const videoBinaryData = outputData.videoBinaryData; // .ts file
					const m3u8 = outputData.m3u8Data;
					const m3u8Str = new TextDecoder().decode(m3u8);

					//console.log(`video binary size: ${videoBinaryData.byteLength}`);
					//console.log(`m3u8: ${m3u8Str}`);

					// Upload video as new upload file entry
					const videoUploadEntry: UploadFileEntry = {
						fileName: uploadEntry.fileName,
						fileSize: videoBinaryData.byteLength,
						file: videoBinaryData,
						parentHandle: uploadEntry.parentHandle,
						progressCallbackHandle: uploadEntry.progressCallbackHandle
					};

					//console.log("Uploading video binary");
					
					const videoResolveInfo = await uploadSingleFileToServer(videoUploadEntry, this.masterKey, this.ed25519PrivateKey, this.transferListInfoCallback);
					const videoFileHandle = videoResolveInfo.handle;

					//console.log("Done");
					
					// Set progress to waiting for the m3u8 to upload
					this.transferListInfoCallback(
						videoUploadEntry.progressCallbackHandle,
						TransferType.Uploads,
						TransferStatus.Waiting,
						videoUploadEntry.parentHandle,
						1,
						undefined,
						undefined,
						"Uploading video metadata..." // TODO: fix issue where it replaces this with "Waiting..."
					);
						
					//console.log(`Uploading video m3u8. size: ${m3u8.byteLength}`);
					//console.log(m3u8Str);

					// Upload m3u8
					const m3u8UploadEntry: UploadFileEntry = {
						fileName: "m3u8",
						fileSize: m3u8.byteLength,
						file: m3u8,
						parentHandle: videoFileHandle, // Parent handle is the video file
						progressCallbackHandle: "" // Empty because the m3u8 upload
					};

					const m3u8ResolveInfo = await uploadSingleFileToServer(m3u8UploadEntry, this.masterKey, this.ed25519PrivateKey);

					//console.log("Done");

					// Set progress to finish
					this.transferListInfoCallback(
						videoUploadEntry.progressCallbackHandle,
						TransferType.Uploads,
						TransferStatus.Finished,
						videoUploadEntry.parentHandle,
						1,
						undefined,
						undefined,
						""
					);

					// Add new uploaded file as a filesystem entry (ignores the m3u8 because it's not visible anyways)
					const newFilesystemEntry = createNewFilesystemEntryFromUploadEntryAndUploadResolveInfo(videoUploadEntry, videoResolveInfo, videoResolveInfo.fileCryptKey);
					this.uploadFinishCallback(videoUploadEntry.progressCallbackHandle, newFilesystemEntry);

					/*
					const m3u8Lines = m3u8Str.split("\n");

					m3u8Lines.forEach(line => {
						let parts = line.split(":")

						if (parts.length != 2)
							return;

						const name = parts[0];

						if (name != "#EXT-X-BYTERANGE")
							return;

						const value = parts[1];
						parts = value.split("@");
						
						if (parts.length != 2)
							return;

						const byteRangeLength = parseInt(parts[0]);
						const byteRangeOffset = parseInt(parts[1]);

						if (isNaN(byteRangeLength)) {
							console.error(`byteRangeLength from m3u8 is NaN!`);
							return;
						}

						if (isNaN(byteRangeOffset)) {
							console.error(`byteRangeOffset from m3u8 is NaN!`);
							return;
						}

						console.log(`offset: ${byteRangeOffset} length: ${byteRangeLength}`);
					});
					*/

					// Return here because it's already uploaded as a video
					return;
				}
			}

			// Upload file as a standard file
			const resolveInfo = await uploadSingleFileToServer(uploadEntry, this.masterKey, this.ed25519PrivateKey, this.transferListInfoCallback);

			// Set progress to finish
			this.transferListInfoCallback(
				uploadEntry.progressCallbackHandle,
				TransferType.Uploads,
				TransferStatus.Finished,
				uploadEntry.parentHandle,
				1,
				undefined,
				undefined,
				""
			);

			// Add new uploaded file as a filesystem entry
			const newFilesystemEntry = createNewFilesystemEntryFromUploadEntryAndUploadResolveInfo(uploadEntry, resolveInfo, resolveInfo.fileCryptKey);
			this.uploadFinishCallback(uploadEntry.progressCallbackHandle, newFilesystemEntry);
		} catch (error) {
			console.error(`Failed to upload single file to server! Error: ${error}`);

			// TODO: if video m3u8 upload failed but not binary data then delete the binary data on the server

			this.uploadFailCallback(uploadEntry.progressCallbackHandle);
		} finally {
			this.activeUploadCount--;
		}

		this.runNextUpload();
	}

	uploadFile(entry: UploadFileEntry) {
		this.uploadFileEntries.push(entry);

		// Sort because transfer lists are sorted alphabetically
		this.uploadFileEntries.sort((a, b) => {
			return b.fileName.localeCompare(a.fileName);
		});

		// Add to transfer list
		this.transferListInfoCallback(
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
	UploadFileEntry,
	DownloadFileEntry,
	DownloadFileContext,
	FileUploadResolveInfo,
	FileDownloadResolveInfo,
	UploadFinishCallback,
	UploadFailCallback
}

export {
	TransferType,
	TransferStatus,
	DownloadFileMethod,
	ClientUploadManager,
	ClientDownloadManager
};
