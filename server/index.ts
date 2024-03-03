import express from "express";
import cors from "cors";
import compression from "compression";
import fs from "fs";
import url from "node:url";
import path from "path";
import session from "express-session";
import bodyParser from "body-parser";
import { argon2id, argon2Verify, blake3 } from "hash-wasm";
import MemoryStoreLib from "memorystore"; // TODO: talk about why this is used
import rateLimit from "express-rate-limit";
import minimist from "minimist";
import multer from "multer";
import { Mutex } from "async-mutex";
import readline from "readline";
import { LogMessage, LogError } from "./logging";
import { ClaimUserInfo, TreasuryDatabase, TreasuryDatabaseInfo, UnclaimedUserInfo, UserInfo } from "./database";
// import { ed25519, x25519 } from "@noble/curves/ed25519"
import { UploadTransferEntry, UploadTransferEntryDictionary } from "./transfers";
import { GenerateSecureRandomBytesAsHexString, GenerateSecureRandomAlphaNumericString } from "./serverCrypto";

import {
	logUserIn,
	logUserOut,
	getLoggedInUsername,
	isUserLoggedIn,
	ifUserLoggedInRedirectToTreasury,
	ifUserLoggedOutRedirectToLogin,
	ifUserLoggedOutSendForbidden
} from "./authentication";

import {
	PASSWORD_HASH_SETTINGS,
	ENCRYPTED_CHUNK_FULL_SIZE,
	ENCRYPTED_FILE_MAGIC_NUMBER,
	MAX_TRANSFER_BUSY_CHUNKS,
	encodeSignedIntAsFourBytes,
	containsOnlyAlphaNumericCharacters,
} from "../src/common/commonCrypto";

type ServerConfig = {
	USER_DATABASE_SETTINGS: {
		PARENT_DIRECTORY: string,
		FILE_NAME: string
	},
	USER_FILESYSTEM_SETTINGS: {
		PARENT_DIRECTORY: string,
		UPLOAD_DIRECTORY: string // The directory where uploaded files will go to
	},
	IS_DEV_MODE: boolean,
	SERVER_PORT: number,
	SERVER_SECRET: string,
	SESSION_SECRET: string,
	MIN_USERNAME_LENGTH: number,
	MAX_USERNAME_LENGTH: number,
	MAX_PASSWORD_LENGTH: number,
	USER_DATA_SALT_LENGTH: number,
	BUFFERED_CHUNK_WRITE_RETRY_TIMEOUT_MS: number,
	BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS: number,
	CLAIM_ACCOUNT_CODE_LENGTH: number,
	FILE_HANDLE_LENGTH: number
};

const CONFIG: ServerConfig = {
	USER_DATABASE_SETTINGS: {
		// The directory where the user database will be stored (add a dot before the path if it's relative. e.g ./databases)
		PARENT_DIRECTORY: "./databases",
		FILE_NAME: "userdata.db"
	},
	USER_FILESYSTEM_SETTINGS: {
		// IMPORTANT: the master directory where all of the users' encrypted files will be stored
		PARENT_DIRECTORY: "/userfiles",
		UPLOAD_DIRECTORY: "./uploads"
	},
	MIN_USERNAME_LENGTH: 3,
	MAX_USERNAME_LENGTH: 20,
	MAX_PASSWORD_LENGTH: 200,
	CLAIM_ACCOUNT_CODE_LENGTH: 20,
	FILE_HANDLE_LENGTH: 32, // 62 ^ 32 unique handles possible
	SESSION_SECRET: GenerateSecureRandomBytesAsHexString(64), // Random session secret because server shouldnt' restart often
	USER_DATA_SALT_LENGTH: 32, // The length of the salts for the user's passwords and master key in bytes (DO NOT CHANGE THIS VALUE)
	BUFFERED_CHUNK_WRITE_RETRY_TIMEOUT_MS: 60 * 1000, // When chunks are being buffered during upload, limit the time spent buffering...
	BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS: 50, // Retry every ... ms
	SERVER_SECRET: "mysecret", // MUST be a fixed value for security reasons TODO: explain in some document why this needs to be fixed (user fake salt return reason)
	
	// These are just default values that are filled in later
	IS_DEV_MODE: false,
	SERVER_PORT: 3001
};

const __dirname = path.dirname(path.dirname(url.fileURLToPath(import.meta.url))); // path.dirname twice to get to root directory of project
let argv = minimist(process.argv.slice(2));

