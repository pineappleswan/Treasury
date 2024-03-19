import { randomBytes } from "@noble/ciphers/crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { showSaveFilePicker } from "native-file-system-adapter";
import { decryptEncryptedFileCryptKey, FileMetadata, encryptFileCryptKey, createEncryptedFileMetadata } from "../common/clientCrypto";
import { getEncryptedFileSizeAndChunkCount, createEncryptedChunkBuffer } from "../common/commonUtils";
import { OrderedPromiseQueue } from "../common/promiseQueue";
import { getMasterKeyAsUint8ArrayFromLocalStorage } from "../common/clientCrypto";
import { TransferListProgressInfoCallback } from "../components/transferList";
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
  file: File
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
	fileCryptKey: Uint8Array // not encrypted
};

// TODO: use this!!!
type FileUploadRejectInfo = {
	handle?: string,
	reason: string
};

// Upload file function (TODO: pass a settings object (for video streaming optimisation for example))

function uploadSingleFileToServer(
	file: File,
	parentHandle: string,
	masterKey: Uint8Array,
	progressCallback: TransferListProgressInfoCallback
) {
	return new Promise<FileUploadResolveInfo>(async (resolve, reject: (info: FileUploadRejectInfo) => void) => {
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
			reject({
				reason: "Failed to start upload!"
			});
			
			return;
		}
		
		// Get json data
		let json = await response.json();
		const handle = json.handle;

		// Initialise transfer entry in gui by calling progress callback
		progressCallback(handle, 0, TransferType.Uploads, TransferStatus.Waiting, file.name, file.size, "Waiting...");
		
		const nextChunkUploadPromise = (chunkId: number) => {
			return new Promise<void>(async (_resolve, _reject) => {
				const reader = new FileReader();
				
				// When the chunk is read, it will be sent in the event here
				reader.onload = (event) => {
					if (!event.target) {
						_reject("Failed to read file chunk!");
						return;
					}

					if (event.target.error) {
						_reject(event.target.error);
					}

					const rawChunkArrayBuffer = event.target.result as ArrayBuffer;
					const rawChunkUint8Array = new Uint8Array(rawChunkArrayBuffer); // Convert to Uint8Array for encryption
					
					// Encrypt chunk (TODO: encrypt chunk function!!! dont handle chacha here!!!)
					const nonce = randomBytes(24);
					const chacha = xchacha20poly1305(fileCryptKey, nonce);
					const encryptedBufferWithTag = chacha.encrypt(rawChunkUint8Array);
					const encryptedChunkBuffer = createEncryptedChunkBuffer(chunkId, nonce, encryptedBufferWithTag);
	
					// Try upload encrypted chunk

					// Add randomness to test uploading many chunks at random (TODO: only for testing)
					/*
					await new Promise((res) => {
						setTimeout(res, Math.random() * 500);
					});
					*/
					
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
						progressCallback(handle, progress, TransferType.Uploads, TransferStatus.Transferring, undefined, undefined, "Uploading...");
					};

					xhr.onload = () => {
						// Update progress
						const deltaBytes = encryptedChunkBuffer.byteLength - lastProgressBytes;
						transferredBytes += deltaBytes;

						const progress = Math.min(transferredBytes / encryptedFileSize, 1);
						progressCallback(handle, progress, TransferType.Uploads, TransferStatus.Transferring, undefined, undefined, "Uploading...");

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
							} catch (error) {

							}

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
				let blob = file.slice(chunkId * CONSTANTS.ENCRYPTED_CHUNK_DATA_SIZE, (chunkId + 1) * CONSTANTS.ENCRYPTED_CHUNK_DATA_SIZE);
				reader.readAsArrayBuffer(blob);
			});
		};

		let success = true;

		const transferQueue = new OrderedPromiseQueue(
			CONSTANTS.MAX_TRANSFER_PARALLEL_CHUNKS,
			chunkCount,
			nextChunkUploadPromise,
			() => {}, // Successful promise resolve data (empty because it's not needed for uploads)
			// Success callback
			() => progressCallback(handle, 1, TransferType.Uploads, TransferStatus.Finished, undefined, undefined, ""), // Success callback
			// Fail callback
			(reason: string) => {
				success = false;

				// Update progress entry
				progressCallback(handle, 1, TransferType.Uploads, TransferStatus.Failed, undefined, undefined, reason);

				reject({
					reason: reason
				});
			}
		);
	
		await transferQueue.run();

		if (success) {
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
			
			// Finalise upload with the encrypted metadata and file crypt key
			const response = await fetch("/api/transfer/finaliseupload", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					handle: handle,
					encryptedMetadataB64: base64js.fromByteArray(encFileMetadata),
					encryptedFileCryptKeyB64: base64js.fromByteArray(encFileCryptKey)
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
				fileCryptKey: fileCryptKey
			});
		}
	});
};

