import { FilesystemEntry } from "../userFilesystem";

/** Returns all the handles as an array of strings from the given array of filesystem entries. */
function getHandlesFromFilesystemEntryArray(fileEntries: FilesystemEntry[]): string[] {
  let handles: string[] = [];
  fileEntries.forEach(entry => handles.push(entry.handle));

  return handles;
}

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

export {
  getHandlesFromFilesystemEntryArray,
  createDragToolTipText
}
