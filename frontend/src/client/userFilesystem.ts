import { UserLocalCryptoInfo, getLocalStorageUserCryptoInfo } from "./localStorage";
import { getEncryptedFileSize, getUTCTimeInSeconds } from "../utility/commonUtils";
import { decryptBuffer, decryptEncryptedFileMetadata } from "./crypto";
import { getFileCategoryFromExtension } from "./fileTypes";
import { getFileExtensionFromName } from "../utility/fileNames";
import { encryptFileMetadata } from "./crypto";
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

function doesFileNameContainBannedCharacters(fileName: string): boolean {
  // TODO:

  return false;
}

/**
 * Serialises a FileMetadata object into a string.
 * @param metadata - The file metadata to serialise.
 * @returns The serialised string.
 */
function serialiseFileMetadata(metadata: FileMetadata): string {
  return `${metadata.fileName}|${metadata.dateAdded}|${metadata.isFolder ? "1" : "0"}`
}

/**
 * **WARNING:** May throw an error if the input data is invalid.
 * 
 * Parses the serialised string returned by `serialiseFileMetadata()`
 * @param data - The serialised string.
 * @returns {FileMetadata} - The parsed
 */
function deserialiseFileMetadata(data: string): FileMetadata {
  let parts = data.split("|");

  if (parts.length != 3)
    throw new Error("Expected serialised string to have three parts!");

  if (isNaN(parseInt(parts[1])))
    throw new Error(`dateAdded part of string couldn't be parsed as an integer! Value: ${parts[1]}`);

  if (parts[2] != "1" && parts[2] != "0")
    throw new Error(`isFolder part of string must be 1 or 0. Got: ${parts[2]}`);

  return {
    fileName: parts[0],
    dateAdded: parseInt(parts[1]),
    isFolder: parts[2] == "1" ? true : false
  };
}

function convertGetItemJsonToFilesystemEntry(json: any, masterKey: Uint8Array): FilesystemEntry {
  if (!json.handle || !json.parentHandle || json.size == undefined || !json.encryptedFileCryptKey == undefined || !json.encryptedMetadata)
    throw new Error(`Missing properties in the json`);

  const handle = json.handle;
  const parentHandle = json.parentHandle;
  const size = json.size;
  const encryptedFileCryptKey = base64js.toByteArray(json.encryptedFileCryptKey);
  const encryptedMetadata = base64js.toByteArray(json.encryptedMetadata);

  // Decrypt file metadata
  const fileMetadata: FileMetadata = decryptEncryptedFileMetadata(encryptedMetadata, masterKey);
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
    fileCryptKey = decryptBuffer(encryptedFileCryptKey, masterKey);
  }

  return {
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
}

// TODO: make it a singleton
// TODO: include map where key is the file handle and value is the corresponding tree node! makes it faster to search for file entries by handle

/**
 * This class handles storing the metadata of files in a user's virtual cloud filesystem. 
 * It's responsible for syncing files from the server to the client and replicating any changes 
 * made by the client locally to the server like deleting files, moving files, creating new folders
 * and more.
 * @class
 */
class UserFilesystem {
  private userLocalCryptoInfo: UserLocalCryptoInfo;
  private storageQuota: StorageQuota;
  private rootNode: UserFilesystemTreeNode;

  /**
   * Maps a parent handle to an array of new filesystem entries which need to be added to the 
   * corresponding parent node.
   */ 
  // private fileAddChanges: Map<string, FilesystemEntry[]>;

  /**
   * Maps a parent handle to an array of file handles which need to be removed from the 
   * corresponding parent node.
   */ 
  // private fileRemoveChanges: Map<string, string[]>;

  constructor() {
    this.storageQuota = { bytesUsed: 0, totalBytes: 0 };
    this.userLocalCryptoInfo = getLocalStorageUserCryptoInfo()!;
    // this.fileAddChanges = new Map<string, FilesystemEntry[]>();
    // this.fileRemoveChanges = new Map<string, string[]>();

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
    await this.syncStorageUsageFromServer();
    // await this.syncFiles(CONSTANTS.ROOT_DIRECTORY_HANDLE); // TODO: idk why this was here, maybe it was to fix the loading... problem? redundant tho
  }

  /**
   * Queues a filesystem entry for addition to a parent node once that parent node has been synced.
   */
  /*
  addNewFileChange(parentHandle: string, entry: FilesystemEntry) {
    let queue = this.fileAddChanges.get(entry.parentHandle);
    
    // If queue doesn't exist, then create it
    if (queue === undefined) {
      this.fileAddChanges.set(entry.parentHandle, []);
      queue = this.fileAddChanges.get(entry.parentHandle);
    }

    queue!.push(entry);
  }
  */

  // TODO: addRemoveFileChange(handle: string)

  /**
   * Sets the storage quota of the user from the server.
   */
  setStorageQuota(storageQuota: number) {
    this.storageQuota.totalBytes = storageQuota;
  }

  /**
   * Updates the bytes used value in the storage quota.
   */
  updateStorageUsed(used: number) {
    this.storageQuota.bytesUsed = used;
  }

  /**
   * Syncs the storage usage of the user from the server.
   */
  async syncStorageUsageFromServer(): Promise<void> {
    return new Promise<void>(async (resolve, reject: (error: string) => void) => {
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

      this.storageQuota.bytesUsed = usedJson.bytesUsed;

      resolve();
    });
  }