// Fill config with command line arguments
CONFIG.IS_DEV_MODE = process.argv.includes("--dev");
CONFIG.SERVER_PORT = argv["port"];

// Server program initialisation (TODO: separate index.ts from server.ts)

// Sanity checks (if failed, an error message will be printed and the program will pause indefinitely)
async function BlockProgramExecution() {
	await new Promise(resolve => setTimeout(resolve, 1000000000));
}

if (CONFIG.SERVER_PORT == undefined) {
	LogError("You did not specify the port to use for the server. Please indicate using the --port argument when running the server.");
	await BlockProgramExecution();
}

// Initialise database
let database: TreasuryDatabase;

{
	let databaseDirectory = CONFIG.USER_DATABASE_SETTINGS.PARENT_DIRECTORY
	let databaseFilePath = path.join(databaseDirectory, CONFIG.USER_DATABASE_SETTINGS.FILE_NAME);

	const databaseInfo: TreasuryDatabaseInfo = {
		databaseFilePath: databaseFilePath
	};

	database = new TreasuryDatabase(databaseInfo);
}

/* TODO
	1. when user is renaming a file, just wait for response from server and change file name on client
	2. client needs a theme for tailwind or something. some central theme selector
	3. for debugging purposes, allow specifying a limited transfer speed when uploading/downloading
	4. NEED WAY BETTER error handing and error checking (simplify it all somehow, 'express-async-errors' ???)
	5. intellisense documentation for functions and their arguments

	IDEA: user browser for admin accounts (set permissions?)
	
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

// Create app
const app = express();
const MemoryStore = MemoryStoreLib(session);
const multerUpload = multer();

// Middleware
app.use(compression());
app.use(express.static("./dist"));
app.use(express.raw({ type: "application/octet-stream", limit: "10mb" })); // Allow binary data
app.use(bodyParser.json({ limit: "10mb" })); // Parse 'application/json' + set json data limit
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

app.use(session({
	/*
		SESSION COOKIE FORMAT (TODO: types please)

		{
			username: string,
			loggedIn: boolean
		}
	*/
	store: new MemoryStore({
		checkPeriod: 1 * 3600 * 1000 // Prune expired entries every 1 hour
	}),
	name: "TREASURY_SESSION",
	secret: CONFIG.SESSION_SECRET,
	resave: false,
	saveUninitialized: true,
	cookie: {
		sameSite: "lax",
		// secure: !CONFIG.IS_DEV_MODE, // Only use secure mode in production mode TODO: only uncomment when website is done
		httpOnly: true
	}
}));

// TODO!!!
type UserSession = {
	username: string,
	loggedIn: boolean
};

// Create rate limiters
const loginRateLimiter = rateLimit({
	windowMs: 30 * 1000, // Rate limit window of 30 seconds
	limit: 10, // 10 requests per window period
});

// API

/* TODO: DEPRECATED
app.get("/api/getpasswordhashsettings", async (req, res) => {
	res.json({
		parallelism: CONFIG.PASSWORD_HASH_SETTINGS.PARALLELISM,
		iterations: CONFIG.PASSWORD_HASH_SETTINGS.ITERATIONS,
		memorySize: CONFIG.PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
		hashLength: CONFIG.PASSWORD_HASH_SETTINGS.HASH_LENGTH,
		saltLength: CONFIG.USER_DATA_SALT_LENGTH
	});
});
*/

app.get("/api/username", async (req: any, res) => {
	if (isUserLoggedIn(req)) {
		res.send(req.session.username);
	} else {
		res.send("NOT LOGGED IN");
	}
});

