import { ClientDownloadManager, DownloadFileContext, DownloadFileMethod } from "./transfers";
import { FileCategory, FilesystemEntry } from "./userFilesystem";
import { Mutex } from "async-mutex";
import { getFileExtensionFromName } from "../utility/fileNames";
import { UserLocalCryptoInfo, getLocalStorageUserCryptoInfo } from "./localStorage";
import { decryptBuffer, encryptBuffer } from "./clientCrypto";
import ImageBlobReduce from "image-blob-reduce";
import CONSTANTS from "../common/constants";

type Thumbnail = {
	width: number;
	height: number;
	blob: Blob;
	blobUrl: string;
}

// TODO: move into another file?
// A list of supported image extensions that thumbnails can be generated for
const thumbnailSupportedExtensions = [
	"jpg", "jpeg", "jfif", "jfi", "jpe", "jif",
	"png",
	"bmp",
	"gif",
	"webp"
];

class ThumbnailGenerator {
	private downloadManager: ClientDownloadManager;
	private imageBlobReduceModule: ImageBlobReduce.ImageBlobReduce;
	
	constructor() {
		this.downloadManager = new ClientDownloadManager();
		this.imageBlobReduceModule = new ImageBlobReduce();
	}

	// TODO: if image is smaller than normal thumbnail size, use image directly as the thumbnail?
	generateThumbnailFromData(imageData: Uint8Array, thumbnailSize: number): Promise<Thumbnail> {
		return new Promise<Thumbnail>(async (resolve, reject) => {
			const imageBlob = new Blob([ imageData ]);
			const thumbnailCanvas = await this.imageBlobReduceModule.toCanvas(imageBlob, { max: thumbnailSize });

			// Convert to blob (jpeg of 90 quality)
			thumbnailCanvas.toBlob((blob) => {
				if (blob === null) {
					reject("Thumbnail blob is null");
					return;
				}

				const thumbnailBlobUrl = URL.createObjectURL(blob);

				const thumbnail: Thumbnail = {
					width: thumbnailCanvas.width,
					height: thumbnailCanvas.height,
					blob: blob,
					blobUrl: thumbnailBlobUrl
				};
	
				resolve(thumbnail);
			}, "image/jpeg", 90);
		});
	}

	// Downloads the image file and then resizes it to the thumbnail size
	generateThumbnailForFilesystemEntry(imageFileEntry: FilesystemEntry, thumbnailSize: number): Promise<Thumbnail | undefined> {
		return new Promise<Thumbnail | undefined>(async (resolve, reject) => {
			// Check supported file extensions for thumbnail generation
			const extension = getFileExtensionFromName(imageFileEntry.name);

			if (thumbnailSupportedExtensions.indexOf(extension) == -1) {
				resolve(undefined); // Resolve with no thumbnail
				return;
			}

			// Download the file data
			const context: DownloadFileContext = {
				method: DownloadFileMethod.Silent
			};

			const imageData = await this.downloadManager.downloadWholeFile(imageFileEntry, context);

			if (!imageData.data) {
				console.error(`Failed to download image for thumbnail generation! Handle: ${imageFileEntry.handle}`);
				resolve(undefined);
				return;
			}

			try {
				const thumbnail = await this.generateThumbnailFromData(imageData.data!, thumbnailSize);
				resolve(thumbnail);
			} catch {
				console.error("Failed to generate thumbnail data");
				resolve(undefined);
			}
		});
	};
}

class ThumbnailManager {
	private failedThumbnailHandlesCache: Set<string>;
	private busyMutexes: Map<string, Mutex>; // Maps a file entry's handle to a mutex. Used to prevent duplicate thumbnail generation processes
	private thumbnailGenerator: ThumbnailGenerator;
	private downloadManager: ClientDownloadManager;
	private thumbnailCache: Map<string, Thumbnail>;
	private thumbnailDatabase?: IDBDatabase;
	private databaseMutex: Mutex; // Prevents multiple attempts to initialise database
	private closeDatabaseTimeoutId: any;
	private userLocalCryptoInfo: UserLocalCryptoInfo;

