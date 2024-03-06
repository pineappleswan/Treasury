import {
	getEncryptedFileSizeAndChunkCount,
	uint8ArrayToHexString,
	createEncryptedChunkBuffer,
} from "../common/common";

import { getMasterKeyAsUint8ArrayFromLocalStorage } from "../common/clientCrypto";
import CONSTANTS from "../common/constants";

import { randomBytes } from "@noble/ciphers/crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { Mutex } from "async-mutex";

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

type FileUploadResolveInfo = {
	success: boolean,
	handle: string,
	fileCryptKey: Uint8Array // not encrypted
};

// Upload file function (TODO: pass a settings object (for video streaming optimisation for example))
function uploadFileToServer(file: File, progressCallback: (transferHandle: string, progress: number) => void) {
	const promise: Promise<FileUploadResolveInfo> = new Promise(async (resolve, reject) => {
		// Get master key
		const masterKey = getMasterKeyAsUint8ArrayFromLocalStorage();

		if (masterKey == null) {
			console.error("masterKey is null! User may not be logged in!");
			return;
		}

		// Generate a random file encryption key (256 bit)
		const fileCryptKey = randomBytes(32);

		const rawFileSize = file.size;
		const { encryptedFileSize, chunkCount } = getEncryptedFileSizeAndChunkCount(rawFileSize);

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

		let data = await response.json();

		if (!data.success) {
			reject("Failed to start upload because server returned unsuccessful");
			return;
		}

		// console.log(data);

		const transferHandle = data.handle;

		// Busy chunks are chunks that are in progress of being uploaded to the server,
		// therefore 'MAX_TRANSFER_BUSY_CHUNKS' is the max number of chunk uploads happening in parallel
		let busyChunks = 0;
		//const maxUploadChunkRetries = 3; // TODO: add retrying again?

		// Set to true when the upload is cancelled or fails (TODO: this probably isnt even needed... its just bloat)
		let uploadCancelled = false;
		let uploadCancelReason = "";

		// Loop for calling progress callback
		const progressDataMutex = new Mutex();
		const chunkUploadProgressDictionary: {[key: number]: number} = {};

		// Initialise
		for (let i = 0; i < chunkCount; i++)
			chunkUploadProgressDictionary[i] = 0;

		const progressCallbackInterval = setInterval(() => {
			const totalBytes = Object.values(chunkUploadProgressDictionary).reduce((a: number, b: number) => a + b, 0);
			const progress = totalBytes / rawFileSize;
			progressCallback(transferHandle, progress);
		}, 10);

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

				const chunkSize = chunkArrayBuffer.byteLength;
				const xhr = new XMLHttpRequest();
				xhr.open("POST", "/api/transfer/uploadchunk", true);

				xhr.upload.onprogress = async (event) => {
					if (!event.lengthComputable)
						return;

					// Update progress data
					const release = await progressDataMutex.acquire();

					try {
						chunkUploadProgressDictionary[chunkId] = Math.min(event.loaded, CONSTANTS.ENCRYPTED_CHUNK_DATA_SIZE);
					} finally {
						release();
					}
				};

				xhr.onload = () => {
					chunkUploadProgressDictionary[chunkId] = CONSTANTS.ENCRYPTED_CHUNK_DATA_SIZE;

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
						
						clearInterval(progressCallbackInterval);

						reject({
							success: false,
							reasonMessage: uploadCancelReason,
							handle: transferHandle
						});
					}
				};

				// Send
				const formData = new FormData();
				formData.append("handle", transferHandle);
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
				.then(() => {
					
				})
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
				clearInterval(progressCallbackInterval);

				// Call progress function for 100% completion
				progressCallback(transferHandle, 1); // 1 = 100%
				
				// Return success boolean and the transfer handle
				resolve({
					success: true,
					handle: transferHandle,
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
				success: false,
				reasonMessage: uploadCancelReason,
				handle: transferHandle
			});
		}
	});

	return promise;
};

export type {
	FileUploadResolveInfo
}

export {
  uploadFileToServer
};
