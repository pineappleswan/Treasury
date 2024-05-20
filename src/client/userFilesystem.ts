/*

The local filesystem class is used to structure the received data from the server ... TODO: documentation

*/

import { UserLocalCryptoInfo, getLocalStorageUserCryptoInfo } from "./localStorage";
import { getEncryptedFileSize, getUTCTimeInSeconds } from "../common/commonUtils";
import { decryptBuffer, decryptEncryptedFileMetadata } from "./clientCrypto";
import { getFileCategoryFromExtension } from "./fileTypes";
import { getFileExtensionFromName } from "../utility/fileNames";
import { encryptFileMetadata } from "./clientCrypto";
import { EditMetadataEntry } from "../common/commonTypes";
import cloneDeep from "clone-deep";
import base64js from "base64-js";
import CONSTANTS from "../common/constants";

type StorageQuota = {
	bytesUsed: number;
	totalBytes: number; // The total number of bytes the user is allocated
};

enum FileCategory { 
	Generic = "Generic",
	Folder = "Folder",
	Image = "Image",
	Video = "Video",
	Audio = "Audio",
	Document = "Document",
	Archive = "Archive"
};

type FileMetadata = {
	fileName: string;
	dateAdded: number; // UTC time in seconds
	isFolder: boolean;
};

type FilesystemEntry = {
	handle: string;
	parentHandle: string;
	name: string;
	size: number; // The real file size
	encryptedFileSize: number;
	category: FileCategory;
	dateAdded: number;
	fileCryptKey: Uint8Array; // For decrypting the file
	isFolder: boolean;
	signature: Uint8Array;
};

type UserFilesystemTreeNode = {
	handle: string,
	children: UserFilesystemTreeNode[],
	filesystemEntry: FilesystemEntry
};

type UserFilesystemRenameEntry = {
	handle: string,
	newName: string
};

// TODO: make it a singleton
// TODO: include map where key is the file handle and value is the corresponding tree node! makes it faster to search for file entries by handle
class UserFilesystem {
	private userLocalCryptoInfo: UserLocalCryptoInfo;
	private storageQuota: StorageQuota;
	private rootNode: UserFilesystemTreeNode;

	constructor() {
		this.storageQuota = { bytesUsed: 0, totalBytes: 0 };
		this.userLocalCryptoInfo = getLocalStorageUserCryptoInfo()!;

		// Initialise root node
		this.rootNode = {
			handle: CONSTANTS.ROOT_DIRECTORY_HANDLE,
			children: [],
			filesystemEntry: {
				handle: "",
				parentHandle: "",
				name: "home",
				size: 0,
				encryptedFileSize: 0,
				category: FileCategory.Generic,
				dateAdded: 0,
				fileCryptKey: new Uint8Array(),
				isFolder: true,
				signature: new Uint8Array()
			}
		};
	}

	async initialise() {
		await this.syncStorageQuotaFromServer();
		await this.syncFiles(CONSTANTS.ROOT_DIRECTORY_HANDLE);
	}

	async syncStorageQuotaFromServer(): Promise<void> {
		return new Promise<void>(async (resolve, reject: (error: string) => void) => {
			// Get storage quota
			let response = await fetch("/api/getstoragequota");

			if (!response.ok) {
				reject(`/api/getstoragequota responded with status ${response.status}!`);
				return;
			}

			const quotaJson = await response.json();

			if (quotaJson.value == undefined) {
				reject(`Failed to get storage quota value from storage quota json!`);
				return;
			}

			// Get storage used
			response = await fetch("/api/getstorageused");

			if (!response.ok) {
				reject(`/api/getstorageused responded with status ${response.status}!`);
				return;
			}

			const usedJson = await response.json();

			if (usedJson.value == undefined) {
				reject(`Failed to get storage used value from storage used json!`);
				return;
			}

			this.storageQuota.totalBytes = quotaJson.value;
			this.storageQuota.bytesUsed = usedJson.value;

			resolve();
		});
	}

	// Downloads the metadata of all files under a specified parent handle and caches the data locally
	async syncFiles(parentHandle: string): Promise<void> {
		return new Promise<void>(async (resolve, reject: (error: string) => void) => {
			// Get filesystem data and process it
			const response = await fetch("/api/getfilesystem", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					handle: parentHandle
				})
			});

			const json = await response.json();
			
			if (!response.ok) {
				reject(`/api/getfilesystem returned code: ${response.status}`);
				return;
			}
			
			const rawFileEntriesData = json.data;
			
			if (!rawFileEntriesData) {
				reject(`/api/getfilesystem returned no 'data' in the json object!`);
				return;
			}
			
			// Reset existing nodes
			const parentNode = this.findNodeFromHandle(this.rootNode, parentHandle);
			
			if (!parentNode) {
				reject(`No parent node found with parent handle of: ${parentHandle}`);
				return;
			}
			