	constructor() {
		this.failedThumbnailHandlesCache = new Set<string>();
		this.busyMutexes = new Map<string, Mutex>();
		this.thumbnailGenerator = new ThumbnailGenerator();
		this.downloadManager = new ClientDownloadManager();
		this.thumbnailCache = new Map<string, Thumbnail>();
		this.databaseMutex = new Mutex();
		this.userLocalCryptoInfo = getLocalStorageUserCryptoInfo()!;
	}

	getThumbnailCacheSizeInBytes() {
		let totalSize = 0;
		this.thumbnailCache.forEach(thumbnail => totalSize += thumbnail.blob.size);
		return totalSize;
	}

	// This function starts a timeout automatically closes the thumbnails database after a period of inactivity
	private startCloseDatabaseTimeout() {
		if (this.closeDatabaseTimeoutId) {
			clearTimeout(this.closeDatabaseTimeoutId);
			this.closeDatabaseTimeoutId = undefined;
		}

		this.closeDatabaseTimeoutId = setTimeout(async () => {
			// Wait for any busy mutexes to finish
			const promises: Promise<void>[] = [];
			
			this.busyMutexes.forEach(mutex => {
				promises.push(mutex.waitForUnlock());
			});

			await Promise.all(promises);

			// Close database
			if (this.thumbnailDatabase) {
				this.thumbnailDatabase.close();
				this.thumbnailDatabase = undefined;
			}
		}, CONSTANTS.THUMBNAILS_DATABASE_CLOSE_TIMEOUT_MS);
	}

	private async openDatabase() {
		const releaseDbMutex = await this.databaseMutex.acquire();

		try {
			// If already opened, just return to skip this step.
			if (this.thumbnailDatabase != undefined) {
				return;
			}

			await new Promise<void>(resolve => {
				// Try open IndexedDB for thumbnails
				const request = window.indexedDB.open(CONSTANTS.THUMBNAILS_DATABASE_NAME, 1);
		
				request.onerror = (event) => {
					console.error(`Failed to load thumbnails web database.`);
					resolve();
				}
				
				request.onsuccess = (event) => {
					this.thumbnailDatabase = request.result;
					// console.log("Opened thumbnails database successfully.");
					resolve();
				}
		
				request.onupgradeneeded = async (event) => {
					const resultDb = request.result;

					if (event.oldVersion == 0) {
						// Initialise database
						await new Promise<void>((resolve, reject) => {
							const objectStore = resultDb.createObjectStore(CONSTANTS.THUMBNAILS_DATABASE_NAME, { keyPath: "handle", autoIncrement: false });

							objectStore.transaction.oncomplete = () => {
								this.thumbnailDatabase = resultDb;
								resolve();
							}

							objectStore.transaction.onerror = () => {
								console.error(request.error);
								reject();
							}
						});

						console.log(`Initialised thumbnail database successfully.`);
					} else {
						console.warn("handle oldVersion != 0");
					}

					resolve();
				}
			});
		} finally {
			releaseDbMutex();
		}

		this.startCloseDatabaseTimeout();
	}

