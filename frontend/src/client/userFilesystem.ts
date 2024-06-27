import { UserLocalCryptoInfo, getLocalStorageUserCryptoInfo } from "./localStorage";
import { getEncryptedFileSize, getUTCTimeInSeconds } from "../utility/commonUtils";
import { decryptBuffer, decryptEncryptedFileMetadata } from "./clientCrypto";
import { getFileCategoryFromExtension } from "./fileTypes";
import { getFileExtensionFromName } from "../utility/fileNames";
import { encryptFileMetadata } from "./clientCrypto";
import cloneDeep from "clone-deep";
import base64js from "base64-js";
import CONSTANTS from "./constants";

type StorageQuota = {
  bytesUsed: number;
  totalBytes: number; // The total number of bytes the user is allocated
};

type EditMetadataEntry = {
  handle: string,
  encryptedMetadata: string
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

/**
 * This class handles all the client side interaction to a user's virtual cloud filesystem. 
 * It's responsible for syncing files from the server to the client and replicating any changes 
 * made by the client locally to the server.
 * @class
 */
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
        isFolder: true
      }
    };
  }

  /**
   * Initialises the class by syncing the storage quota and the root directory's files from the server.
   */
  async initialise() {
    await this.syncStorageQuotaFromServer();
    // await this.syncFiles(CONSTANTS.ROOT_DIRECTORY_HANDLE); // TODO: idk why this was here, maybe it was to fix the loading... problem? redundant tho
  }

  /**
   * Syncs the storage quota of the user from the server.
   */
  async syncStorageQuotaFromServer(): Promise<void> {
    return new Promise<void>(async (resolve, reject: (error: string) => void) => {
      // Get session info
      const sessionInfo = await fetch("/api/sessiondata");

      if (!sessionInfo.ok) {
        throw new Error(`/api/sessiondata responded with status ${sessionInfo.status}`);
      }

      const sessionInfoJson = await sessionInfo.json();

      if (sessionInfoJson.storageQuota == undefined) {
        reject(`Failed to get storage quota value from session info json!`);
        return;
      }

      // Get storage used
      const response = await fetch("/api/filesystem/usage");

      if (!response.ok) {
        reject(`/api/filesystem/usage responded with status ${response.status}!`);
        return;
      }

      const usedJson = await response.json();

      if (usedJson.bytesUsed == undefined) {
        reject(`Failed to get storage used value from storage used json!`);
        return;
      }

      this.storageQuota.totalBytes = sessionInfoJson.storageQuota;
      this.storageQuota.bytesUsed = usedJson.bytesUsed;

      resolve();
    });
  }

  /**
   * Downloads the metadata of all files under a specified parent handle and caches the data locally
   * @param {string} parentHandle - The parent handle to get the children of.
   */
  async syncFiles(parentHandle: string): Promise<void> {
    return new Promise<void>(async (resolve, reject: (error: string) => void) => {
      // Get filesystem data and process it
      const response = await fetch(`/api/filesystem/items?parentHandle=${parentHandle}`);
      const json = await response.json();
      
      if (!response.ok) {
        reject(`/api/filesystem/items returned code: ${response.status}`);
        return;
      }
      
      const rawFileEntries = json.items;
      
      if (!rawFileEntries) {
        reject(`/api/filesystem/items returned no 'items' in the json object!`);
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
      rawFileEntries.forEach((entry: any) => {
        if (entry.handle == undefined || entry.size == undefined || entry.encryptedFileCryptKey == undefined || entry.encryptedMetadata == undefined) {
          reject(`missing properties in raw file entry from the json data received from the server!`);
          return;
        }

        const handle = entry.handle;
        const size = entry.size;
        const encryptedFileCryptKey = base64js.toByteArray(entry.encryptedFileCryptKey);
        const encryptedMetadata = base64js.toByteArray(entry.encryptedMetadata);

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
          isFolder: isFolder
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

  /**
   * Adds a new filesystem entry to the filesystem without replicating the change to the server.
   * @param {FilesystemEntry} fileEntry - The filesystem entry to add.
   * @param {string} parentHandle - The parent handle of the new filesystem entry.
   * @returns {boolean} True if operation was successful; false otherwise.
   */
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
          encryptedMetadata: base64js.fromByteArray(newEncryptedMetadata)
        });

        renamedNodes.push({
          node: fileNode,
          newName: renameEntry.newName
        });
      };

      console.log(`Created rename data in ${Date.now() - startTime}ms`);

      // Edit metadata request
      const response = await fetch("/api/filesystem/metadata", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(editMetadataEntries)
      });

      if (!response.ok) {
        reject(`editfilemetadata api responded with status: ${response.status}`);
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

      const response = await fetch("/api/filesystem/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          parentHandle: parentHandle,
          encryptedMetadata: base64js.fromByteArray(encFileMetadata)
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
        isFolder: true
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