// Uses same rate limiter as login
app.post("/api/claimaccount", loginRateLimiter, async (req, res) => {
	const { claimCode, username, password } = req.body;

	// Type checking ()
	// 1. claimCode cannot be undefined
	// 2. username and password can be undefined, but if not, it must be a string
	if (typeof(claimCode) != "string") {
		res.json({ success: false, message: "Bad request!" });
		return;
	}

	if (username && typeof(username) != "string") {
		res.json({ success: false, message: "Bad request!" });
		return;
	}

	if (password && typeof(password) != "string") {
		res.json({ success: false, message: "Bad request!" });
		return;
	}

	// Length checks
	if (claimCode.length != CONFIG.CLAIM_ACCOUNT_CODE_LENGTH) {
		res.json({ success: false, message: "Invalid code!" });
		return;
	}

	if (username) {
		// Username must be alphanumeric only
		if (!containsOnlyAlphaNumericCharacters(username)) {
			res.json({success: false, message: "Username must be alphanumeric!" });
			return;
		}

		// Length checks
		if (username.length > CONFIG.MAX_USERNAME_LENGTH) {
			res.json({success: false, message: "Username is too long!" });
			return;
		} else if (username.length < CONFIG.MIN_USERNAME_LENGTH) {
			res.json({success: false, message: "Username is too short!" });
			return;
		} else if (username.length == 0) {
			res.json({success: false, message: "Username is empty!" });
			return;
		}
	}
	
	if (password) {
		// Length checks
		if (password.length > CONFIG.MAX_PASSWORD_LENGTH) {
			res.json({success: false, message: "Password is too long!" });
			return;
		} else if (password.length == 0) {
			res.json({success: false, message: "Password is empty!" });
			return;
		}
	}

	// Get unclaimed user information
	const unclaimedUserInfo = database.getUnclaimedUserInfo(claimCode);

	if (unclaimedUserInfo == undefined) {
		res.json({ success: false, message: "Invalid code!" });
		return;
	}

	// If username or password not given, return information about unclaimed user.
	if (username == undefined && password == undefined) {
		res.json({
			success: true,
			message: "Success!",
			storageQuota: unclaimedUserInfo.storageQuota,
			publicSalt: unclaimedUserInfo.passwordPublicSalt
		});

		return;
	}

	if (!username || !password) {
		res.json({ success: false, message: "Bad request!" });
		return;
	}

	// Check if username already exists
	const usernameIsTaken = database.isUsernameTaken(username);

	if (usernameIsTaken) {
		res.json({success: false,	message: "Username already taken!" });
		return;
	}

	LogMessage(`Hashing password...`);
	
	// Hash password with private salt buffer
	let privateSalt = unclaimedUserInfo.passwordPrivateSalt;

	try {
		let passwordHash = await argon2id({
			password: password,
			salt: privateSalt,
			parallelism: PASSWORD_HASH_SETTINGS.PARALLELISM,
			iterations: PASSWORD_HASH_SETTINGS.ITERATIONS,
			memorySize: PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
			hashLength: PASSWORD_HASH_SETTINGS.HASH_LENGTH,
			outputType: "encoded"
		});

		if (typeof(passwordHash) != "string")
			throw new Error("hash did not return string type!");

		// Double check if code has not been used at this stage. If it has, then it's concerning because the code was checked to be valid above.
		const stillValid = database.isClaimCodeValid(claimCode);

		if (stillValid == false) {
			LogMessage(`WARNING: A claim code of ${claimCode} has already been used to create a user and managed to get to the password hashing stage!`);
			res.json({ success: false, message: "Code already used!" });
			return;
		}

		// Finally, claim the user
		const claimUserInfo: ClaimUserInfo = {
			claimCode: claimCode,
			username: username,
			passwordHash: passwordHash
		};

		database.createUserFromUnclaimedUser(claimUserInfo);
		res.json({ success: true, message: "Success!" });
	} catch (error) {
		LogError(`Password hashing error: ${error}`);
		res.json({ success: false, message: "SERVER ERROR" });
	};
});

