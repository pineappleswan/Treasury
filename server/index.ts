/*

----* TREASURY ENCRYPTED FILE FORMAT (.tef) *---- (TODO: move to documentation somewhere else)

FILE HEADER:
	1. Magic (4B -> 2E 54 45 46) (.TEF)

CHUNK (1. and 2. are part of the chunk's "header")
	1. Magic (4B -> 82 7A 3D E3) (verifies the beginning of a chunk)
	2. Chunk id (4B) (big endian)
	3. Nonce (24B)
	4. Encrypted data (max ~2.147 GB)
	5. poly1305 authentication tag (16B)

DEPRECATED!!!

	2. Chunk full size (4B -> signed 32 bit integer) (big endian)
	   -> (the number of bytes from the start of the magic of one chunk to the start of the magic of the next chunk)
		 -> NOTE: is not valid for the last chunk of course... last chunk's size can be calculated as distance to end of file
	
*/

/* TODO
	1. when user is renaming a file, just wait for response from server and change file name on client
	2. client needs a theme for tailwind or something. some central theme selector
	3. for debugging purposes, allow specifying a limited transfer speed when uploading/downloading
	4. NEED WAY BETTER error handing and error checking (simplify it all somehow, 'express-async-errors' ???)
	5. intellisense documentation for functions and their arguments

	AMENDMENT: thumbnails and preview videos will probably be saved on either indexeddb or server depending on user's preference in settings

	IDEA: user browser for admin accounts (set permissions?)
	IDEA: bandwidth limiting

	IMPORTANT: THEMES!!! MUST BE DYNAMIC!!! remove bg-zinc bg-slate, literally everything, even password strength meter settings need to be in a custom theme
	IMPORTANT: make tests for server functions/routes (client and server test files)
	IMPORTANT: more colorful user interface! + color certain file icons maybe multiple colors! doesnt have to be B&W
	IMPORTANT: if user internet cuts out, dont delete their upload transfer! only when they reopen treasury! i.e NO EXPIRY!!!
	IMPORTANT: check if html injection is possible

	IMPORTANT: streamable video share link must include link to the separate m3u8 file

	run the server in some sandboxed filesystem or something

	need to have more efficient chunk buffering system

	- make a system to track server upload transfer memory usage and return overload to client (they can retry uploading chunks) but return false success
	X thumbnails shouldnt be included in metadata, just have a special pointer name of $.thumbnail->FILEHANDLE for example and the client will process it
	- strict storage quota where even the database's data is taken into account! for example the data used for storing the virtual filesystem and stuff...
	- config json file where values can be filled from the json
	- req body types
	- ensure all routes that require authentication, are authenticated
	- somehow allow server user to create new account codes without having to stop the server? admin account? maybe admin account or manual separate cli
	- test absolute path database directory to see if it works
	X program written in typescript that the user can use to interact with the server and create new accounts? (only works when server is offline) and
		only if the server config says that admin account cant create account (EDIT: solved by cli???)
	- multiple storage file path system
	- file backup system
	- on client, perform timing attack on login to check username exists
	- check if zero byte files cause problems
	- server needs activity ping command (see if users and upload/downloading) so server operator can see if server can be shut down or not
	- ability to reevalute all filesystem file file types by reading first chunk and reevaluating the type using some library (button in settings page and/or right click menu on files)
	- create text file ability in the file explorer
	- streamable video share link check if discord embed works
	- command to get server stats like the metadata size, user real filesystem storage stats (e.g count stat() on all userfiles files), and probably more stats too.

	idea: prevent session hijacking by creating an auth key on account creation that is sent to the server and stored in session and is sent with every request (something like that) something derive on login something idk maybe eddsa? Server has public key and private key is encrypted and stored on server using master key and used to verify user idk. (Check performance) (probably overthinking!)

*/