			parentNode.children = [];

			// Loop through all the raw data and process them
			rawFileEntriesData.forEach((entry: any) => {
				const { handle, size, encryptedFileCryptKeyB64, encryptedMetadataB64 } = entry;

				if (handle == undefined || size == undefined || encryptedFileCryptKeyB64 == undefined || encryptedMetadataB64 == undefined) {
					reject(`missing properties in raw file entry from the json data received from the server!`);
					return;
				}

				const encryptedFileCryptKey = base64js.toByteArray(entry.encryptedFileCryptKeyB64);
				const encryptedMetadata = base64js.toByteArray(entry.encryptedMetadataB64);
				const signature = entry.signature;

				// Decrypt file metadata
				let fileMetadata: FileMetadata;
	
				try {
					fileMetadata = decryptEncryptedFileMetadata(encryptedMetadata, this.userLocalCryptoInfo.masterKey);
				} catch (error) {
					reject(`Metadata decrypt failed! Error: ${error}`);
					return;
				}
	
				const fileName = fileMetadata.fileName;
				const fileExtension = getFileExtensionFromName(fileName);
				const fileCategory = getFileCategoryFromExtension(fileExtension);
				const isFolder = fileMetadata.isFolder;
				const encryptedFileSize = getEncryptedFileSize(size);

				// Validate signature length if entry isn't a folder
				const signatureBytes = base64js.toByteArray(signature);

				if (isFolder === false && signatureBytes.byteLength !== CONSTANTS.ED25519_SIGNATURE_BYTE_LENGTH) {
					reject(`CRITICAL: signature byte length mismatch with config!`);
					return;
				}

				// Decrypt file crypt key if entry isn't a folder
				let fileCryptKey: Uint8Array;

				if (isFolder) {
					fileCryptKey = new Uint8Array(0);
				} else {
					try {
						fileCryptKey = decryptBuffer(encryptedFileCryptKey, this.userLocalCryptoInfo.masterKey);
					} catch (error) {
						reject(`Failed to decrypt encrypted file crypt key! Error: ${error}`);
						return;
					}
				}

				// Create filesystem entry
				const newEntry: FilesystemEntry = {
					handle: handle,
					parentHandle: parentHandle,
					name: fileName,
					size: size,
					encryptedFileSize: encryptedFileSize,
					category: fileCategory,
					dateAdded: fileMetadata.dateAdded,
					fileCryptKey: fileCryptKey,
					isFolder: isFolder,
					signature: signatureBytes,
				};
				
				// Append new node
				parentNode.children.push({
					handle: handle,
					children: [],
					filesystemEntry: newEntry
				});
			});

