import { Thumbnail } from "../thumbnails";
import { FilesystemEntry } from "../userFilesystem";

// Stores a list of functions that will communicate with an individual file entry in the file explorer
type FileEntryCommunicationData = {
  isSelected: boolean;
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
  /** Maps a file entry handle string to file entry communication data */
  communicationMap: FileExplorerCommunicationMap;

  /** A set of all currently selected file entries */
  selectedFileEntrySet: Set<FilesystemEntry>;

  hoveredFileEntry: FilesystemEntry | null;
  lastTouchedFileEntry: FilesystemEntry | null;

  constructor() {
    this.communicationMap = new Map<string, FileEntryCommunicationData>();
    this.selectedFileEntrySet = new Set<FilesystemEntry>();
    this.hoveredFileEntry = null;
    this.lastTouchedFileEntry = null;
  }

  /** Clears the communication map and selected file entry set and resets all variables. */
  reset() {
    this.communicationMap.clear();
    this.selectedFileEntrySet.clear();
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
  
  /** Checks if a file entry handle is selected. */
  isSelected(handle: string) {
    for (let entry of this.selectedFileEntrySet) {
      if (entry.handle == handle) {
        return true;
      }
    }

    return false;
  }
};

function createDragToolTipText(draggedFileEntries: FilesystemEntry[]) {
  const selectedCount = draggedFileEntries.length;
  
  if (selectedCount > 1) {
    // Determine drag tip text for multiple selections
    let fileCount = 0;
    let folderCount = 0;

    draggedFileEntries.forEach(entry => {
      if (entry.isFolder) {
        folderCount++;
      } else {
        fileCount++;
      }
    });

    const filePartText = `${fileCount} file${fileCount > 1 ? "s" : ""}`;
    const folderPartText = `${folderCount} folder${folderCount > 1 ? "s" : ""}`;

    if (folderCount == 0) {
      return filePartText;
    } else if (fileCount == 0) {
      return folderPartText;
    } else {
      return `${filePartText} and ${folderPartText}`;
    }
  } else if (selectedCount == 1) {
    return draggedFileEntries[0].name;
  }

  // Never show this to the user. This is only here for development purposes.
  return "No files being dragged.";
}

export type {
  FileEntryCommunicationData,
}

export {
  FileExplorerState,
  createDragToolTipText
}
