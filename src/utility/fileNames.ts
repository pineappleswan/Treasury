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

// If parentHandle is null, then the duplicate counter (e.g. image.png (4)) will
// remain at: (optionalCounterOffset || 0) + 1
function deduplicateFileEntryName(
	fullNameWithExtension: string,
	parentHandle: string | null,
	userFilesystem: UserFilesystem,

	// When a name is deduplicated, this number is added to the counter.
	// e.g image.png (1) becomes image.png (4) if 3 was provided.
	optionalCounterOffset?: number
): string {
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

	// Automatically determine the duplicate counter is parentHandle is not null
	if (parentHandle !== null) {
		const sameDirectoryFiles = userFilesystem.getFileEntriesUnderHandle(parentHandle);
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
	} else {
		// If no parentHandle was provided, then always add duplicate counter starting from 1
		// and optionally at the provided offset
		const counter = (optionalCounterOffset || 0) + 1;
		const newFileNameNoExt = `${fileNameNoExt} (${counter})`;
		return buildName(newFileNameNoExt, fileExtension);
	}
}

export {
	getFileExtensionFromName,
	deduplicateFileEntryName
}