app.post("/api/login", loginRateLimiter, async (req, res) => {
	if (isUserLoggedIn(req)) {
		res.sendStatus(403); // Forbidden, since already logged in
		return;
	}

	const { username,	password } = req.body;
	LogMessage(`U: ${username} P: ${password}`);

	if (typeof (username) != "string") {
		res.send({ success: false, message: "Bad request!" });
		return;
	}

	// Password can be undefined or a string
	if (password && typeof (password) != "string") {
		res.send({ success: false, message: "Bad request!" });
		return;
	}

	// Username length check
	if (username.length < CONFIG.MIN_USERNAME_LENGTH || username.length > CONFIG.MAX_USERNAME_LENGTH) {
		res.send({ success: false, message: "Bad request!" });
		return;
	}

	// Password length check only if password was given (it should be hashed on the client using the password's hash length setting so it must match the config's length)
	if (password && password.length != PASSWORD_HASH_SETTINGS.HASH_LENGTH * 2) { // Password is sent as hex string, so multiply config's hash length by 2
		res.send({ success: false, message: "Bad request!" });
		return;
	}

	// Get user's info from database
	let userInfo: UserInfo | undefined = undefined;

	try {
		userInfo = database.getUserInfo(username);
	} catch (error) {
		LogError(error);
	}

	// If the username does not exist or it has not been claimed yet, then fake the existance
	// of the account to the user. This prevents an easy check for if a username exists
	if (userInfo == undefined) {
		if (password.length > 0) {
			// Hash the password to pretend that the server is busy checking whether the entered credentials
			// for the non-existant user is correct
			await argon2id({
				password: password,
				salt: CONFIG.SERVER_SECRET,
				parallelism: PASSWORD_HASH_SETTINGS.PARALLELISM,
				iterations: PASSWORD_HASH_SETTINGS.ITERATIONS,
				memorySize: PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
				hashLength: CONFIG.USER_DATA_SALT_LENGTH,
				outputType: "hex"
			});
			
			res.send({ success: false, message: "Incorrect credentials!" });
		} else {
			// Generate a fake public password salt to lie about the existance of this username
			// (the hash must be extremely fast because returning the string)
			try {
				let fakePublicSalt = await blake3(
					`${username} ${CONFIG.SERVER_SECRET}`, // Hash requested username with server secret (makes it unique)
					CONFIG.USER_DATA_SALT_LENGTH * 8 // Specify number of bits of output
				);

				if (CONFIG.IS_DEV_MODE)
					LogMessage(`Sending fake salt for requested username '${username}': ${fakePublicSalt}`);

				res.send({ success: true,	publicSalt: fakePublicSalt })
			} catch (error) {
				LogError(error);
				res.sendStatus(500);
			}
		}

		return;
	}

	// If the password is empty, send the requested user's public salt
	if (password.length == 0) {
		res.send({success: true, publicSalt: userInfo.passwordPublicSalt });
		return;
	}

	// Authenticate user
	try {
		const verified = await argon2Verify({ password: password, hash: userInfo.passwordHash });

		if (verified) {
			logUserIn(req, username);
			res.send({success: true,	message: "Success!", masterKeySalt: userInfo.masterKeySalt });
			return;
		} else {
			res.send({ success: false, message: "Incorrect credentials!"});
			return;
		}
	} catch (error) {
		// Invalid hash error means that the passwordHash stored on server is not a valid argon2 hash
		LogError(`Failed to verify user's password: ${error}`);
		res.send({ success: false, message: "SERVER ERROR!"});
	}
});

app.post("/api/logout", async (req, res) => {
	logUserOut(req);
	res.sendStatus(200);
});

app.get("/api/isloggedin", async (req, res) => {
	res.send({
		value: isUserLoggedIn(req)
	});
});

// FILE UPLOAD API (TODO: PUT IN ANOTHER JS FILE PLZ)
let uploadTransferEntries: UploadTransferEntryDictionary = {};

// TODO: remove dead handles function (requested from the client everytime they load their page)
// TODO: instead of deleting entry when transfer failed, better to have a cancelled boolean and check against that, then only delete entry when user clears uploads...
// TODO: when a chunk fails to upload, delete destination file on server immediately plz.
// TODO: move this function elsewhere... some uploading server .ts file
function createUploadTransferEntry(username: string, fileSize: number, chunkCount: number) {
	const handle = GenerateSecureRandomAlphaNumericString(CONFIG.FILE_HANDLE_LENGTH);
	const uploadFilePath = path.join(CONFIG.USER_FILESYSTEM_SETTINGS.UPLOAD_DIRECTORY, handle);

	let entry: UploadTransferEntry = {
		handle: handle,
		username: username,
		fileSize: fileSize,
		chunkCount: chunkCount,
		writtenBytes: 0, // Stores how many bytes have been written to the file
		prevWrittenChunkId: -1, // Helps ensure that chunks are written in the correct order (MUST BE -1 INITIALLY!)
		uploadFileDescriptor: null,
		uploadFilePath: uploadFilePath,
		mutex: new Mutex()
	};
	
	uploadTransferEntries[handle] = entry;
	return entry;
}

