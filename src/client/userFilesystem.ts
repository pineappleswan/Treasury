/*

The local filesystem class is used to structure the received data from the server ... TODO: documentation

*/

import { getMasterKeyFromLocalStorage } from "./localStorage";
import { getOriginalFileSizeFromEncryptedFileSize, isHandleTheRootDirectory } from "../common/commonUtils";
import { decryptEncryptedFileCryptKey, decryptFileMetadataAsJsonObject } from "./clientCrypto";
import { getFileExtensionFromName, getFileCategoryFromExtension } from "../utility/fileTypes";
import { encryptFileCryptKey, createEncryptedFileMetadata } from "./clientCrypto";
import { cloneDeep } from "lodash";
import { randomBytes } from "@noble/ciphers/crypto";
import base64js from "base64-js";

type StorageQuota = {
	bytesUsed: number,
	totalBytes: number // The total number of bytes the user is allocated
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
	parentHandle: string,
	fileName: string,
	dateAdded: number, // UTC time in seconds
	isFolder: boolean
};

type FilesystemEntry = {
  parentHandle: string,
	handle: string,
	name: string,
	size: number, // The real file size
	encryptedFileSize: number,
	category: FileCategory,
	dateAdded: number,
	fileCryptKey: Uint8Array, // For decrypting the file
	isFolder: boolean
};

class UserFilesystem {
  private masterKey?: Uint8Array;
  private storageQuota!: StorageQuota;
  private filesystemEntries: FilesystemEntry[] = [];
  private timezoneOffsetInHours: number = 0;
  
  constructor() {
    const localMasterKey = getMasterKeyFromLocalStorage();

    if (localMasterKey == undefined) {
      console.error(`Failed to initialise LocalFilesystem class because no master key was found in the local storage!`);
      return;
    }

    this.storageQuota = { bytesUsed: 0, totalBytes: 0 };
    this.masterKey = localMasterKey;
  }

  async initialise() {
    await this.refreshStorageQuotaFromServer();
    await this.refreshDataFromServer();
  }

  async refreshStorageQuotaFromServer(): Promise<void> {
    return new Promise<void>(async (resolve, reject: (error: string) => void) => {
      const response = await fetch("/api/getstoragequota");

			if (!response.ok) {
				reject(`/api/getstoragequota responded with status ${response.status} when trying to get user storage quota from server!`);
        return;
      }

			const quotaJson = await response.json();

      if (!quotaJson.quota) {
        reject(`failed to get storage quota value from storage quota json!`);
        return;
      }

			this.storageQuota.totalBytes = quotaJson.quota;

      resolve();
    });
  }

  // Refreshes all the data in the class with new data received from the server.
  // This must be called at least once
  async refreshDataFromServer(): Promise<void> {
    return new Promise<void>(async (resolve, reject: (error: string) => void) => {
      if (!this.masterKey) {
        reject("Master key is undefined!");
        return;
      }
      
      // Get filesystem data and process it
      const response = await fetch("/api/getfilesystem");
      const json = await response.json();
      
      if (!response.ok) {
        reject(`/api/getfilesystem returned code: ${response.status} with message: ${json.message}`);
        return;
      }
      
      const rawFileEntriesData = json.data;
      
      if (!rawFileEntriesData) {
        reject(`/api/getfilesystem returned no 'data' in the json object!`);
        return;
      }
      
      // Clear
      this.storageQuota.bytesUsed = 0;
      this.filesystemEntries = [];

      // Loop through all the raw data and process them
      rawFileEntriesData.forEach((entry: any) => {
        const { handle, sizeOnServer, encryptedFileCryptKeyB64, encryptedMetadataB64 } = entry;

        if (handle == undefined || sizeOnServer == undefined || encryptedFileCryptKeyB64 == undefined || encryptedMetadataB64 == undefined) {
          reject(`missing properties in raw file entry from the json data received from the server!`);
          return;
        }

        const encryptedFileCryptKey = base64js.toByteArray(entry.encryptedFileCryptKeyB64);
        const encryptedMetadata = base64js.toByteArray(entry.encryptedMetadataB64);
        const realFileSize = getOriginalFileSizeFromEncryptedFileSize(sizeOnServer);
        
        // Decrypt file crypt key
        let fileCryptKey: Uint8Array;

        try {
          fileCryptKey = decryptEncryptedFileCryptKey(encryptedFileCryptKey, this.masterKey!);
        } catch (error) {
          reject(`Failed to decrypt encrypted file crypt key! Error: ${error}`);
          return;
        }

        // Decrypt file metadata
        let fileMetadata: FileMetadata;
  
        try {
          fileMetadata = decryptFileMetadataAsJsonObject(encryptedMetadata, this.masterKey!);
        } catch (error) {
          reject(`Metadata decrypt failed! Error: ${error}`);
          return;
        }
  
        const fileName = fileMetadata.fileName;
        const fileExtension = getFileExtensionFromName(fileName);
        const fileCategory = getFileCategoryFromExtension(fileExtension);
  
        // Append filesystem entry
        let filesystemEntry: FilesystemEntry = {
          parentHandle: fileMetadata.parentHandle,
          handle: handle,
          name: fileName,
          size: realFileSize,
          encryptedFileSize: sizeOnServer,
          category: fileCategory,
          dateAdded: fileMetadata.dateAdded,
          fileCryptKey: fileCryptKey,
          isFolder: fileMetadata.isFolder
        };
        
        this.filesystemEntries.push(filesystemEntry);
      });

      // Calculate storage used
      this.calculateStorageUsed();

      resolve();
    });
  }

