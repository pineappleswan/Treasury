// Returns the formatted text for a number representing a number of bytes. e.g 1,000,000 = 1 MB
function getFormattedBytesSizeText(byteCount) {
  if (byteCount == undefined)
    throw new TypeError("byteCount is undefined!");

	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let unitIndex = 0;
  
	while (byteCount >= 1000 && unitIndex < units.length - 1) {
		byteCount /= 1000;
		unitIndex++;
	}

	return byteCount.toFixed(1) + " " + units[unitIndex];
}

// Returns the formatted text for a number representing transfer speed in bytes/second. e.g 1,000,000 = "1 MB/s"
function getFormattedBPSText(bps) {
  if (bps == undefined)
    throw new TypeError("bps is undefined!");

	const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s", "PB/s"];
	let unitIndex = 0;

	while (bps >= 1000 && unitIndex < units.length - 1) {
		bps /= 1000;
		unitIndex++;
	}

	return bps.toFixed(1) + " " + units[unitIndex];
}

// Returns a formatted timestamp using a unix timestamp given in seconds for the date added text in file lists
// You can specify an american format of date where the month comes before the day
function getDateAddedTextFromUnixTimestamp(seconds, isAmericanFormat) {
	if (seconds == undefined)
		throw new TypeError("seconds is undefined!");

	if (isAmericanFormat == undefined)
		throw new TypeError("isAmericanFormat is undefined!");

	let date = new Date(seconds * 1000);
	let hours = date.getHours();
	let minutes = date.getMinutes();
	let day = date.getDate();
	let month = date.getMonth() + 1; // January starts from zero, so we add 1
	let year = date.getFullYear();

	let amOrPmText = (hours >= 12 ? "PM" : "AM");
	let hours12 = hours % 12;
	hours12 = (hours12 == 0 ? 12 : hours12); // hour 0 is always 12

	// Pad some numbers (e.g 7:6 pm = 7:06pm)
	minutes = minutes.toString().padStart(2, "0");

	if (isAmericanFormat) {
		return `${hours12}:${minutes} ${amOrPmText} ${month}/${day}/${year}`;
	} else {
		return `${hours12}:${minutes} ${amOrPmText} ${day}/${month}/${year}`;
	}
}

export { getFormattedBytesSizeText, getFormattedBPSText, getDateAddedTextFromUnixTimestamp };
