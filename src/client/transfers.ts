import { randomBytes } from "@noble/ciphers/crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { Mutex } from "async-mutex";
import { showSaveFilePicker } from "native-file-system-adapter";
import { decryptEncryptedFileCryptKey } from "../common/clientCrypto";
import { getEncryptedFileSizeAndChunkCount, createEncryptedChunkBuffer } from "../common/commonUtils";
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

type UploadFileEntry = {
  file: File,
  name: string,
  size: number
}

type DownloadFileEntry = {
	handle: string,
	fileName: string,
	encryptedFileSize: number,
	realFileSize: number
}

type FileUploadResolveInfo = {
	handle: string,
	fileCryptKey: Uint8Array // not encrypted
};

// TODO: use this!!!
type FileUploadRejectInfo = {
	handle?: string,
	reason: string
};

// Upload file function (TODO: pass a settings object (for video streaming optimisation for example))

// This function will not automatically finalise the upload!
function uploadFileToServer(file: File, progressCallback: (transferHandle: string, progress: number) => void) {
	const promise: Promise<FileUploadResolveInfo> = new Promise(async (resolve, reject: (info: FileUploadRejectInfo) => void) => {
		const rawFileSize = file.size;
		const { encryptedFileSize, chunkCount } = getEncryptedFileSizeAndChunkCount(rawFileSize);

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

		// Busy chunks are chunks that are in progress of being uploaded to the server,
		// therefore 'MAX_TRANSFER_BUSY_CHUNKS' is the max number of chunk uploads happening in parallel
		let busyChunks = 0;
		//const maxUploadChunkRetries = 3; // TODO: add retrying again?

		// Set to true when the upload is cancelled or fails (TODO: this probably isnt even needed... its just bloat)
		let uploadCancelled = false;
		let uploadCancelReason = "";

		let transferredBytes = 0;
		
		const tryUploadEncryptedChunk = async (chunkArrayBuffer: ArrayBuffer, chunkId: number) => {
			return new Promise(async (_resolve: (v: void) => void, _reject) => {
				// Add randomness to test uploading many chunks at random (TODO: only for testing)
				/*
				await new Promise((res) => {
					setTimeout(res, Math.random() * 500);
				});
				*/
				
				if (uploadCancelled) {
					_reject();
				}

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
					progressCallback(handle, Math.min(transferredBytes / encryptedFileSize, 1));
				};

				xhr.onload = () => {
					// Update progress
					const deltaBytes = chunkArrayBuffer.byteLength - lastProgressBytes;
					transferredBytes += deltaBytes;
					progressCallback(handle, Math.min(transferredBytes / encryptedFileSize, 1));

					if (xhr.status == 200) {
						_resolve();
					} else {
						uploadCancelled = true;
						xhr.abort();

						console.error(`Aborted upload chunk for server returned status: ${xhr.status}`);
						
						// Try parse json response
						try {
							let json = JSON.parse(xhr.response);
							uploadCancelReason = json.message;

							// TODO: deprecate json.cancelUpload result? no chunk retries???
						} catch (error) {
							// console.error(error);
						}

						reject({
							reason: uploadCancelReason,
							handle: handle
						});
					}
				};

				// Send
				const formData = new FormData();
				formData.append("handle", handle);
				formData.append("chunkId", chunkId.toString());
				formData.append("data", new Blob([chunkArrayBuffer]));

				xhr.send(formData);
			});
		};
		
		const submitUnencryptedChunkForUpload = (event: any, chunkId: number) => {
			if (event.target.error == null) {
				const rawChunkArrayBuffer = event.target.result; // ArrayBuffer type
				const rawChunkUint8Array = new Uint8Array(rawChunkArrayBuffer); // Convert to Uint8Array for encryption
				
				// Encrypt chunk
				const nonce = randomBytes(24);
				const chacha = xchacha20poly1305(fileCryptKey, nonce);
				const encryptedBufferWithTag = chacha.encrypt(rawChunkUint8Array);
				const encryptedChunkBuffer = createEncryptedChunkBuffer(chunkId, nonce, encryptedBufferWithTag);

				// console.log(`submitted id: ${chunkId} size: ${encryptedChunkBuffer.byteLength}`);

				tryUploadEncryptedChunk(encryptedChunkBuffer, chunkId)
				.finally(() => {
					busyChunks--;
				})
			} else {
				console.error(`READ FILE ERROR: ${event.target.error}`);
				uploadCancelled = true;
				uploadCancelReason = "File read error";
				// busyChunks--;
			}
		};

		let currentChunkId = 0;

		const submitNextChunk = () => {
			if (uploadCancelled) {
				return;
			}

			const chunkId = currentChunkId++;
			let reader = new FileReader();
			
			// When array buffer is loaded, upload it
			reader.onload = (event) => { submitUnencryptedChunkForUpload(event, chunkId) };

			// Read chunk
			let blob = file.slice(chunkId * CONSTANTS.ENCRYPTED_CHUNK_DATA_SIZE, (chunkId + 1) * CONSTANTS.ENCRYPTED_CHUNK_DATA_SIZE);
			reader.readAsArrayBuffer(blob);
		};

		// Tries to finalise the upload only when the busy chunk count is zero.
		// The loop should only be started when the last chunk has been submitted for upload.
		const tryFinaliseLoop = () => {
			if (busyChunks == 0) {
				// Call progress function for 100% completion
				progressCallback(handle, 1);
				
				// Return success boolean and the transfer handle
				resolve({
					handle: handle,
					fileCryptKey: fileCryptKey
				});
			} else {
				// Try again
				setTimeout(tryFinaliseLoop, 100);
			}
		};

		const trySubmitNextChunkLoop = () => {
			if (uploadCancelled) {
				return;
			}

			if (busyChunks < CONSTANTS.MAX_TRANSFER_BUSY_CHUNKS - 1) { // Minus one because for some reason the server can error saying there is this number + 1 buffered. TODO: explain and check the real reason
				busyChunks++;
				submitNextChunk();
			}

			if (currentChunkId * CONSTANTS.ENCRYPTED_CHUNK_DATA_SIZE < rawFileSize) {
				// Keep retrying if not done
				setTimeout(trySubmitNextChunkLoop, 10);
			} else {
				// Finalise
				tryFinaliseLoop();
			}
		};

		// Start submitting
		trySubmitNextChunkLoop();

		if (uploadCancelled) {
			reject({
				handle: handle,
				reason: uploadCancelReason
			});
		}
	});

	return promise;
};

type FileDownloadResolveInfo = {
	handle: string
};

type FileDownloadRejectInfo = {
	handle: string,
	reason: string
};

function downloadFileFromServer(handle: string, outputFileName: string, encryptedFileSize: number, masterKey: Uint8Array, progressCallback: (transferHandle: string, progress: number) => void) {
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
  uploadFileToServer,
	downloadFileFromServer
};
