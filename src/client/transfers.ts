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

// Due to the chunk based nature of files, uploading and downloading requires transferring chunks sequentially.
// However, downloading chunks one after the previous has been transferred has delay issues and so we need
// to be able to transfer multiple chunks concurrently (but still more or less sequentially).
class TransferPromiseQueue {
	private nextPromise: (chunkId: number) => Promise<any>;
	private promiseResolveDataCallback: (...args: any[]) => void;
	private successCallback: () => void;
	private failCallback: (reason: string) => void;
	private maxConcurrentTransfers: number;
	private chunkCount: number;
	private chunkId: number = 0;
	private ranCount: number = 0;
	private finishedCount: number = 0;
	private lastReturnedChunkId: number = -1;
	private busyCount: number = 0; // How many transfers are running concurrently

	constructor(
		maxConcurrentTransfers: number,
		chunkCount: number,
		nextPromise: (chunkId: number) => Promise<any>,
		promiseResolveDataCallback: (...args: any[]) => any,
		successCallback: () => void,

		// Called when a promise throws an error. The loop will also stop.
		failCallback: (reason: string) => void
	) {
		this.maxConcurrentTransfers = maxConcurrentTransfers;
		this.chunkCount = chunkCount;
		this.nextPromise = nextPromise;
		this.promiseResolveDataCallback = promiseResolveDataCallback;
		this.successCallback = successCallback;
		this.failCallback = failCallback;
	}

	// Will call promiseResolveDataCallback and ensure that the chunk id is in order TODO: better explanation plz, like a lot better
	private tryCallResolveDataCallback(chunkId: number, ...args: any[]) {
		const tryInterval = setInterval(() => {
			const dif = chunkId - this.lastReturnedChunkId;

			if (dif == 1) {
				this.promiseResolveDataCallback(args);
				this.busyCount--;
				this.finishedCount++;
				this.lastReturnedChunkId = chunkId;
				clearInterval(tryInterval);
			}
		}, 50);
	}

	async run() {
		while (true) {
			// Finish if all chunks have been run
			if (this.finishedCount == this.chunkCount) {
				this.successCallback();
				break;
			}
			
			if (this.busyCount < this.maxConcurrentTransfers && this.ranCount < this.chunkCount) {
				const currentChunkId = this.chunkId++;
				this.busyCount++;
				this.ranCount++;

				// Call next promise
				this.nextPromise(currentChunkId)
				.then((response) => {
					this.tryCallResolveDataCallback(currentChunkId, response);
				})
				.catch((error) => {
					this.failCallback(error);
					return;
				})
			}

			// Delay
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	}
}

// This function will not automatically finalise the upload!
function uploadFileToServer(file: File, progressCallback: (transferHandle: string, progress: number) => void) {
	const promise: Promise<FileUploadResolveInfo> = new Promise(async (resolve, reject: (info: FileUploadRejectInfo) => void) => {
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
		
		const nextPromise = (chunkId: number) => {
			return new Promise(async (_resolve: (v: void) => void, _reject) => {
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
						progressCallback(handle, Math.min(transferredBytes / encryptedFileSize, 1));
					};

					xhr.onload = () => {
						// Update progress
						const deltaBytes = encryptedChunkBuffer.byteLength - lastProgressBytes;
						transferredBytes += deltaBytes;
						progressCallback(handle, Math.min(transferredBytes / encryptedFileSize, 1));

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

		const transferQueue = new TransferPromiseQueue(
			CONSTANTS.MAX_TRANSFER_BUSY_CHUNKS,
			chunkCount,
			// Next promise
			nextPromise,
			// Successful promise resolve data
			(resolveData: any) => {
				console.log(`test resolve: ${resolveData}`);
			},
			// Success callback
			() => {
				console.log(`test success! TODO: rename to finish callback`);
			},
			// Fail callback
			(reason) => {
				console.log(`test failed! reason: ${reason}`);
			}
		);
	
		await transferQueue.run();

		resolve({
			handle: handle,
			fileCryptKey: fileCryptKey
		});
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
	TransferPromiseQueue,
	TransferType,
  uploadFileToServer,
	downloadFileFromServer
};