  /**
   * Downloads the metadata of a file given its handle and stores the data locally in the class.
   * After this operation, the file explorer on the frontend should be updated to reflect the change.
   * @param {string} handle - The handle of the file.
   */
  async syncFile(handle: string): Promise<void> {
    return new Promise<void>(async (resolve, reject: (error: string) => void) => {
      // Get filesystem data and process it
      const url = `/api/filesystem/items/${handle}`;
      const response = await fetch(url);
      const json = await response.json();
      
      if (!response.ok) {
        reject(`${url} returned code: ${response.status}`);
        return;
      }

      // Create filesystem entry from received json
      const entry = convertGetItemJsonToFilesystemEntry(json, this.userLocalCryptoInfo.masterKey);

      // If the parent node of the requested file doesn't exist, then don't sync and just ignore it 
      // because when a node is synced from the server, the latest files are going to be retrived.
      const parentNode = this.findNodeFromHandle(this.rootNode, entry.parentHandle);

      if (parentNode === null) {
        resolve();
        return;
      }

      // Replace existing child that matches the same handle if found, otherwise just add it as a new file.
      let childIndex = parentNode.children.findIndex(node => node.handle == handle);

      if (childIndex >= 0) {
        parentNode.children[childIndex].filesystemEntry = entry;
      } else {
        parentNode.children.push({
          handle: handle,
          children: [],
          filesystemEntry: entry
        });
      }

      resolve();
    });
  }

  /**
   * Downloads the metadata of all files under a specified parent handle and stores the data locally.
   * If the node has already been previously synced, it will just be overwritten with the new values.
   * After this operation, the file explorer on the frontend should be updated to reflect the change.
   * @param {string} parentHandle - The parent handle to get the children of.
   */
  async syncFiles(parentHandle: string): Promise<void> {
    return new Promise<void>(async (resolve, reject: (error: string) => void) => {
      // Get filesystem data and process it
      const url = `/api/filesystem/items?parentHandle=${parentHandle}`
      const response = await fetch(url);
      
      if (!response.ok) {
        reject(`${url} returned code: ${response.status}`);
        return;
      }
      
      // Extract json containing array of file metadata
      const json = await response.json();
      
      // Ensure json contains the items array
      if (!json.items) {
        reject(`${url} returned no 'items' in the json object!`);
        return;
      }
      
      // Reset existing parent node
      const parentNode = this.findNodeFromHandle(this.rootNode, parentHandle);
      
      if (!parentNode) {
        reject(`No parent node found with parent handle of: ${parentHandle}`);
        return;
      }
      
      parentNode.children = [];

      // Loop through all the raw data and process them
      json.items.forEach((json: any) => {
        try {
          // Create filesystem entry from received json
          const entry = convertGetItemJsonToFilesystemEntry(json, this.userLocalCryptoInfo.masterKey);

          // Append new node
          parentNode.children.push({
            handle: entry.handle,
            children: [],
            filesystemEntry: entry
          });
        } catch (error) {
          console.error(`Failed to convert get item json in syncFiles(). Error: ${error}`);
        }
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

      // Increment storage used
      // this.storageQuota.bytesUsed += fileEntry.size;

      return true;
    } else {
      // TODO: if no parent node is found, then buffer internally in a Map<string[]> and when any handle is synced or loaded,
      // then read the string array and add handles if they weren't synced already
      console.error(`Couldn't add new file entry to local user filesystem because parent node wasn't found with handle: ${parentHandle}`);
    }

    return false;
  }

  // TODO: needs optimising!!!

  /**
   * Renames one or more files and replicates these changes to the server.
   * @param entries An array of rename entries which provides information about what files to rename.
   */
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
      // renamedNodes.forEach(entry => entry.node.filesystemEntry.name = entry.newName);

      resolve();
    });
  }

  /**
   * Creates a new folder on the server and then updates the local filesystem. Resolves with the new handle of the folder.
   */
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
        headers: { "Content-Type": "application/json" },
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

  /**
   * Searches for a node in the class by the handle. If the file exists in the user's filesystem on 
   * the server but it was not synced and replicated to the client, then it will return null.
   * @param {UserFilesystemTreeNode} searchNode - The node to start searching from.
   * @param {string} handle - The handle of the node to search for.
   */
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

  /**
   * Searches for a node in the class by the handle and returns a deep copy of the filesystem entry 
   * inside the node. If the file exists in the user's filesystem on the server but it was not 
   * synced and replicated to the client, then it will return null.
   * @param handle - The handle of the file entry.
   */
  getFileEntryFromHandle(handle: string): FilesystemEntry | null {
    // TODO: more efficient finding algorithm (binary search? but have to sort the filesystem entries array) or separate dictionary? (too much added complexity tho)
    //       EDIT: or use a map<>
    
    const node = this.findNodeFromHandle(this.rootNode, handle);

    if (node) {
      return cloneDeep(node.filesystemEntry);
    }

    return null;
  }

  /**
   * Returns the full path string of the file entry with the matching handle.
   * @param {string} handle - The handle of the file.
   * @param {string} separator - The string to separate each directory's name with.
   */
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
  serialiseFileMetadata,
  deserialiseFileMetadata
}