const uploadFilesToServer = (files: UploadFileEntry[], parentHandle: string, progressCallback: TransferListProgressInfoCallback) => {
	const masterKey = getMasterKeyAsUint8ArrayFromLocalStorage();

	if (masterKey == null) {
		console.error("MASTER KEY IS NULL!!!");
		return;
	}
	
	// TODO: OrderedPromiseQueue ABOVE and call run every time this function is called!

	files.forEach((entry) => {
		const file: File = entry.file;

		uploadSingleFileToServer(file, parentHandle, masterKey, progressCallback)
		.catch((error: any) => {
			const reasonMessage = error.reasonMessage;
			console.error(`Upload cancelled for reason: ${reasonMessage}`);
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
	outputFileName: string,
	encryptedFileSize: number,
	masterKey: Uint8Array,
	progressCallback: (transferHandle: string, progress: number) => void
) {
	let transferredBytes = 0;
	
	const tryDownloadChunkAsync = (chunkId: number) => {
		return new Promise<Uint8Array>(async (resolve, reject: (reason: string) => void) => {
			// Download chunk
			const xhr = new XMLHttpRequest();
			xhr.open("POST", "/api/transfer/downloadchunk", true);
			xhr.setRequestHeader("Content-Type", "application/json");
			xhr.responseType = "arraybuffer";

			let lastProgressBytes = 0;

			xhr.onload = () => {
				if (xhr.status == 200) {
					const arrayBuffer = xhr.response as ArrayBuffer;
					const array = new Uint8Array(arrayBuffer);

					// Update progress
					const deltaBytes = arrayBuffer.byteLength - lastProgressBytes;
					transferredBytes += deltaBytes;
					progressCallback(handle, Math.min(transferredBytes / encryptedFileSize, 1));

					resolve(array);
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
				progressCallback(handle, Math.min(transferredBytes / encryptedFileSize, 1));
			}

			// Start request
			xhr.send(JSON.stringify({
				handle: handle,
				chunkId: chunkId
			}));
		});
	};
	
	const promise: Promise<FileDownloadResolveInfo> = new Promise(async (resolve, reject: (info: FileDownloadRejectInfo) => void) => {
		// Open output file
		const outputFileHandle = await showSaveFilePicker({
			suggestedName: outputFileName
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
			let chunkBuffer: Uint8Array;
			
			try {
				chunkBuffer = await tryDownloadChunkAsync(i);
			}	catch (error) {
				console.log(`download chunk error: ${error}`);

				writableStream.abort();

				reject({
					handle: handle,
					reason: `Chunk ${i} failed to download!`
				});

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
		progressCallback(handle, 1);

		// Finish download
		await writableStream.close();
		
		// Tell server download is done
		const finishResponse = await fetch("/api/transfer/enddownload", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				handle: handle
			})
		});

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

	return promise;
}

export type {
	UploadFileEntry,
	DownloadFileEntry,
	FileUploadResolveInfo,
	FileDownloadResolveInfo
}

export {
	TransferType,
	TransferStatus,
  uploadFilesToServer,
	downloadFileFromServer
};
