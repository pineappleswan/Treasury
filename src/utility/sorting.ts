import { FilesystemEntry } from "../client/userFilesystem";
import { getFileExtensionFromName } from "../utility/fileNames";

const naturalCompareString = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const sortFilesystemEntryByName = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	if (a.isFolder != b.isFolder) {
		return a.isFolder ? -1 : 1;
	}

	if (a.name == b.name) {
		return b.dateAdded - a.dateAdded;
	} else {
		if (reversed) {
			return naturalCompareString(b.name, a.name);
		} else {
			return naturalCompareString(a.name, b.name);
		}
	}
}

const sortFilesystemEntryByType = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	const extA = getFileExtensionFromName(a.name);
	const extB = getFileExtensionFromName(b.name);

	if (extA == extB) {
		return naturalCompareString(a.name, b.name);
	} else {
		if (reversed) {
			return naturalCompareString(extB, extA);
		} else {
			return naturalCompareString(extA, extB);
		}
	}
}

const sortFilesystemEntryBySize = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	if (a.size == b.size) {
		return naturalCompareString(a.name, b.name);
	} else {
		if (reversed) {
			return b.size - a.size;
		} else {
			return a.size - b.size;
		}
	}
}

const sortFilesystemEntryByDateAdded = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	if (a.dateAdded == b.dateAdded) {
		return naturalCompareString(a.name, b.name);
	} else {
		if (reversed) {
			return b.dateAdded - a.dateAdded;
		} else {
			return a.dateAdded - b.dateAdded;
		}
	}
}

export {
  naturalCompareString,
  sortFilesystemEntryByName,
  sortFilesystemEntryByType,
  sortFilesystemEntryBySize,
  sortFilesystemEntryByDateAdded
}
