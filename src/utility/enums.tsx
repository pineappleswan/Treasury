const FILESYSTEM_COLUMN_WIDTHS: any = {
	NAME: 6,
	TYPE: 2,
	SIZE: 3,
	DATE_ADDED: 4
};

const FILESYSTEM_SORT_MODES: any = {
	NAME: 0,
	TYPE: 1,
	SIZE: 2,
	DATE_ADDED: 3
};

let TRANSFER_LIST_COLUMN_WIDTHS: any = {
	NAME: 4,
	PROGRESS: 4,
	STATUS: 1.5,
	EXTRA: 1.5 // Special column with no header text
};

let UPLOAD_FILES_COLUMN_WIDTHS: any = {
	NAME: 6,
	SIZE: 3
}

enum TransferStatus {
	WAITING,
	DOWNLOADING,
	UPLOADING,
	FINISHED,
	FAILED
}

function NormaliseWidths(widths: any) {
	let divider = Object.values(widths).reduce((a: number, b: number) => a + b, 0) / 100;

	Object.keys(widths).forEach((key) => {
		widths[key] /= divider;
	});
}

// Normalise all widths so the sum of all widths is 100 (for percentage)
NormaliseWidths(FILESYSTEM_COLUMN_WIDTHS);
NormaliseWidths(TRANSFER_LIST_COLUMN_WIDTHS);
NormaliseWidths(UPLOAD_FILES_COLUMN_WIDTHS);

export {
	FILESYSTEM_COLUMN_WIDTHS,
	FILESYSTEM_SORT_MODES,
	TRANSFER_LIST_COLUMN_WIDTHS,
	TransferStatus,
	UPLOAD_FILES_COLUMN_WIDTHS
};
