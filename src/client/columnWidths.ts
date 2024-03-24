// TODO: rename this file as it seems to only serve one purpose for column widths and stuff

const FILESYSTEM_COLUMN_WIDTHS: { [key: string]: number } = {
	NAME: 6,
	TYPE: 2.5,
	DATE_ADDED: 4,
	SIZE: 3.5
};

let TRANSFER_LIST_COLUMN_WIDTHS: { [key: string]: number } = {
	NAME: 4,
	PROGRESS: 4,
	STATUS: 1.5,
	EXTRA: 1.5 // Special column with no header text for spacing only
};

let UPLOAD_FILES_COLUMN_WIDTHS: { [key: string]: number } = {
	NAME: 6,
	SIZE: 3
}

function NormaliseWidths(widths: { [key: string]: number }) {
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
	TRANSFER_LIST_COLUMN_WIDTHS,
	UPLOAD_FILES_COLUMN_WIDTHS
};
