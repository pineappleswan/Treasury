import express from "express";
import cors from "cors";
import compression from "compression";
import fs from "fs";
import url from "node:url";
import path from "path";
import session from "express-session";
import bodyParser from "body-parser";
import crypto from "crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import MemoryStoreLib from "memorystore"; // talk about why this is used
import rateLimit from "express-rate-limit";
import minimist from "minimist";
import { Sequelize, DataTypes } from "sequelize";
import multer from "multer";
import { Mutex } from "async-mutex";
// import { ed25519, x25519 } from "@noble/curves/ed25519"
import { UnclaimedUser, User, UserFilesystem } from "./classes.ts";
import { UploadTransferEntry, UploadTransferEntryDictionary } from "./transfers";
import { GenerateSecureRandomBytesAsHexString, GenerateSecureRandomAlphaNumericString } from "./serverCrypto";
import { PASSWORD_HASH_SETTINGS } from "../src/common/commonCrypto.ts"

import {
	logUserIn,
	logUserOut,
	getLoggedInUsername,
	isUserLoggedIn,
	ifUserLoggedInRedirectToTreasury,
	ifUserLoggedOutRedirectToLogin,
	ifUserLoggedOutSendForbidden
} from "./authentication.ts";

import {
	ENCRYPTED_CHUNK_FULL_SIZE,
	ENCRYPTED_FILE_MAGIC_NUMBER,
	MAX_TRANSFER_BUSY_CHUNKS,
	encodeSignedIntAsFourBytes,
} from "../src/common/commonCrypto.ts";

// TODO: make a system to track server upload transfer memory usage and return overload to client (they can retry uploading chunks) but return false success
// TODO: thumbnails shouldnt be included in metadata, just have a special pointer name of $.thumbnail->FILEHANDLE for example and the client will process it
// TODO: strict storage quota where even the database's data is taken into account! for example the data used for storing the virtual filesystem and stuff...
// TODO: config json file where values can be filled from the json
// TODO: req body types
// TODO: ensure all routes that require authentication, are authenticated
// TODO: somehow allow server user to create new account codes without having to stop the server? admin account? maybe admin account or manual separate cli
// TODO: test absolute path database directory to see if it works
//       program written in typescript that the user can use to interact with the server and create new accounts? (only works when server is offline) and
//       only if the server config says that admin account cant create account
// IDEA: user browser for admin accounts (set permissions?)

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
	MAX_USERNAME_LENGTH: number,
	MAX_PASSWORD_LENGTH: number,
	USER_DATA_SALT_LENGTH: number,
	BUFFERED_CHUNK_WRITE_RETRY_TIMEOUT_MS: number,
	BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS: number,
	CLAIM_ACCOUNT_CODE_LENGTH: number,
	TRANSFER_HANDLE_LENGTH: number
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
	MAX_USERNAME_LENGTH: 20,
	MAX_PASSWORD_LENGTH: 200,
	CLAIM_ACCOUNT_CODE_LENGTH: 20,
	TRANSFER_HANDLE_LENGTH: 32,
	SESSION_SECRET: GenerateSecureRandomBytesAsHexString(64), // Just generate a random hex string
	USER_DATA_SALT_LENGTH: 32, // The length of the salts for the user's passwords and master key in bytes
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

// Print functions for the server (because it's formatted in a way thats obvious to the user)
function LogToConsole(message: any) {
	console.log(` > ${message}`);
}

function ErrorToConsole(message: any) {
	console.log(` > ERROR: ${message}`);
}