			resolve();
		});
	}

	addNewFileEntryLocally(fileEntry: FilesystemEntry, parentHandle: string): boolean {
		const parentNode = this.findNodeFromHandle(this.rootNode, fileEntry.parentHandle);

		if (parentNode) {
			parentNode.children.push({
				handle: fileEntry.handle,
				children: [],
				filesystemEntry: fileEntry
			});

			return true;
		} else {
			console.error(`Couldn't add new file entry to local user filesystem because parent node wasn't found with handle: ${parentHandle}`);
		}

		return false;
	}

	// TODO: needs optimising!!!
	renameEntriesGlobally(entries: UserFilesystemRenameEntry[]): Promise<void> {
		return new Promise<void>(async (resolve, reject) => {
			// Create rename data
			const editMetadataEntries: EditMetadataEntry[] = [];
			const renamedNodes: { node: UserFilesystemTreeNode, newName: string }[] = [];

			// TODO: for performance testing only
			const startTime = Date.now();

			for (let i = 0; i < entries.length; i++) {
				const renameEntry = entries[i];
				const fileNode = this.findNodeFromHandle(this.rootNode, renameEntry.handle);

				if (fileNode === null) {
					reject("Invalid handle which didn't point to an existing file entry!");
					return;
				}

				const fileEntry = fileNode.filesystemEntry;

				const newMetadata: FileMetadata = {
					fileName: renameEntry.newName,
					dateAdded: fileEntry.dateAdded,
					isFolder: fileEntry.isFolder
				};

				const newEncryptedMetadata = encryptFileMetadata(newMetadata, this.userLocalCryptoInfo.masterKey);

				editMetadataEntries.push({
					handle: fileEntry.handle,
					encryptedMetadataB64: base64js.fromByteArray(newEncryptedMetadata)
				});

				renamedNodes.push({
					node: fileNode,
					newName: renameEntry.newName
				});
			};

			console.log(`Created rename data in ${Date.now() - startTime}ms`);

			// Edit metadata request
			const response = await fetch("/api/filesystem/editmetadata", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(editMetadataEntries)
			});

			if (!response.ok) {
				reject(`editmetadata api responded with status: ${response.status}`);
				return;
			}

			// Rename all nodes locally
			renamedNodes.forEach(entry => entry.node.filesystemEntry.name = entry.newName);

			resolve();
		});
	}

	// Creates a new folder on the server and then updates the local filesystem. Resolves with the new handle of the folder.
	async createNewFolderGlobally(name: string, parentHandle: string): Promise<string> {
		return new Promise<string>(async (resolve, reject: (error: string) => void) => {
			const parentNode = this.findNodeFromHandle(this.rootNode, parentHandle);

			if (!parentNode) {
				console.error(`Trying to create a folder under handle '${parentHandle}' but the node wasn't found!`);
				return;
			}

			// Create folder's metadata
			const utcTimeAsSeconds = getUTCTimeInSeconds();

			// Create encrypted file metadata
			const fileMetadata: FileMetadata = {
				fileName: name,
				dateAdded: utcTimeAsSeconds,
				isFolder: true
			};

			const encFileMetadata = encryptFileMetadata(fileMetadata, this.userLocalCryptoInfo.masterKey);

			const response = await fetch("/api/filesystem/createfolder", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					parentHandle: parentHandle,
					encryptedMetadataB64: base64js.fromByteArray(encFileMetadata)
				})
			});

			if (!response.ok) {
				reject(`createFolder api responded with status: ${response.status}`);
				return;
			}

			const json = await response.json();

			if (!json.handle) {
				reject(`server did not respond with a handle for the folder!`);
				return;
			}

			// Create new filesystem entry
			const folderEntry: FilesystemEntry = {
				handle: json.handle,
				parentHandle: parentHandle,
				name: name,
				size: 0,
				encryptedFileSize: 0,
				category: FileCategory.Folder,
				dateAdded: getUTCTimeInSeconds(),
				fileCryptKey: new Uint8Array(), // Empty array because folders don't have any encryption key
				isFolder: true,
				signature: new Uint8Array() // Folders don't have any context in them
			};

			// Append new node
			parentNode.children.push({
				handle: json.handle,
				children: [],
				filesystemEntry: folderEntry
			});

			// Resolve
			resolve(json.handle);
		});
	}

	// Note: this can return null if certain directories have not been synced from the server yet!
	findNodeFromHandle(searchNode: UserFilesystemTreeNode, handle: string): UserFilesystemTreeNode | null {
		if (searchNode.handle === handle)
			return searchNode;

		// TODO: more efficient

		for (const child of searchNode.children) {
			const foundNode = this.findNodeFromHandle(child, handle);

			if (foundNode !== null) {
				return foundNode;
			}
		}

		return null;
	}

	// Returns a copy of the filesystem entry with the given handle if found
	// Note: may return null if handle wasn't synced from the server
	getFileEntryFromHandle(handle: string): FilesystemEntry | null {
		// TODO: more efficient finding algorithm (binary search? but have to sort the filesystem entries array) or separate dictionary? (too much added complexity tho)
		//       EDIT: or use a map<>
		
		const node = this.findNodeFromHandle(this.rootNode, handle);

		if (node) {
			return cloneDeep(node.filesystemEntry);
		}

		return null;
	}

	// Returns the full path string of a given handle
	getFullPathStringFromHandle(handle: string, separator: string) {
		const nameChain: string[] = [];
		let currentHandle = handle;

		while (true) {
			const fileEntry = this.getFileEntryFromHandle(currentHandle);
			
			if (fileEntry) {
				nameChain.push(fileEntry.name);
				currentHandle = fileEntry.parentHandle;
			} else if (currentHandle == handle) {
				return ""; // Handle doesn't exist
			} else {
				break;
			}
		}

		nameChain.reverse();

		let chainText = nameChain.join(separator);

		if (chainText.length == 0) {
			return separator
		} else {
			return chainText;
		}
	}

	// Returns all the file entries under the specified handle as clones
	getFileEntriesUnderHandle(handle: string): FilesystemEntry[] {
		const node = this.findNodeFromHandle(this.rootNode, handle);

		if (node) {
			const entries: FilesystemEntry[] = [];
			node.children.forEach(entry => entries.push(cloneDeep(entry.filesystemEntry)));
			return entries;
		}

		return [];
	}

	getStorageQuota(): StorageQuota {
		return this.storageQuota;
	}

	getRootNode() {
		return this.rootNode;
	}
}

function createFileMetadataJsonString(metadata: FileMetadata): string {
	// Small keys are for saving space
	return JSON.stringify({
		fn: metadata.fileName,
		da: metadata.dateAdded,
		if: metadata.isFolder
	});
}

export type {
	StorageQuota,
	FileMetadata,
	FilesystemEntry,
	UserFilesystemTreeNode,
	UserFilesystemRenameEntry
}

export {
	FileCategory,
	UserFilesystem,
	createFileMetadataJsonString,
}
