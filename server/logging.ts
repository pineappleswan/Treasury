// TODO: log output file + more fine grained commands, like does LogMessage log to output?
// maybe just replace all LogMessage in index.ts to console.log or console.error for LogError
console.log("Logging started."); // TEST

function LogMessage(message: any) {
	console.log(` > ${message}`);
}

function LogError(message: any) {
	console.log(`ERROR: ${message}`);
}

export {
	LogMessage,
	LogError
}