  // Creates a new folder on the server and then updates the local filesystem. Resolves with the new handle of the folder.
  async createNewFolderGlobally(name: string, parentHandle: string): Promise<string> {
    return new Promise<string>(async (resolve, reject: (error: string) => void) => {
      if (!this.masterKey) {
        reject(`masterKey is undefined!`);
        return;
      }

      // Check if parent handle is valid
      const isParentHandleTheRootDirectory = isHandleTheRootDirectory(parentHandle);

      if (!isParentHandleTheRootDirectory) {
        // If not root directory, then check if parent entry exists
        const parentFileEntry = this.getFileEntryByHandle(parentHandle);

        if (!parentFileEntry) {
          reject(`parentHandle doesn't point to anything that exists!`);
          return;
        } else if (!parentFileEntry.isFolder) {
          reject(`parentHandle points to a file and not a folder!`);
          return;
        }
      }

      // Generate a random file encryption key (256 bit)
      const fileCryptKey = randomBytes(32);

      // Create folder's metadata
			const utcTimeAsSeconds: number = Math.floor(Date.now() / 1000); // Store as seconds, not milliseconds

			// Create metadata and encrypt the file crypt key
			const fileMetadata: FileMetadata = {
				parentHandle: parentHandle,
				fileName: name,
				dateAdded: utcTimeAsSeconds,
				isFolder: true
			};

			const encFileCryptKey = encryptFileCryptKey(fileCryptKey, this.masterKey!);
			const encFileMetadata = createEncryptedFileMetadata(fileMetadata, this.masterKey!);

      const response = await fetch("/api/filesystem/createFolder", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					encryptedMetadataB64: base64js.fromByteArray(encFileMetadata),
					encryptedFileCryptKeyB64: base64js.fromByteArray(encFileCryptKey)
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

      // Add new filesystem entry
      const folderEntry: FilesystemEntry = {
        parentHandle: parentHandle,
        handle: json.handle,
        name: name,
        size: 0,
        encryptedFileSize: 0,
        category: FileCategory.Folder,
        dateAdded: Math.floor(Date.now() / 1000),
        fileCryptKey: new Uint8Array(), // Empty array because folders don't have any encryption key
        isFolder: true
      };

      this.filesystemEntries.push(folderEntry);

      // Resolve
      resolve(json.handle);
    });
  }

  // Appends a filesystem entry locally and doesn't connect to the server in any way
  appendFileEntryLocally(entry: FilesystemEntry) {
    this.filesystemEntries.push(entry);
  }

  getFileEntryByHandle(handle: string): FilesystemEntry | undefined {
    // TODO: more efficient finding algorithm (binary search? but have to sort the filesystem entries array) or separate dictionary? (too much added complexity tho)
    
    this.filesystemEntries.forEach(entry => {
      if (entry.handle == handle) {
        // Make a copy
        return cloneDeep(entry);
      }
    });
    
    return;
  }

  setTimezoneOffsetInHours(hours: number) {
    this.timezoneOffsetInHours = hours;
  }

  calculateStorageUsed(): number {
    // TODO: storage quota measurement modes
    let total = 0;
    this.filesystemEntries.forEach(entry => total += entry.size);
    this.storageQuota.bytesUsed = total;

    return total;
  }

  // Returns all the file entries under the specified handle as clones with the applied timestamp
  getFileEntriesUnderHandlePath(handle: string): FilesystemEntry[] {
    const entries: FilesystemEntry[] = [];

    this.filesystemEntries.forEach(entry => {
      if (entry.parentHandle == handle) {
        const clonedEntry = cloneDeep(entry);

        // Apply a timezone offset
        clonedEntry.dateAdded += this.timezoneOffsetInHours * 3600;

        entries.push(clonedEntry);
      }
    });

    return entries;
  }

  getStorageQuota(): StorageQuota {
    return this.storageQuota;
  }
}

function createFileMetadataJsonString(metadata: FileMetadata): string {
	// Smaller keys to save space
	return JSON.stringify({
		ph: metadata.parentHandle,
		fn: metadata.fileName,
		da: metadata.dateAdded,
		if: metadata.isFolder
	});
}

export type {
  StorageQuota,
  FileMetadata,
  FilesystemEntry
}

export {
  FileCategory,
  UserFilesystem,
  createFileMetadataJsonString,
}
