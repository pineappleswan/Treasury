import { Thumbnail } from "../thumbnails";
import { FilesystemEntry } from "../userFilesystem";

// Stores a list of functions that will communicate with an individual file entry in the file explorer
type FileEntryCommunicationData = {
  isSelected: boolean;
  setThumbnail?: (thumbnail: Thumbnail) => void;
  getFileEntry?: () => FilesystemEntry;

  // This function forces the file entry to react to a change in state such as when 'isSelected' changes.
  // WARNING: It may or may not be available so use optional chaining when calling it!
  react?: () => void;
};

// Maps file entry handles to data which allows for calling functions specific to one file entry in the file explorer list
type FileExplorerCommunicationMap = Map<string, FileEntryCommunicationData>;

class FileExplorerState {
  communicationMap: FileExplorerCommunicationMap;
  selectedFileEntrySet: Set<FilesystemEntry>;
  hoveredFileEntry: FilesystemEntry | null;
  lastTouchedFileEntry: FilesystemEntry | null;

  constructor() {
    this.communicationMap = new Map<string, FileEntryCommunicationData>();
    this.selectedFileEntrySet = new Set<FilesystemEntry>();
    this.hoveredFileEntry = null;
    this.lastTouchedFileEntry = null;
  }

  /** Selects or deselects a file entry and forces it to react to the change. */
  setSelected(fileEntry: FilesystemEntry, selected: boolean) {
    const comms = this.communicationMap.get(fileEntry.handle);
  
    if (comms == undefined) {
      console.error("Tried to set file entry selection but the communication data wasn't found!");
      return;
    }
    
    if (selected) {
      this.selectedFileEntrySet.add(fileEntry);
    } else {
      this.selectedFileEntrySet.delete(fileEntry);
    }
  
    comms.isSelected = selected;
    comms.react?.();
  }
};

export type {
  FileEntryCommunicationData,
}

export {
  FileExplorerState
}
