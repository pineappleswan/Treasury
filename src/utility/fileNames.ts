import { UserFilesystem } from "../client/userFilesystem";

// TODO: much easier, but test first: name.split(".").pop()

function getFileExtensionFromName(name: string) {
  const nameParts = name.split(".");
  
  if (nameParts.length >= 2) {
    const extension = nameParts[nameParts.length - 1] as string;
    return extension.toLowerCase();
  } else {
    return "";
  }
}

function deduplicateFileEntryName(fullNameWithExtension: string, parentHandle: string, userFilesystem: UserFilesystem): string {
	const sameDirectoryFiles = userFilesystem.getFileEntriesUnderHandle(parentHandle);

	// Split the file name and extension
	const nameParts = fullNameWithExtension.split(".");
	let fileNameNoExt = "";
	let fileExtension = "";

	if (nameParts.length >= 2) {
		fileExtension = nameParts[nameParts.length - 1];
		fileNameNoExt = nameParts.slice(0, nameParts.length - 1).join(".");
	} else {
		fileNameNoExt = fullNameWithExtension;
	}
	
	// Utility function to combine the file name and extension
	const buildName = (name: string, ext: string) => {
		if (ext.length == 0) {
			return name;
		} else {
			return `${name}.${ext}`;
		}
	}

	// Create set
	const usedFileNamesSet = new Set<string>();
	sameDirectoryFiles.forEach(entry => usedFileNamesSet.add(entry.name));

	// If new file entry's name is unique, just return it's current name
	if (!usedFileNamesSet.has(fullNameWithExtension)) {
		return fullNameWithExtension;
	}
	
	// Otherwise, loop until name is unique
	let i = 1;
	while (true) {
		const newFileNameNoExt = `${fileNameNoExt} (${i})`;
		const nameAttempt = buildName(newFileNameNoExt, fileExtension);

		if (!usedFileNamesSet.has(nameAttempt)) {
			return nameAttempt;
		}

		i++;
	}
}

export {
	getFileExtensionFromName,
	deduplicateFileEntryName
}