// Server program initialisation (TODO: app.js that does these checks and passes valid data to server.js! modular code plz, not a monolith)
{
	// Sanity checks (if failed, an error message will be printed and the program will pause indefinitely)
	async function BlockProgramExecution() {
		await new Promise(resolve => setTimeout(resolve, 1000000000));
	}

	if (CONFIG.SERVER_PORT == undefined) {
		ErrorToConsole("You did not specify the port to use for the server. Please indicate using the --port argument when running the server.");
		await BlockProgramExecution();
	}

	// Initialise
	{
		let databaseDirectory = CONFIG.USER_DATABASE_SETTINGS.PARENT_DIRECTORY
		let databaseFilePath = path.join(databaseDirectory, CONFIG.USER_DATABASE_SETTINGS.FILE_NAME);

		// 1. Check if database directory exists. If not, create and initialise the database directory
		if (!fs.existsSync(databaseDirectory)) {
			fs.mkdirSync(databaseDirectory);
		}

		let databaseFileExists = fs.existsSync(databaseFilePath);

		// 2. Establish connection with new database
		try {
			var sequelize = new Sequelize({
				dialect: "sqlite",
				storage: databaseFilePath,
				logging: (message, timing) => {
					// Log to console only in development mode
					if (CONFIG.IS_DEV_MODE) {
						LogToConsole(`DATABASE: ${message}`);
					}	
				}
			});

			// Inititalise sequelize models
			UnclaimedUser.init({
				claimCode: { type: DataTypes.STRING, allowNull: false, unique: true, primaryKey: true },
				storageQuota: { type: DataTypes.BIGINT, allowNull: false },
				passwordPublicSalt: { type: DataTypes.STRING, allowNull: false },
				passwordPrivateSalt: { type: DataTypes.STRING, allowNull: false },
				masterKeySalt: { type: DataTypes.STRING, allowNull: false },
			}, {
				sequelize,
				timestamps: false
			});
			
			User.init({
				username: { type: DataTypes.STRING, allowNull: false, unique: true, primaryKey: true },
				passwordPublicSalt: { type: DataTypes.STRING, allowNull: false },
				passwordPrivateSalt: { type: DataTypes.STRING, allowNull: false },
				masterKeySalt: { type: DataTypes.STRING, allowNull: false },
				passwordHash: { type: DataTypes.STRING, allowNull: false },
				storageQuota: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
				// Storing claimCode prevents a scenario where a user can use one access code to create multiple accounts by making multiple claim account requests extremely quickly
				claimCode: { type: DataTypes.STRING, allowNull: false },
				// TODO: register date of user? (UTC)
			}, {
				sequelize,
				timestamps: false
			})
			
			/*
			TODO: create multiple tables for user filesystems? currently it seems only one UserFilesystems table is made where 'UserUsername' links the user to the filesystem! thats bad! repeated names = space waster!

			UserFilesystem.init({
				handle: { type: DataTypes.STRING, allowNull: false, unique: true, primaryKey: true },
				parentHandle: { type: DataTypes.STRING, allowNull: false },
				encryptedFileNameWithNonce: { type: DataTypes.BLOB, allowNull: false },
			}, {
				sequelize,
				timestamps: false
			});

			// Define association between User and UserFilesystem
			User.hasMany(UserFilesystem);
			UserFilesystem.belongsTo(User);
			*/

			// Establish connection to database
			await sequelize.authenticate();

			if (!databaseFileExists)
				LogToConsole("Created a new user database and established a connection to it...");

			// Sync tables
			await sequelize.sync();

			if (!databaseFileExists) {
				LogToConsole("Initialised user database successfully!");
			} else {
				LogToConsole("Successfully established connection to user database!")
			}

			// TODO: THIS IS TEMPORARY
			if (!databaseFileExists) {
				// Reserve one account for testing
				UnclaimedUser.create({
					claimCode: GenerateSecureRandomAlphaNumericString(CONFIG.CLAIM_ACCOUNT_CODE_LENGTH),
					storageQuota: 250000000,
					passwordPublicSalt: GenerateSecureRandomBytesAsHexString(CONFIG.USER_DATA_SALT_LENGTH),
					passwordPrivateSalt: GenerateSecureRandomBytesAsHexString(CONFIG.USER_DATA_SALT_LENGTH),
					masterKeySalt: GenerateSecureRandomBytesAsHexString(CONFIG.USER_DATA_SALT_LENGTH)
				});
			}
		} catch (error) {
			ErrorToConsole(`Unable to connect to the user database! Error message: ${error}`);
			await BlockProgramExecution();
		}
	}
}

