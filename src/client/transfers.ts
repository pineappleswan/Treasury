import { randomBytes } from "@noble/ciphers/crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { showSaveFilePicker } from "native-file-system-adapter";
import { decryptEncryptedFileCryptKey, FileMetadata, encryptFileCryptKey, createEncryptedFileMetadata, encryptRawChunkBuffer, FileSignatureBuilder } from "./clientCrypto";
import { getEncryptedFileSizeAndChunkCount } from "../common/commonUtils";
import { PromiseQueue } from "../common/promiseQueue";
import { TransferListProgressInfoCallback } from "../components/transferList";
import { FilesystemEntry } from "./userFilesystem";
import { MediaProcessor, MediaProcessorProgressCallback } from "./mediaProcessor";
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
  file: File,
	parentHandle: string,
	progressCallbackHandle: string // Only used to identify the upload entry for progress callbacks
}

type DownloadFileEntry = {
	handle: string,
	fileName: string,
	encryptedFileSize: number,
	realFileSize: number
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

// Upload file function (TODO: pass a settings object (for video streaming optimisation for example))

function uploadSingleFileToServer(
	uploadEntry: UploadFileEntry,
	masterKey: Uint8Array,
	ed25519PrivateKey: Uint8Array,
	progressCallback: TransferListProgressInfoCallback
) {
	return new Promise<FileUploadResolveInfo>(async (resolve, reject: (info: FileUploadRejectInfo) => void) => {
		const { file, parentHandle, progressCallbackHandle } = uploadEntry;
		const rawFileSize = file.size;
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

		// console.log(`h: ${handle} - total chunk count: ${chunkCount}`);
		
		// Create file signature builder
		const fileSignatureBuilder = new FileSignatureBuilder();
		
		const nextChunkUploadPromise = (chunkId: number) => {
			return new Promise<void>(async (_resolve, _reject) => {
				const reader = new FileReader();

				console.log(`h: ${handle} - uploading chunk: ${chunkId}`);
				
				// When the chunk is read, it will be sent in the event here
				reader.onload = async (event) => {
					if (!event.target) {
						_reject("Failed to read file chunk!");
						return;
					}

					if (event.target.error) {
						_reject(event.target.error);
					}
					
					// Add randomness to test uploading many chunks at random (TODO: only for testing)
					/*
					await new Promise((res) => {
						setTimeout(res, Math.random() * 1000);
					});
					*/

					const rawChunkArrayBuffer = event.target.result as ArrayBuffer;
					const rawChunkUint8Array = new Uint8Array(rawChunkArrayBuffer); // Convert to Uint8Array for encryption

					// Build signature
					await fileSignatureBuilder.appendChunk(rawChunkUint8Array, chunkId);
					
					// Encrypt chunk
					const encryptedChunkBuffer = encryptRawChunkBuffer(rawChunkUint8Array, fileCryptKey);

					// Try upload encrypted chunk
					let lastProgressBytes = 0;

					// Start request
					const xhr = new XMLHttpRequest();
					xhr.open("POST", "/api/transfer/uploadchunk", true);

					xhr.upload.onprogress = async (event) => {
						if (!event.lengthComputable)
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
						const deltaBytes = encryptedChunkBuffer.byteLength - lastProgressBytes;
						transferredBytes += deltaBytes;

						const progress = Math.min(transferredBytes / encryptedFileSize, 1);
						progressCallback(progressCallbackHandle, TransferType.Uploads, TransferStatus.Transferring, parentHandle, progress, undefined, undefined, "Uploading...");

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
				};
				
				// Read next chunk
				let blob = file.slice(chunkId * CONSTANTS.CHUNK_DATA_SIZE, (chunkId + 1) * CONSTANTS.CHUNK_DATA_SIZE);
				reader.readAsArrayBuffer(blob);
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
			() => progressCallback(progressCallbackHandle, TransferType.Uploads, TransferStatus.Finished, parentHandle, 1, undefined, undefined, ""), // Provide parent handle on success callback
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
			fileName: file.name,
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

function downloadFileFromServer(
	handle: string,
	progressCallbackHandle: string,
	fileName: string,
	encryptedFileSize: number,
	realFileSize: number,
	masterKey: Uint8Array,
	progressCallback: TransferListProgressInfoCallback
) {
	let transferredBytes = 0;

	// Add to transfer list immediately
	progressCallback(progressCallbackHandle, TransferType.Downloads, TransferStatus.Waiting, undefined, 0, fileName, realFileSize, "Waiting...");
	
	const tryDownloadChunkAsync = (chunkId: number) => {
		return new Promise<ArrayBuffer>(async (resolve, reject: (reason: string) => void) => {
			// Download chunk
			const xhr = new XMLHttpRequest();
			xhr.open("POST", "/api/transfer/downloadchunk", true);
			xhr.setRequestHeader("Content-Type", "application/json");
			xhr.responseType = "arraybuffer";

			let lastProgressBytes = 0;

			xhr.onload = () => {
				if (xhr.status == 200) {
					const arrayBuffer = xhr.response as ArrayBuffer;

					// Update progress
					const deltaBytes = arrayBuffer.byteLength - lastProgressBytes;
					transferredBytes += deltaBytes;

					const progress = Math.min(transferredBytes / encryptedFileSize, 1);
					progressCallback(progressCallbackHandle, TransferType.Downloads, TransferStatus.Transferring, undefined, progress);

					resolve(arrayBuffer);
					return;
				} else {
					// TODO: clear dead download on the server, preferably at the location where the fail status code is returned.
					// if its a TRUE server error, then clear download loop should catch it (this todo message also applies to every place
					// in this code that has an abort and reject)

					xhr.abort();
					reject(`Bad response code: ${xhr.status}`);
					return;
				}
			}

			// Do progress callback
			xhr.onprogress = (event) => {
				if (!event.lengthComputable)
						return;

				const deltaBytes = event.loaded - lastProgressBytes;
				lastProgressBytes = event.loaded;
				transferredBytes += deltaBytes;

				const progress = Math.min(transferredBytes / encryptedFileSize, 1);
				progressCallback(progressCallbackHandle, TransferType.Downloads, TransferStatus.Transferring, undefined, progress);
			}

			// Start request
			xhr.send(JSON.stringify({
				handle: handle,
				chunkId: chunkId
			}));
		});
	};

	const endDownloadAsync = async () => {
		return fetch("/api/transfer/enddownload", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ handle: handle })
		});
	};
	
	return new Promise<FileDownloadResolveInfo>(async (resolve, reject: (info: FileDownloadRejectInfo) => void) => {
		// Open output file
		const outputFileHandle = await showSaveFilePicker({
			suggestedName: fileName
		});
		
		// Open output stream
		const writableStream = await outputFileHandle.createWritable();
		
		// Start the download
		const response = await fetch("/api/transfer/startdownload", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				handle: handle
			})
		});

		if (!response.ok) {
			await writableStream.abort();

			reject({
				handle: handle,
				reason: `Failed to start download! Response status: ${response.status}`
			});

			// End the download
			await endDownloadAsync();

			return;
		}

		// Get encrypted file crypt key
		const encryptedFileCryptKeyArray = new Uint8Array(await response.arrayBuffer());
		const fileCryptKey = decryptEncryptedFileCryptKey(encryptedFileCryptKeyArray, masterKey);

		// Calculate the file chunk count
		const { chunkCount } = getEncryptedFileSizeAndChunkCount(encryptedFileSize);

		// Download chunks
		let nextWriteChunkId = 0;
		let concurrentTransferCount = 0;

		for (let i = 0; i < chunkCount; i++) {
			let chunkBuffer: ArrayBuffer;
			
			try {
				chunkBuffer = await tryDownloadChunkAsync(i);
			}	catch (error) {
				console.log(`download chunk error: ${error}`);

				writableStream.abort();

				reject({
					handle: handle,
					reason: `Chunk ${i} failed to download!`
				});

				// End the download
				await endDownloadAsync();

				return;
			}

			// Extract nonce and cipher text
			const nonce = new Uint8Array(chunkBuffer.slice(0, 24));
			const cipherText = new Uint8Array(chunkBuffer.slice(24, chunkBuffer.byteLength));
			
			// Decrypt
			try {
				const chacha = xchacha20poly1305(fileCryptKey, nonce);
				const plainText = chacha.decrypt(cipherText);
				
				// Write to file
				await writableStream.write(plainText);
			} catch (error) {
				writableStream.abort();

				reject({
					handle: handle,
					reason: `Failed to decrypt chunk with chunk id: ${i}`
				});

				return;
			}
		}

		// Call progress function for 100% completion
		progressCallback(progressCallbackHandle, TransferType.Downloads, TransferStatus.Finished, undefined, 1);

		// Finish download
		await writableStream.close();
		
		// Tell server download is done
		const finishResponse = await endDownloadAsync();

		if (finishResponse.ok) {
			resolve({
				handle: handle
			});
		} else {
			reject({
				handle: handle,
				reason: `Failed to end download!`
			});
		}
	});
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

			const mediaProcessor = new MediaProcessor();

			const progressCallback: MediaProcessorProgressCallback = (progress) => {
				console.log(`ffmpeg progress: ${progress}`);
			};

			const inputData = await uploadEntry.file.arrayBuffer();
			const inputDataArray = new Uint8Array(inputData);
			const outputData = await mediaProcessor.optimiseVideoForStreaming(inputDataArray, progressCallback);

			const tsFile = outputData.videoBinaryData;
			const m3u8 = outputData.m3u8Data;

			const m3u8Str = new TextDecoder().decode(m3u8);

			console.log(m3u8Str);

			// Open output file
			const outputFileHandle = await showSaveFilePicker({
				suggestedName: "output.zip"
			});
			
			// Open output stream
			const writableStream = await outputFileHandle.createWritable();

			const gzipped = zipSync({
				"video.ts": [tsFile, {
					level: 0
				}],
				"video.m3u8": [m3u8, {
					level: 0
				}]
			});

			await writableStream.write(gzipped);
			await writableStream.close();

			/*
			// Download FFmpeg wasm (TODO: THIS IS TEMPORARILY HERE)
			const ffmpegCoreWasmResponse = await fetch("/cdn/ffmpegcorewasm");
			const ffmpegCoreJsResponse = await fetch("/cdn/ffmpegcorejs");
			const ffmpegCoreWasmBuffer = await ffmpegCoreWasmResponse.arrayBuffer();
			const ffmpegCoreJsText = await ffmpegCoreJsResponse.text();
			const ffmpegCoreWasmBlobUrl = URL.createObjectURL(new Blob([ ffmpegCoreWasmBuffer ], { type: "application/wasm" }));
			const ffmpegCoreJsBlobUrl = URL.createObjectURL(new Blob([ ffmpegCoreJsText ], { type: "text/javascript" }));

			const ffmpeg = new FFmpeg();

			ffmpeg.on("log", ({ message }) => {
				console.log(`ffmpeg: ${message}`);
			});

			ffmpeg.on("progress", ({ progress, time }) => {
				console.log(`ffmpeg progress: ${progress} time: ${time}`);
			});

			await ffmpeg.load({
				coreURL: ffmpegCoreJsBlobUrl,
				wasmURL: ffmpegCoreWasmBlobUrl
			});

			const fileData = await uploadEntry.file.arrayBuffer();

			await ffmpeg.writeFile("input.mp4", new Uint8Array(fileData));
			await ffmpeg.exec([ "-i", "input.mp4", "output.mp3" ]);
			
			const outputData = await ffmpeg.readFile("output.mp3");
			
			// Open output file
			const outputFileHandle = await showSaveFilePicker({
				suggestedName: "output.mp3"
			});
			
			// Open output stream
			const writableStream = await outputFileHandle.createWritable();
			await writableStream.write(outputData);
			await writableStream.close();
			*/

			/*
			// Start upload
			const resolveInfo = await uploadSingleFileToServer(uploadEntry, this.masterKey, this.ed25519PrivateKey, this.transferListInfoCallback);

			// If no errors were thrown, code below will run
			const fileName = uploadEntry.file.name;
			const fileExtension = getFileExtensionFromName(fileName);
			const fileCategory = getFileCategoryFromExtension(fileExtension);

			const newFilesystemEntry: FilesystemEntry = {
				parentHandle: uploadEntry.parentHandle,
				handle: resolveInfo.handle,
				name: uploadEntry.file.name,
				size: uploadEntry.file.size,
				encryptedFileSize: resolveInfo.encryptedFileSize,
				category: fileCategory,
				dateAdded: Math.floor(Date.now() / 1000),
				//fileCryptKey: resolveInfo.fileCryptKey,
				isFolder: false
			};

			this.uploadFinishCallback(uploadEntry.progressCallbackHandle, newFilesystemEntry);
			*/
		} catch (error) {
			console.error(`Failed to upload single file to server! Error: ${error}`);
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
			return b.file.name.localeCompare(a.file.name);
		});

		// Add to transfer list
		this.transferListInfoCallback(
			entry.progressCallbackHandle,
			TransferType.Uploads,
			TransferStatus.Waiting,
			entry.parentHandle,
			0,
			entry.file.name,
			entry.file.size,
			"Waiting..."
		);

		this.runNextUpload();
	}
}

export type {
	UploadFileEntry,
	DownloadFileEntry,
	FileUploadResolveInfo,
	FileDownloadResolveInfo,
	UploadFinishCallback,
	UploadFailCallback
}

export {
	TransferType,
	TransferStatus,
	ClientUploadManager,
	downloadFileFromServer
};
