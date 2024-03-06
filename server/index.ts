/* TODO
	1. when user is renaming a file, just wait for response from server and change file name on client
	2. client needs a theme for tailwind or something. some central theme selector
	3. for debugging purposes, allow specifying a limited transfer speed when uploading/downloading
	4. NEED WAY BETTER error handing and error checking (simplify it all somehow, 'express-async-errors' ???)
	5. intellisense documentation for functions and their arguments

	AMENDMENT: thumbnails and preview videos will probably be saved on either indexeddb or server depending on user's preference in settings

	IDEA: user browser for admin accounts (set permissions?)

	IMPORTANT: make tests for server functions/routes (client and server test files)
	
	- make a system to track server upload transfer memory usage and return overload to client (they can retry uploading chunks) but return false success
	- thumbnails shouldnt be included in metadata, just have a special pointer name of $.thumbnail->FILEHANDLE for example and the client will process it
	- strict storage quota where even the database's data is taken into account! for example the data used for storing the virtual filesystem and stuff...
	- config json file where values can be filled from the json
	- req body types
	- ensure all routes that require authentication, are authenticated
	- somehow allow server user to create new account codes without having to stop the server? admin account? maybe admin account or manual separate cli
	- test absolute path database directory to see if it works
		program written in typescript that the user can use to interact with the server and create new accounts? (only works when server is offline) and
		only if the server config says that admin account cant create account
	- multiple storage file path system
	- file backup system
	- on client, perform timing attack on login to check username exists
	- check if zero byte files cause problems
	- server needs activity ping command (see if users and upload/downloading) so server operator can see if server can be shut down or not

*/

/* POSSIBLE EXPLOITS

	1. When claiming account, if two requests come to claim an access code at the same. blah blah.
	   anyways it should be fixed, please send two async requests from one client to test!
	2. User can buffer too much upload data and cause server to use up too much memory. Limit how many chunks can be out of order on the server (to match max busy chunks on client) (TODO: MUST CHECK THIS VULNERABILITY)
	3. Be wary of SQL injection attacks

*/

// TODO: tests file somewhere for server and client functions

/*
// TESTS
const randomBytesBuffer = randomBytes(10000);

{
	const a = uint8ArrayToHexString(randomBytesBuffer);
	const b = hexStringToUint8Array(a);
	let isFine = true;

	for (let i = 0; i < a.length; i++) {
		if (randomBytesBuffer[i] != b[i]) {
			console.log(`Issue at ${i} - o: ${randomBytesBuffer[i]} r: ${b[i]}`);
			isFine = false;
		}
	}

	console.log(`Is fine: ${isFine}`);
}
*/

import fs from "fs";
import env from "./env";
import app from "./app";
import cli from "./utility/cli";

// Initialise directories specified in env (note: the database file path is created in the TreasuryDatabase class)
if (!fs.existsSync(env.USER_FILE_STORAGE_PATH)) {
	console.log("Creating user file storage path since none was found.");
	fs.mkdirSync(env.USER_FILE_STORAGE_PATH, { recursive: true });
}

if (!fs.existsSync(env.USER_UPLOAD_TEMPORARY_STORAGE_PATH)) {
	console.log("Creating uploads storage path since none was found.");
	fs.mkdirSync(env.USER_UPLOAD_TEMPORARY_STORAGE_PATH, { recursive: true });
}

// Start server
app.listen(process.env.PORT, () => {
	console.log(`Server now listening on port ${process.env.PORT} using ${env.DEVELOPMENT_MODE ? "development" : "production"} mode.`);
	
	// Start the command line interface
	cli();
});
