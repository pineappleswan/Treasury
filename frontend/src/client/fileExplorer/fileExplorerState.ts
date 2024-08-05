import { Thumbnail } from "../thumbnails";
import { FilesystemEntry } from "../userFilesystem";

// Stores a list of functions that will communicate with an individual file entry in the file explorer
type FileEntryCommunicationData = {
  isSelected: boolean;
  isBeingCut: boolean;
  showHoverOutline: boolean;

  setThumbnail?: (thumbnail: Thumbnail) => void;
  getFileEntry?: () => FilesystemEntry;

  // This function forces the file entry to react to a change in state such as when 'isSelected' changes.
  // WARNING: It may or may not be available so use optional chaining when calling it!
  react?: () => void;
};

// Maps file entry handles to data which allows for calling functions specific to one file entry in the file explorer list
type FileExplorerCommunicationMap = Map<string, FileEntryCommunicationData>;

class FileExplorerState {
  /** Maps a file entry handle string to file entry communication data. */
  communicationMap: FileExplorerCommunicationMap;

  /** A map of all currently selected file entries. The key is the file handle. */
  selectedFileEntryMap: Map<string, FilesystemEntry>;

  /** A map of file entries that are being cut. The key is the file handle. */
  cutFileEntriesMap: Map<string, FilesystemEntry>;

  hoveredFileEntry: FilesystemEntry | null;
  touchedFileEntry: FilesystemEntry | null;

  constructor() {
    this.communicationMap = new Map<string, FileEntryCommunicationData>();
    this.selectedFileEntryMap = new Map<string, FilesystemEntry>();
    this.cutFileEntriesMap = new Map<string, FilesystemEntry>();
    this.hoveredFileEntry = null;
    this.touchedFileEntry = null;
  }

  /** Resets the state completely. */
  reset() {
    this.communicationMap.clear();
    this.selectedFileEntryMap.clear();
    this.cutFileEntriesMap.clear();
    this.hoveredFileEntry = null;
    this.touchedFileEntry = null;
  }

  /** Selects or deselects a file entry and forces it to react to the change. */
  setSelected(fileEntry: FilesystemEntry, selected: boolean) {
    const comms = this.communicationMap.get(fileEntry.handle);
  
    if (comms == undefined) {
      console.error("Tried to set file entry selection but the communication data wasn't found!");
      return;
    }
    
    if (selected) {
      this.selectedFileEntryMap.set(fileEntry.handle, fileEntry);
    } else {
      this.selectedFileEntryMap.delete(fileEntry.handle);
    }
  
    comms.isSelected = selected;
    comms.react?.();
  }

  /** Selects or deselects a file entry and forces it to react to the change. */
  setCut(fileEntry: FilesystemEntry, beingCut: boolean) {
    const comms = this.communicationMap.get(fileEntry.handle);
  
    if (!comms) {
      console.error("Tried to cut file entry but the communication data wasn't found!");
      return;
    }
    
    if (beingCut) {
      this.cutFileEntriesMap.set(fileEntry.handle, fileEntry);
    } else {
      this.cutFileEntriesMap.delete(fileEntry.handle);
    }
  
    comms.isBeingCut = beingCut;
    comms.react?.();
  }

  /**  */

  /** Uncuts all files that are being cut. */
  uncutAll() {
    this.cutFileEntriesMap.forEach(entry => {
      this.setCut(entry, false);

      // React in the gui
      const comms = this.communicationMap.get(entry.handle);
      comms?.react?.();
    });
  }
  
  /** Checks if a file entry handle is selected. */
  isSelected(handle: string) {
    return this.selectedFileEntryMap.has(handle);
  }

  /** Returns all the selected file entries' handles as an array of strings. */
  getSelectedFileEntriesHandles(): string[] {
    let handles: string[] = [];
    this.selectedFileEntryMap.forEach(entry => handles.push(entry.handle));

    return handles;
  }

  /** Returns all the cut file entries' handles as an array of strings. */
  getCutFileEntriesHandles(): string[] {
    let handles: string[] = [];
    this.cutFileEntriesMap.forEach(entry => handles.push(entry.handle));

    return handles;
  }
};

export type {
  FileEntryCommunicationData,
}

export {
  FileExplorerState
}