// TODO: allow user to specify how many uploads they want to start (WITH A LIMIT) edit: actually its fine to make many requests, whatever...
// TODO: ensure user cannot create too many uploads at once. (e.g only 8 uploads can run in parallel and they must be finalised before another one starts)
// TODO: make async! (everything should be async?)
app.post("/api/transfer/startupload", ifUserLoggedOutSendForbidden, (req, res) => {
	const username = getLoggedInUsername(req);
	const { encFileCryptKeyWithNonceStr, fileSize, chunkCount } = req.body;

	if (typeof(fileSize) != "number") {
		res.status(400).json({ success: false, message: "fileSize must be a number!" });
		return;
	}

	if (typeof(chunkCount) != "number") {
		res.status(400).json({ success: false, message: "chunkCount must be a number!" });
		return;
	}

	// TODO: max file size plz (plus check quota) (e.g 32 GB max size) or not? maybe dont need max file size, it wont matter

	//LogMessage(`Upload start: encFileCryptKeyWithNonceStr ${encFileCryptKeyWithNonceStr}`);
	//LogMessage(`As blob: ${hexStringToUint8Array(encFileCryptKeyWithNonceStr)}`); // TODO: STORE ON SERVER AS BLOB

	// Create upload transfer entry
	const uploadEntry = createUploadTransferEntry(username, fileSize, chunkCount);

	// Open new transfer destination file
	try {
		fs.open(uploadEntry.uploadFilePath, "w", (error, fileDescriptor) => {
			if (error)
				throw error;

			uploadEntry.uploadFileDescriptor = fileDescriptor;

			// Append magic number + chunk count + chunk size
			const header = Buffer.alloc(12);
			header.set(ENCRYPTED_FILE_MAGIC_NUMBER, 0);
			header.set(encodeSignedIntAsFourBytes(chunkCount), 4);
			header.set(encodeSignedIntAsFourBytes(ENCRYPTED_CHUNK_FULL_SIZE), 8);

			fs.appendFile(fileDescriptor, header, (error) => {
				if (error) {
					throw error;
				} else {
					uploadEntry.writtenBytes = header.byteLength;
				}
			});
		});
		
		res.json({ success: true,	message: "", handle: uploadEntry.handle });
	} catch (error) {
		res.status(500).json({ success: false, message: "SERVER ERROR!" });
		LogError(error);
		return;
	}
});

// This is called only when the user arrives at the treasury page (or refreshes it or logs out)
app.post("/api/transfer/cancelalluploads", ifUserLoggedOutSendForbidden, (req, res) => {

});

app.post("/api/transfer/cancelupload", ifUserLoggedOutSendForbidden, async (req, res) => {
	const username = getLoggedInUsername(req);
	const handle = req.body.handle;

	if (typeof(handle) != "string") {
		res.status(400).json({success: false, message: "handle must be a string!" });
		return;
	}

	const transferEntry = uploadTransferEntries[handle];
	
	if (transferEntry == undefined) {
		res.status(400).json({ success: false, message: "invalid handle!" });
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.username != username) {
		res.status(403).json({ success: false, message: "not your handle!" });
		return;
	}

	const uploadFilePath = transferEntry.uploadFilePath;
	const fileDescriptor = transferEntry.uploadFileDescriptor;
	delete uploadTransferEntries[handle];

	if (fileDescriptor == null) {
		LogError(`Trying to cancel upload with a null uploadFileDescriptor`);
		return;
	}

	// Try close the file
	fs.close(fileDescriptor, (error) => {
		if (error) {
			LogError(`FAILED TO CLOSE FILE! fd: ${fileDescriptor} message: ${error}`);
			res.status(500).json({ success: false, message: "SERVER ERROR!" });
		}
	});

	// Try remove upload file
	fs.unlink(uploadFilePath, (error) => {
		if (error) {
			LogError(`Cancel upload unlink file error: ${error}`);
			res.status(500).json({ success: false, message: "SERVER ERROR!" });
		} else {
			res.sendStatus(200);
		}
	});
});

