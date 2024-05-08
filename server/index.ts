/*

----* TREASURY ENCRYPTED FILE FORMAT (.tef) *---- (TODO: move to documentation somewhere else, like probably markdown or make some image diagram)

FILE HEADER:
	1. Magic (4B -> 2E 54 45 46) (.TEF)

CHUNK:
	1. Magic (4B -> 43 48 4E 4B) (CHNK)
	2. Nonce (24B)
	3. Encrypted chunk data (max ~2.147 GB)
	    a. Chunk id (4B -> big endian)
			b. Chunk data
	4. poly1305 authentication tag (16B)
	
*/

import fs from "fs";
import env from "./env";
import app from "./app";
import cli from "./utility/cli";

// Initialise directories specified in env
if (!fs.existsSync(env.USER_FILE_STORAGE_PATH)) {
	console.log("Creating user file storage path since none was found.");
	fs.mkdirSync(env.USER_FILE_STORAGE_PATH, { recursive: true });
}

if (!fs.existsSync(env.USER_UPLOAD_TEMPORARY_STORAGE_PATH)) {
	console.log("Creating uploads storage path since none was found.");
	fs.mkdirSync(env.USER_UPLOAD_TEMPORARY_STORAGE_PATH, { recursive: true });
}

// Start server
app.listen(env.PORT, () => {
	console.log(`Server now listening on port ${env.PORT} using ${env.DEVELOPMENT_MODE ? "development" : "production"} mode.`);
	
	// Start the command line interface
	cli();
});
