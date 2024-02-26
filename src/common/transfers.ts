import { ENCRYPTED_CHUNK_DATA_SIZE, ENCRYPTED_CHUNK_FULL_SIZE, getEncryptedFileSizeAndChunkCount, uint8ArrayToHexString } from "./commonCrypto.js";
import { hexStringToUint8Array, createEncryptedChunkBuffer } from "./commonCrypto.js";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { getMasterKeyAsUint8ArrayFromLocalStorage } from "./commonCrypto.js";
/*
---* OPTIMISED VIDEO STRATEGY *----

upload video:
	1. Split video into hls files and generate m3u8 for it too but make sure the .ts file output is one big binary (ONLY if video is larger than a certain threshold! e.g 8 MB)
	2. Upload m3u8 file as a pointer file ($.m3u8->HANDLE)

download video:
	1. Download big .ts file and transmux back to mp4

watch video:
	1. Fragment downloader must check if fragment overlaps two chunks, and if so, download them accordingly

*/

// Upload file function (TODO: pass a settings object (for video streaming optimisation for example))
const uploadFileToServer = (file) => {
	// 1. Get master key
	const masterKey = getMasterKeyAsUint8ArrayFromLocalStorage();

	// 2. Generate a random file encryption key (256 bit)
	const fileCryptKey = randomBytes(32);

	// 3. Encrypt the file crypt key for storage on the server
	// 72 bytes for storing: nonce (24B) + enc file key (32B) + poly1305 authentication tag (16B)
	let encFileCryptKeyWithNonce = new Uint8Array(72);
	
	{
		const nonce = randomBytes(24); // 192 bit
		const chacha = xchacha20poly1305(masterKey, nonce);
		const encFileCryptKey = chacha.encrypt(fileCryptKey);

		encFileCryptKeyWithNonce.set(nonce, 0); // Append nonce
		encFileCryptKeyWithNonce.set(encFileCryptKey, 24); // Append encrypted file key with poly1305 authentication tag
	}

	// 4. Convert to string for storage on server
	let encFileCryptKeyWithNonceStr = uint8ArrayToHexString(encFileCryptKeyWithNonce);

	console.log(`encFileCryptKeyWithNonceStr: ${encFileCryptKeyWithNonceStr} len: ${encFileCryptKeyWithNonceStr.length}`);

	return new Promise(async (resolve, reject) => {
		const rawFileSize = file.size;
		const { encryptedFileSize, chunkCount } = getEncryptedFileSizeAndChunkCount(rawFileSize);

		// TODO: HANDLE FOLDER UPLOADS!!!

		// Request server to start upload
		let response = await fetch("/api/transfer/startupload", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				fileSize: encryptedFileSize,
				chunkCount: chunkCount,
				encFileCryptKeyWithNonceStr: encFileCryptKeyWithNonceStr
			})
		});

		let data = await response.json();

		if (!data.success) {
			reject("Failed to start upload because server returned success: false");
			return;
		}

		console.log(data);

		const transferHandle = data.handle;

		// Busy chunks are chunks that are in progress of being uploaded to the server,
		// therefore 'MAX_BUSY_CHUNKS' is the max number of chunk uploads happening in parallel
		let busyChunks = 0;
		const MAX_BUSY_CHUNKS = 3;
		//const maxUploadChunkRetries = 3; // TODO: add retrying again

		// Set to true when the upload is cancelled or fails
		let uploadCancelled = false;
		let uploadCancelReason = "";

		const tryUploadEncryptedChunk = async (chunkArrayBuffer, chunkId) => {
			return new Promise(async (_resolve, _reject) => {
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
				let totalUploadedBytes = 0;
				let lastEventBytes = 0;

				const xhr = new XMLHttpRequest();
				xhr.open("POST", "/api/transfer/uploadchunk", true);

				xhr.upload.onprogress = (event) => {
					if (!event.lengthComputable)
						return;

					let transferredBytes = event.loaded;
					let deltaBytes = transferredBytes - lastEventBytes;
					deltaBytes = Math.max(deltaBytes, 0);
					lastEventBytes = transferredBytes;
					totalUploadedBytes += deltaBytes;
					totalUploadedBytes = Math.min(totalUploadedBytes, chunkSize);

					// TODO: progress value callback or something
					// console.log(`Progress: ${(totalUploadedBytes / chunkSize) * 100}%`)
				};

				xhr.onload = () => {
					if (xhr.status == 200) {
						_resolve();
					} else {
						// Try parse json response
						let json = JSON.parse(xhr.response);

						if (json.cancelUpload == true) {
							uploadCancelled = true;
							uploadCancelReason = json.message;
						}

						_reject();
					}
				};

				// Send
				const formData = new FormData();
				formData.append("handle", transferHandle);
				formData.append("chunkId", chunkId);
				formData.append("data", new Blob([chunkArrayBuffer]));

				xhr.send(formData);
			});
		};

		const submitUnencryptedChunkForUpload = (event, chunkId) => {
			if (event.target.error == null) {
				const rawChunkArrayBuffer = event.target.result; // ArrayBuffer type
				
				// Conver to Uint8Array for encryption
				const rawChunkUint8Array = new Uint8Array(rawChunkArrayBuffer);

				// Encrypt chunk
				const nonce = randomBytes(24);
				const chacha = xchacha20poly1305(fileCryptKey, nonce);
				const encryptedBufferWithTag = chacha.encrypt(rawChunkUint8Array);
				const encryptedChunkBuffer = createEncryptedChunkBuffer(chunkId, nonce, encryptedBufferWithTag);

				console.log(`submitted id: ${chunkId} size: ${encryptedChunkBuffer.byteLength}`);

				tryUploadEncryptedChunk(encryptedChunkBuffer, chunkId)
				.then(() => {
					busyChunks--;
				})
				.catch(() => {
					uploadCancelled = true;
					uploadCancelReason = "Failed to upload chunk";
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
			let blob = file.slice(chunkId * ENCRYPTED_CHUNK_DATA_SIZE, (chunkId + 1) * ENCRYPTED_CHUNK_DATA_SIZE);
			reader.readAsArrayBuffer(blob);
		};

		// Tries to finalise the upload only when the busy chunk count is zero.
		// The loop should only be started when the last chunk has been submitted for upload.
		const tryFinaliseLoop = () => {
			if (busyChunks == 0) {
				// Return success boolean and the transfer handle
				resolve({
					success: true,
					handle: transferHandle
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

			if (busyChunks < MAX_BUSY_CHUNKS) {
				busyChunks++;
				submitNextChunk();
			}

			if (currentChunkId * ENCRYPTED_CHUNK_DATA_SIZE < rawFileSize) {
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
			console.error("UPLOAD CANCELLED");

			reject({
				success: false,
				reasonMessage: uploadCancelReason,
				handle: transferHandle
			});
		}
	});
};

export {
  uploadFileToServer
};