app.post("/api/transfer/finaliseupload", ifUserLoggedOutSendForbidden, (req, res) => {
	const username = getLoggedInUsername(req);
	const handle = req.body.handle;

	if (typeof(handle) != "string") {
		res.status(400).json({success: false, message: "handle must be a string!" });
		return;
	}

	let transferEntry = uploadTransferEntries[handle];
	
	if (transferEntry == undefined) {
		res.status(400).json({ success: false, message: "invalid handle!" });
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.username != username) {
		res.status(403).json({ success: false, message: "not your handle!" });
		return;
	}

	// Ensure user has written their specified number of bytes
	if (transferEntry.writtenBytes != transferEntry.fileSize) {
		res.status(400).json({ success: false, message: "not enough data has been written!" });
		return;
	}

	if (transferEntry.uploadFileDescriptor == null) {
		LogError(`Trying to finalise a transfer entry with a null uploadFileDescriptor! Handle: ${transferEntry.uploadFileDescriptor}`);
		return;
	}

	// Close the file
	fs.close(transferEntry.uploadFileDescriptor, (error) => {
		if (error) {
			LogError(error);
			delete uploadTransferEntries[handle];
			res.status(500).json({ success: false, message: "couldnt finalise transfer!", cancelUpload: true });
			return;
		} else {
			LogMessage(`Successfully finalised upload: ${handle}`);
			res.sendStatus(200);
			delete uploadTransferEntries[handle];
		}
	});
});

// TODO: need server to share constants for encrypted chunksize and check that either 1. chunk size is exactly the constant or 2. chunk size is fileSize remainder AND in this case, writeOffset is also EXACTLY fileSize - remainder chunk size!!!
app.post("/api/transfer/uploadchunk", ifUserLoggedOutSendForbidden, multerUpload.single("data"), async (req, res) => {
	// TODO: this whole system is so unreliable! need to use typescript and make it all better...

	if (req.file == undefined) {
		res.status(400).json({success: false, message: "No file was uploaded!" });
		return;
	}

	const username = getLoggedInUsername(req);
	const handle = req.body.handle;
	const chunkId = parseInt(req.body.chunkId);
	const chunkBuffer = req.file.buffer;

	if (typeof(handle) != "string") {
		res.status(400).json({success: false, message: "Handle must be a string!" });
		return;
	}

	if (isNaN(chunkId)) {
		res.status(400).json({success: false, message: "chunkId must be a valid number!" });
		return;
	}

	let transferEntry = uploadTransferEntries[handle];
	
	if (transferEntry == undefined) {
		res.status(400).json({ success: false, message: "Invalid handle!" });
		return;
	}

	// Ensure this is the user's handle
	if (transferEntry.username != username) {
		res.status(403).json({ success: false, message: "Invalid handle!" });
		return;
	}

	const appendBufferToFile = async () => {
		const release = await transferEntry.mutex.acquire();

		try {
			// LogMessage(`Appending: ${chunkId}`);

			// Check chunk size
			// Will fail if the chunk size does not match the config AND it isn't trying to write the remaining bytes of the file where
			// it makes sense that the chunkSize would be different
			const chunkSize = chunkBuffer.byteLength;
			const bytesLeftToWrite = transferEntry.fileSize - transferEntry.writtenBytes;

			if (chunkSize != ENCRYPTED_CHUNK_FULL_SIZE && chunkSize != bytesLeftToWrite) {
				// LogError(`failed: cs: ${chunkSize} ecfs: ${ENCRYPTED_CHUNK_FULL_SIZE} bltw: ${bytesLeftToWrite}`);
				res.status(400).json({ success: false, message: "incorrect chunk size!" });
				return;
			}

			// Ensure user does not upload more data than they requested
			if (transferEntry.writtenBytes + chunkSize > transferEntry.fileSize) {
				res.status(413).json({ success: false, message: "wrote too much data!" });
				return;
			}

			transferEntry.writtenBytes += chunkSize;
			transferEntry.prevWrittenChunkId = chunkId;
			
			try {
				await fs.promises.appendFile(transferEntry.uploadFilePath, chunkBuffer);
				
				// Successful upload of chunk here
				res.sendStatus(200);
			} catch (error) {
				LogError(`Append buffer to file error: ${error}`);
				res.status(500).json({ success: false, message: "Failed to upload chunk" }); // TODO: fail chunk function? prevent code repeating
			}
		} catch (error) {
			LogError(`Failed to append buffer to file for reason: ${error}`);
		} finally {
			release();
		};
	};

	// Helps prevent data races
	const getPrevWrittenChunkId = async () => {
		const release = await transferEntry.mutex.acquire();
		
		try {
			return transferEntry.prevWrittenChunkId;
		} finally {
			release();
		}
	};

	// If the current chunk arrives ahead of time, then buffer it until the next chunk gets written.
	const retryDelayMs = CONFIG.BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS;
	let timeSpentRetrying = 0;

	const tryAppendChunk = async () => {
		let prevWrittenChunkId = await getPrevWrittenChunkId();
		let chunkIdDifference = chunkId - prevWrittenChunkId;

		// If this chunk should come next in the file, then proceed. Otherwise, buffer it.
		if (chunkIdDifference == 1) {
			await appendBufferToFile();
		} else {
			// Check if too many chunks are being buffered by this user
			if (chunkId - prevWrittenChunkId > MAX_TRANSFER_BUSY_CHUNKS) {
				// Cancel the upload
				delete uploadTransferEntries[handle];
				res.status(400).json({ success: false, message: "Too many chunks are buffered", cancelUpload: true });
				return;
			}

			// LogMessage(`buffered: ${chunkId} prev: ${prevWrittenChunkId}`);

			// Cap the amount of time the server can spend trying to write a buffered chunk to the file
			if (timeSpentRetrying > CONFIG.BUFFERED_CHUNK_WRITE_RETRY_TIMEOUT_MS) {
				// Cancel the upload
				delete uploadTransferEntries[handle];
				res.status(400).json({ success: false, message: "Chunk buffered for too long", cancelUpload: true });
			} else {
				timeSpentRetrying += retryDelayMs;
				setTimeout(tryAppendChunk, retryDelayMs);
			}
		}
	};

	await tryAppendChunk();

	/*
	if (!res.headersSent) {
		LogError("No headers were sent in uploadchunk route!");
		res.status(500).json({ success: false, message: "SERVER ERROR" });
	}
	*/
});