/* TODO
	1. when user is renaming a file, just wait for response from server and change file name on client
	2. client needs a theme for tailwind or something. some central theme selector
	3. for debugging purposes, allow specifying a limited transfer speed when uploading/downloading
	4. NEED WAY BETTER error handing and error checking (simplify it all somehow, 'express-async-errors' ???)
*/

/* POSSIBLE EXPLOITS
	1. When claiming account, if two requests come to claim an access code at the same. blah blah.
	   anyways it should be fixed, please send two async requests from one client to test!
	2. User can buffer too much upload data and cause server to use up too much memory. Limit how many chunks can be out of order on the server (to match max busy chunks on client) (TODO: MUST CHECK THIS VULNERABILITY)
*/

// Create app
const app = express();

const MemoryStore = MemoryStoreLib(session);

const upload = multer({
	//dest: "./uploads" TODO: just store in memory i guess? no other solutions i guess?
});

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
		// TODO: BAN illegal characters! only allow characters of english alphabet and numbers (not even underscore)

		if (username.length > CONFIG.MAX_USERNAME_LENGTH) {
			res.json({success: false, message: "Username is too long!" });
			return;
		} else if (username.length == 0) {
			res.json({success: false, message: "Username is empty!" });
			return;
		}
	}
	
	if (password) {
		if (password.length > CONFIG.MAX_PASSWORD_LENGTH) {
			res.json({success: false, message: "Password is too long!" });
			return;
		} else if (password.length == 0) {
			res.json({success: false, message: "Password is empty!" });
			return;
		}
	}

	// Check if claimCode is valid
	const unclaimedUser = await UnclaimedUser.findOne({ where: { claimCode: claimCode } });

	if (unclaimedUser == null) {
		res.json({ success: false, message: "Invalid code!" });
		return;
	}

	// If username or password not given, return information about unclaimed user.
	if (username == undefined && password == undefined) {
		res.json({
			success: true,
			message: "Success!",
			storageQuota: unclaimedUser.storageQuota,
			publicSalt: unclaimedUser.passwordPublicSalt
		});

		return;
	}

	if (username && password) {
		// Check if username already exists
		let user = await User.findOne({ where: { username: username }});

		if (user) {
			res.json({success: false,	message: "Username already taken!" });
			return;
		}

		LogToConsole(`Hashing password...`);
		
		// Hash password with private salt buffer
		let publicSalt = unclaimedUser.passwordPublicSalt;
		let privateSalt = unclaimedUser.passwordPrivateSalt;
		let masterKeySalt = unclaimedUser.masterKeySalt;

		const passwordHash = await argon2id({
			password: password,
			salt: privateSalt,
			parallelism: PASSWORD_HASH_SETTINGS.PARALLELISM,
			iterations: PASSWORD_HASH_SETTINGS.ITERATIONS,
			memorySize: PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
			hashLength: PASSWORD_HASH_SETTINGS.HASH_LENGTH,
			outputType: "encoded"
		});
		
		if (typeof(passwordHash) != "string") {
			throw new Error("hash did not return string type!");
		}
		
		// TODO: this is temporary
		if (CONFIG.IS_DEV_MODE) {
			LogToConsole(`password: ${password}`)
			LogToConsole(`publicSalt: ${publicSalt}`);
			LogToConsole(`privateSalt: ${privateSalt}`);
			LogToConsole(`masterKeySalt: ${masterKeySalt}`);
			LogToConsole(`passwordHash: ${passwordHash}`);
		}

		// Double check if code has not been used at this stage. If it has, then it's concerning because the code was checked to be valid above.
		const existingUser = await User.findOne({ where: { claimCode: claimCode } });

		if (existingUser != null) {
			LogToConsole(`WARNING: A claim code of ${claimCode} has already been used to create a user and managed to get to the password hashing stage!`);
			res.json({ success: false, message: "Code already used!" });
			return;
		}

		// Remove unclaimed user entry
		await UnclaimedUser.destroy({ where: { claimCode: claimCode } });

		// Create user
		await User.create({
			username: username,
			passwordPublicSalt: publicSalt,
			passwordPrivateSalt: privateSalt,
			masterKeySalt: masterKeySalt,
			passwordHash: passwordHash,
			storageQuota: unclaimedUser.storageQuota,
			claimCode: claimCode
		});

		res.json({success: true,message: "Success!" });
		return;
	}
});

