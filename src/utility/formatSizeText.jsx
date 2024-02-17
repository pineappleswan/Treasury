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

export { getFormattedBytesSizeText, getFormattedBPSText };