// Serve pages
async function serveIndexHtml(req: any, res: any) {
	if (CONFIG.IS_DEV_MODE) {
		res.sendFile(path.join(__dirname, "index.html"));
	} else {
		res.sendFile(path.join(__dirname, "dist", "index.html"));
	}
}

app.get("/login", ifUserLoggedInRedirectToTreasury, serveIndexHtml);
app.get("/claimaccount", ifUserLoggedInRedirectToTreasury, serveIndexHtml);
app.get("/treasury", ifUserLoggedOutRedirectToLogin, serveIndexHtml);
app.get("/404", serveIndexHtml); // 404 error page

// This is the last route and so no other routes were taken, so redirect user to the 404 error page
app.use((req, res) => {
	res.redirect("/404");
})

// End and cleanup server events
let ranCleanup = false; // Prevents CleanupServer() from being called more than once

async function CleanupServer() {
	if (ranCleanup)
		return;

	ranCleanup = true;

	LogMessage("Closing database...");
	
	try {
		database.close();
	} catch (error) {
		LogError(`Failed to close database for reason: ${error}`);
	}

	LogMessage("Server closed.");
}

process.on("exit", (code) => {
	LogMessage(`Process will exit with code: ${code}`);
	CleanupServer();
});

process.on("SIGINT", () => {
	LogMessage(`Received SIGINT. Exiting...`);
	CleanupServer();
	process.exit(0);
});

process.on("SIGTERM", () => {
	LogMessage(`Received SIGTERM. Exiting...`);
	CleanupServer();
	process.exit(0);
});

// Start server
async function StartServer() {
	return new Promise((resolve: any, reject: any) => {
		app.listen(CONFIG.SERVER_PORT, () => {
			// LogMessage(`Session secret: ${CONFIG.SESSION_SECRET}`);
		
			if (CONFIG.IS_DEV_MODE) {
				LogMessage("Started in DEVELOPMENT mode.");
			} else {
				LogMessage("Started in PRODUCTION mode.");
			}
		
			LogMessage(`Server now listening on port ${CONFIG.SERVER_PORT}`);
			resolve();
		});
	});
}

await StartServer();

// Listen for commands

// TODO: prompting loop function for command validation where it has a message to prompt, and a callback that returns true if pass, and false if continue to prompt...

const readlineInterface = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

console.log(""); // New line
console.log("You may now enter commands. Enter 'help' if you need help.");