	getThumbnail(fileEntry: FilesystemEntry, generateIfNotFound: boolean): Promise<Thumbnail | undefined> {
		return new Promise<Thumbnail | undefined>(async (resolve, reject) => {
			const fileHandle = fileEntry.handle;

			// Add new mutex if no mutex for this file handle
			if (!this.busyMutexes.has(fileHandle)) {
				this.busyMutexes.set(fileHandle, new Mutex());
			}
			
			const thumbnailMutex = this.busyMutexes.get(fileHandle)!;
			const thumbnailMutexRelease = await thumbnailMutex.acquire();

			try {
				// Check supported file extensions for thumbnail generation
				const extension = getFileExtensionFromName(fileEntry.name);

				if (thumbnailSupportedExtensions.indexOf(extension) == -1) {
					resolve(undefined); // Resolve with no thumbnail
					return;
				}

				if (fileEntry.size > 25000000) { // TODO: user settings
					reject("File is too big for thumbnail generation!");
					return;
				}

				// If thumbnail generation for this entry previously failed, then reject
				if (this.failedThumbnailHandlesCache.has(fileHandle)) {
					reject("Thumbnail failed previously. Skipping...");
					return;
				}

				// Check thumbnail cache for this thumbnail
				if (this.thumbnailCache.has(fileHandle)) {
					resolve(this.thumbnailCache.get(fileHandle)!);
					return;
				}
		
				if (fileEntry.category == FileCategory.Video) {
					console.warn("NOT IMPLEMENTED! Video thumbnail generation should be done when watching videos.");
					reject("NOT IMPLEMENTED");
				} else {
					// Open database
					await this.openDatabase();
					
					if (this.thumbnailDatabase == undefined) {
						reject("Thumbnails database doesn't exist!");
						return;
					}

					// Try get the thumbnail from the database
					const transaction = this.thumbnailDatabase.transaction(CONSTANTS.THUMBNAILS_DATABASE_NAME, "readonly");
					const thumbnailsStore = transaction.objectStore(CONSTANTS.THUMBNAILS_DATABASE_NAME);

					const existingThumbnail = await new Promise<Thumbnail | undefined>(resolve => {
						const request = thumbnailsStore.get(fileHandle);

						request.onerror = () => resolve(undefined);

						request.onsuccess = async () => {
							if (request.result) {
								const width = request.result.width;
								const height = request.result.height;
								const encryptedBlob = request.result.blob;

								let decryptedBlob: Blob;

								try {
									const buffer = await encryptedBlob.arrayBuffer();
									const bufferArray = new Uint8Array(buffer);
									const decryptedData = decryptBuffer(bufferArray, this.userLocalCryptoInfo.masterKey);

									decryptedBlob = new Blob([ decryptedData ]);
								} catch (error) {
									reject(error);
									return;
								}

								const thumbnail: Thumbnail = {
									width: width,
									height: height,
									blob: decryptedBlob,
									blobUrl: URL.createObjectURL(decryptedBlob),
								}

								resolve(thumbnail);
							} else {
								resolve(undefined);
							}
						};
					});

					// TODO: TEMPORARY FOR DEBUGGING
					if (existingThumbnail) {
						// Cache the thumbnail
						this.thumbnailCache.set(fileHandle, existingThumbnail);

						// Check thumbnail cache size (TODO: it doesn't grow that much, but still have a limit)
						// console.log(`Thumbnail cache size: ${this.getThumbnailCacheSizeInBytes()}`);

						resolve(existingThumbnail);
						return;
					} else if (!generateIfNotFound) {
						reject("No thumbnail found. Won't generate.");
						return;
					}

					// Generate new thumbnail if thumbnail doesn't exist
					console.log(`Generating thumbnail for handle: ${fileHandle}`);

					// Generate thumbnails
					const newThumbnail = await this.thumbnailGenerator.generateThumbnailForFilesystemEntry(fileEntry, CONSTANTS.THUMBNAIL_SIZE);

					if (newThumbnail != undefined) {
						// Cache the thumbnail
						this.thumbnailCache.set(fileHandle, newThumbnail);

						// Add thumbnail to database
						try {
							// Encrypt thumbnail blob
							const thumbBuffer = await newThumbnail.blob.arrayBuffer();
							const thumbData = new Uint8Array(thumbBuffer);
							const encryptedThumbData = encryptBuffer(thumbData, this.userLocalCryptoInfo.masterKey);
							const encryptedThumbBlob = new Blob([ encryptedThumbData ]);

							// Open database again because timeout could have closed the database
							await this.openDatabase();

							// Begin store transaction
							const thumbnailsStore = this.thumbnailDatabase
								.transaction(CONSTANTS.THUMBNAILS_DATABASE_NAME, "readwrite")
								.objectStore(CONSTANTS.THUMBNAILS_DATABASE_NAME);

							await new Promise<void>(async (resolve, reject) => {
								const addRequest = thumbnailsStore.add({
									handle: fileHandle,
									width: newThumbnail.width,
									height: newThumbnail.height,
									blob: encryptedThumbBlob
								});

								addRequest.onsuccess = () => resolve();
								addRequest.onerror = () => reject(addRequest.error); 
							});

							resolve(newThumbnail);
						} catch (error) {
							reject(error);
						}
						
						resolve(newThumbnail);
					}
				}
			} finally {
				thumbnailMutexRelease();
				this.busyMutexes.delete(fileHandle);
			}
		});
	}
}

export type {
	Thumbnail
}

export {
	ThumbnailGenerator,
	ThumbnailManager
}