app.post("/api/login", loginRateLimiter, async (req, res) => {
	if (isUserLoggedIn(req)) {
		res.sendStatus(403); // Forbidden, since already logged in
		return;
	}

	const { username,	password } = req.body;
	LogToConsole(`U: ${username} P: ${password}`);

	// Check if username and password was supplied
	if (typeof (username) != "string" || typeof (password) != "string") {
		res.send({ success: false, message: "Bad request!" });
		return;
	}

	// Length checks
	if (username.length > CONFIG.MAX_USERNAME_LENGTH || password.length > PASSWORD_HASH_SETTINGS.HASH_LENGTH * 2) {
		res.send({ success: false, message: "Bad request!" });
		return;
	}

	// Get user from database
	let user = await User.findOne({ where: { username: username } });

	// If the username does not exist or it has not been claimed yet, then fake the existance
	// of the account to the user. This prevents an easy check for if a username exists
	if (user == null) {
		if (CONFIG.IS_DEV_MODE)
			LogToConsole(`Requested username '${username}' doesn't exist!`);
		
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
			try {
				let fakePublicSalt = await argon2id({
					password: username,
					salt: CONFIG.SERVER_SECRET,
					parallelism: PASSWORD_HASH_SETTINGS.PARALLELISM,
					iterations: PASSWORD_HASH_SETTINGS.ITERATIONS,
					memorySize: PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
					hashLength: CONFIG.USER_DATA_SALT_LENGTH,
					outputType: "hex"
				});

				if (CONFIG.IS_DEV_MODE)
					LogToConsole(`Sending fake salt for requested username '${username}': ${fakePublicSalt}`);

				res.send({ success: true,	publicSalt: fakePublicSalt })
			} catch (error) {
				ErrorToConsole(error);
				res.sendStatus(500);
			}
		}

		return;
	}

	if (user.passwordHash == null) {
		throw new Error(`User called '${username}' has a null password hash! Not claimed!`);
	}

	// If the password is empty, send the requested user's public salt
	if (password.length == 0) {
		res.send({success: true, publicSalt: user.passwordPublicSalt });
		return;
	}

	// Authenticate user
	const verified = await argon2Verify({ password: password, hash: user.passwordHash });

	if (verified) {
		logUserIn(req, username);
		res.send({success: true,	message: "Success!", masterKeySalt: user.masterKeySalt });
		return;
	} else {
		res.send({ success: false, message: "Incorrect credentials!"});
		return;
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
	const handle = GenerateSecureRandomAlphaNumericString(CONFIG.TRANSFER_HANDLE_LENGTH);
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

// TODO: allow user to specify how many uploads they want to start (WITH A LIMIT)
// TODO: ensure user cannot create too many uploads at once. (e.g only 8 uploads can run in parallel and they must be finalised before another one starts)
// TODO: make async! (everything should be async?)
app.post("/api/transfer/startupload", ifUserLoggedOutSendForbidden, (req, res) => {
	const username = getLoggedInUsername(req);
	const { fileSize, chunkCount } = req.body;

	if (typeof(fileSize) != "number") {
		res.status(400).json({ success: false, message: "fileSize must be a number!" });
		return;
	}

	if (typeof(chunkCount) != "number") {
		res.status(400).json({ success: false, message: "chunkCount must be a number!" });
		return;
	}

	// TODO: max file size plz (plus check quota) (e.g 32 GB max size) or not? maybe dont need max file size, it wont matter

	console.log(`Upload start  U: ${username} size: ${fileSize} chunk count: ${chunkCount}`);

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
		ErrorToConsole(error);
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
		ErrorToConsole(`Trying to cancel upload with a null uploadFileDescriptor`);
		return;
	}

	// Try close the file
	fs.close(fileDescriptor, (error) => {
		if (error) {
			ErrorToConsole(`FAILED TO CLOSE FILE! fd: ${fileDescriptor} message: ${error}`);
			res.status(500).json({ success: false, message: "SERVER ERROR!" });
		}
	});

	// Try remove upload file
	fs.unlink(uploadFilePath, (error) => {
		if (error) {
			ErrorToConsole(`Cancel upload unlink file error: ${error}`);
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
		ErrorToConsole(`Trying to finalise a transfer entry with a null uploadFileDescriptor! Handle: ${transferEntry.uploadFileDescriptor}`);
		return;
	}

	// Close the file
	fs.close(transferEntry.uploadFileDescriptor, (error) => {
		if (error) {
			ErrorToConsole(error);
			delete uploadTransferEntries[handle];
			res.status(500).json({ success: false, message: "couldnt finalise transfer!", cancelUpload: true });
			return;
		} else {
			LogToConsole(`Successfully finalised upload: ${handle}`);
			res.sendStatus(200);
			delete uploadTransferEntries[handle];
		}
	});
});

// TODO: need server to share constants for encrypted chunksize and check that either 1. chunk size is exactly the constant or 2. chunk size is fileSize remainder AND in this case, writeOffset is also EXACTLY fileSize - remainder chunk size!!!
app.post("/api/transfer/uploadchunk", ifUserLoggedOutSendForbidden, upload.single("data"), async (req, res) => {
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
			// LogToConsole(`Appending: ${chunkId}`);

			// Check chunk size
			// Will fail if the chunk size does not match the config AND it isn't trying to write the remaining bytes of the file where
			// it makes sense that the chunkSize would be different
			const chunkSize = chunkBuffer.byteLength;
			const bytesLeftToWrite = transferEntry.fileSize - transferEntry.writtenBytes;

			if (chunkSize != ENCRYPTED_CHUNK_FULL_SIZE && chunkSize != bytesLeftToWrite) {
				console.log(`failed: cs: ${chunkSize} ecfs: ${ENCRYPTED_CHUNK_FULL_SIZE} bltw: ${bytesLeftToWrite}`);
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
				ErrorToConsole(`Append buffer to file error: ${error}`);
				res.status(500).json({ success: false, message: "Failed to upload chunk" }); // TODO: fail chunk function? prevent code repeating
			}
		} catch (error) {
			ErrorToConsole(`Failed to append buffer to file for reason: ${error}`);
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

			// LogToConsole(`buffered: ${chunkId} prev: ${prevWrittenChunkId}`);

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
		ErrorToConsole("No headers were sent in uploadchunk route!");
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

// Start server
app.listen(CONFIG.SERVER_PORT, () => {
	// LogToConsole(`Session secret: ${CONFIG.SESSION_SECRET}`);

	if (CONFIG.IS_DEV_MODE) {
		LogToConsole("Started in DEVELOPMENT mode.");
	} else {
		LogToConsole("Started in PRODUCTION mode.");
	}

	LogToConsole(`Server now listening on port ${CONFIG.SERVER_PORT}`);
});

// End and cleanup server
let ranCleanup = false; // Prevents CleanupServer() from being called more than once

async function CleanupServer() {
	if (ranCleanup)
		return;

	ranCleanup = true;

	await sequelize.close();
}

process.on("exit", (code) => {
	LogToConsole(`Node.js process will exit with code: ${code}`);
	CleanupServer();
});

process.on("SIGINT", () => {
	LogToConsole(`Received SIGINT. Exiting...`);
	CleanupServer();
	process.exit(0);
});

process.on("SIGTERM", () => {
	LogToConsole(`Received SIGTERM. Exiting...`);
	CleanupServer();
	process.exit(0);
});