while (true) {
	const questionPromise = new Promise((resolve, reject) => {
		readlineInterface.question("", async (answer: string) => {
			console.log(); // Add new line to separate answer from user's command

			const answerParts = answer.split(" ");
	
			if (answerParts.length == 0) {
				reject("You entered an invalid command.");
				return;
			}
			
			const command = answerParts[0].toLowerCase();
			
			// Core commands
			if (command == "help") {
				console.log("Commands:");
				console.log("  exit - Shutdowns the server");
				console.log("  newuser [storageQuota, e.g 512MB, 32GB, 32GiB] - Creates a new user with a specified storage quota. It can be claimed with the returned claim code.");
				console.log("  viewusers - Shows all the users that exist.");
				console.log("  viewunclaimedusers - Shows all the unclaimed users that exist.");
				console.log();

				resolve(true);
			} else if (command == "exit") {
				// TODO: add confirmation message if there are transfers in progress
				process.exit(0);
				resolve(true);
			}
	
			// Database interaction commands
			if (command == "newuser") {
				if (answerParts.length == 1) {
					reject("You did not specify the storage quota!");
					return;
				} else if (answerParts.length > 2) {
					reject("Too many arguments!");
					return;
				}
	
				const unitMultipliers = {
					"kb": 1000,
					"kib": 1024,
					"mb": 1000 * 1000,
					"mib": 1024 * 1024,
					"gb": 1000 * 1000 * 1000,
					"gib": 1024 * 1024 * 1024,
					"tb": 1000 * 1000 * 1000 * 1000,
					"tib": 1024 * 1024 * 1024 * 1024,
					"pb": 1000 * 1000 * 1000 * 1000 * 1000,
					"pib": 1024 * 1024 * 1024 * 1024 * 1024,
					"b": 1, // Must come last
				}
				
				const storageQuotaStr = answerParts[1].toLowerCase().trim();
				
				// Get unit part of string
				let unitIndex = -1;
				let unitMultiplier = 0;

				for (let [unit, multiplier] of Object.entries(unitMultipliers)) {
					const index = storageQuotaStr.indexOf(unit);

					if (index > -1 && index + unit.length == storageQuotaStr.length) {
						unitIndex = index;
						unitMultiplier = multiplier;
						break;
					}
				}
				
				if (unitIndex == -1) {
					reject("Invalid arguments!");
					return;
				}

				const numericStr = storageQuotaStr.substring(0, unitIndex);
				const numeric = parseFloat(numericStr);

				if (typeof(numeric) != "number" || isNaN(numeric)) {
					reject("Invalid arguments!");
					return;
				}

				// Check if resulting value is greater than max safe integer
				if (numeric * unitMultiplier > Number.MAX_SAFE_INTEGER) {
					reject("Number is too big! Max quota is ~9.007 PB");
					return;
				}

				const storageQuota = numeric * unitMultiplier;
				console.log(`Create new user with a storage quota of ${storageQuota.toLocaleString()} bytes? (y/N)`);

				// Confirm with user
				let confirmed = false;

				await new Promise((resolve, reject) => {
					readlineInterface.question("", (answer: string) => {
						if (answer.toLowerCase().trim() == "y") {
							confirmed = true;
						}
							
						resolve(true);
					});
				});

				if (!confirmed) {
					reject("Cancelled.");
					return;
				}

				try {
					const claimCode = GenerateSecureRandomAlphaNumericString(CONFIG.CLAIM_ACCOUNT_CODE_LENGTH);

					const newUnclaimedUserInfo: UnclaimedUserInfo = {
						claimCode: claimCode,
						storageQuota: storageQuota,
						passwordPublicSalt: GenerateSecureRandomBytesAsHexString(CONFIG.USER_DATA_SALT_LENGTH),
						passwordPrivateSalt: GenerateSecureRandomBytesAsHexString(CONFIG.USER_DATA_SALT_LENGTH),
						masterKeySalt: GenerateSecureRandomBytesAsHexString(CONFIG.USER_DATA_SALT_LENGTH)
					};
					
					database.createNewUnclaimedUser(newUnclaimedUserInfo);
					console.log(`Successfully created user. Claim code: ${claimCode}`);
					resolve(true);
				} catch (error) {
					LogError(error);
					reject();
				}
			} else if (command == "viewusers") {
				resolve(true);
			} else if (command == "viewunclaimedusers") {
				resolve(true);
			} else {
				reject("Unknown command!");
				return;
			}
			
			// TODO: delete unclaimed user code command
			// TODO: delete files MUST check the file format first
	
			resolve(true);
		});
	});

	try {
		await questionPromise;
	} catch (error) {
		console.log(error);
		console.log();
	}
}