/* POSSIBLE EXPLOITS

	1. When claiming account, if two requests come to claim an access code at the same. blah blah.
	   anyways it should be fixed, please send two async requests from one client to test!
	2. User can buffer too much upload data and cause server to use up too much memory. Limit how many chunks can be out of order on the server (to match max busy chunks on client) (TODO: MUST CHECK THIS VULNERABILITY)
	3. Be wary of SQL injection attacks
	4. Be wary of handle injection attacks. e.g user requests something to do with handle "../../data.txt" !!! so must be alphanumeric! (of course magic number is verified but still)

*/

// TODO: tests file somewhere for server and client functions
// TODO: rid of success: false everywhere where status is not 200 because sending success false is redundant when the status is a fail

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

/*
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { sha256 } from "hash-wasm";

// Asymmetric encryption/decryption test
{
	const ed25519PrivateKey = ed25519.utils.randomPrivateKey();
	const ed25519PublicKey = ed25519.getPublicKey(ed25519PrivateKey);

	const message = new TextEncoder().encode("hello there!");
	const signature = ed25519.sign(message, ed25519PrivateKey);

	console.log(signature);
	console.log(ed25519.verify(signature, message, ed25519PublicKey));

	const myPrivateKey = x25519.utils.randomPrivateKey();
	const myPublicKey = x25519.getPublicKey(myPrivateKey);
	
	const theirPrivateKey = x25519.utils.randomPrivateKey();
	const theirPublicKey = x25519.getPublicKey(theirPrivateKey);
	
	console.log(`My public key: ${Buffer.from(myPublicKey).toString("hex")}`);
	console.log(`My private key: ${Buffer.from(myPrivateKey).toString("hex")}`);

	console.log(`Their public key: ${Buffer.from(theirPublicKey).toString("hex")}`);
	console.log(`Their private key: ${Buffer.from(theirPrivateKey).toString("hex")}`);

	const mySecret = x25519.getSharedSecret(myPrivateKey, theirPublicKey);
	const theirSecret = x25519.getSharedSecret(theirPrivateKey, myPublicKey);

	// Derive symmetric encryption key
	const myKey = await sha256(mySecret);
	const theirKey = await sha256(theirSecret);

	console.log(`My key: ${myKey} Len: ${myKey.length / 2}`);
	console.log(`Their key: ${theirKey} Len: ${theirKey.length / 2}`);
}
*/

import fs from "fs";
import env from "./env";
import app from "./app";
import cli from "./utility/cli";

/*
import { encodeSignedIntAsFourBytes, convertFourBytesToSignedInt } from "../src/common/commonUtils";
import { getChunkCountFromEncryptedFileSize } from "../src/common/commonUtils";
import CONSTANTS from "../src/common/constants";

console.log("Reading...");
const data = await fs.promises.readFile(`C:\\Users\\s231588\\Documents\\webprojects\\Treasury\\userfiles\\fkT7Z5RFrCXvIXqXIgF2Vxn45CzHCQ9A.tef`);

const chunkSize = convertFourBytesToSignedInt([ data[4], data[5], data[6], data[7] ]);
console.log(`Chunk size: ${chunkSize}`);

const chunkCount = getChunkCountFromEncryptedFileSize(data.byteLength);
console.log(`Chunk count: ${chunkCount}`);

let prevChunkId = -1;

for (let i = 0; i < chunkCount; i++) {
	const chunkStart = CONSTANTS.ENCRYPTED_FILE_HEADER_SIZE + (CONSTANTS.CHUNK_FULL_SIZE * i);
	const chunkHeader = new Uint8Array(data.buffer.slice(chunkStart, chunkStart + 8));
	const chunkId = convertFourBytesToSignedInt([ chunkHeader[4], chunkHeader[5], chunkHeader[6], chunkHeader[7] ]);

	console.log(data.buffer.slice(chunkStart, chunkStart + 8));

	if (chunkId - prevChunkId != 1) {
		//console.log(`WOAH WOAH WOAH!!! DIFFERENCE IS: ${chunkId - prevChunkId}`);
	}

	prevChunkId = chunkId;
}

console.log("Done.");
*/

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
app.listen(env.PORT, () => {
	console.log(`Server now listening on port ${env.PORT} using ${env.DEVELOPMENT_MODE ? "development" : "production"} mode.`);
	
	// Start the command line interface
	cli();
});
