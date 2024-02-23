// const jsonWebToken = require("jsonwebtoken"); if not needed, uninstallbodypar
import express from "express";
import cors from "cors";
import compression from "compression";
import fs, { write } from "fs";
import url from "node:url";
import path from "path";
import session from "express-session";
import bodyParser from "body-parser";
import crypto from "crypto";
import { argon2id, argon2Verify, sha256 } from "hash-wasm";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { utf8ToBytes } from "@noble/ciphers/utils";
import MemoryStoreLib from "memorystore"; // talk about why this is used
import rateLimit from "express-rate-limit";
import minimist from "minimist";
import { Sequelize, DataTypes } from "sequelize";
import multer from "multer";
import { Mutex } from "async-mutex";

import {
	ENCRYPTED_CHUNK_DATA_SIZE,
	ENCRYPTED_CHUNK_FULL_SIZE,
	ENCRYPTED_FILE_MAGIC_NUMBER,
	ENCRYPTED_CHUNK_MAGIC_NUMBER,
	encodeSignedIntAsFourBytes,
	convertFourBytesToSignedInt
} from "./src/common/commonCrypto.js";

// TODO: make a system to track server upload transfer memory usage and return overload to client (they can retry uploading chunks) but return false success
// TODO: thumbnails shouldnt be included in metadata, just have a special pointer name of $.thumbnail->FILEHANDLE for example and the client will process it
// TODO: m3u8 shouldnt be included in metadata, just have a special pointer name of $.m3u8->FILEHANDLE for example and the client will process it

// TODO: config json file
const CONFIG = {
	PW_HASH_SETTINGS: {
		PARALLELISM: 2,
		ITERATIONS: 8,
		MEMORY_SIZE: 32 * 1024, // 32 MiB,
		HASH_LENGTH: 32, // 32 bytes
	},
	USER_DATABASE_SETTINGS: {
		// The directory where the user database will be stored (add a dot before the path if it's relative. e.g ./databases)
		PARENT_DIRECTORY: "./databases",
		FILE_NAME: "userdata.db"
	},
	USER_FILESYSTEM_SETTINGS: {
		// IMPORTANT: the master directory where all of the users' encrypted files will be stored
		PARENT_DIRECTORY: "/userfiles"
	},
	SERVER_SECRET: "mysecret", // MUST be a fixed value for security reasons TODO: explain in some document why this needs to be fixed (user fake salt return reason)
	SESSION_SECRET: crypto.randomBytes(64).toString("hex"),
	MAX_USERNAME_LENGTH: 20,
	MAX_PASSWORD_LENGTH: 200,
	USER_DATA_SALT_LENGTH: 32, // The length of the salts for the user's passwords and master key in bytes
	BUFFERED_CHUNK_WRITE_RETRY_TIMEOUT_MS: 10000, // When chunks are being buffered during upload, allow a maximum amount of time spent retrying...
	BUFFERED_CHUNK_WRITE_RETRY_DELAY_MS: 25, // Retry every ... ms
	CLAIM_ACCOUNT_CODE_LENGTH: 16
};

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
let argv = minimist(process.argv.slice(2));

// Fill config with command line arguments
CONFIG.IS_DEV_MODE = process.argv.includes("--dev");
CONFIG.SERVER_PORT = argv["port"];

// Print functions for the server (because it's formatted in a way thats obvious to the user)
function LogToConsole(message) {
	console.log(` > ${message}`);
}

function ErrorToConsole(message) {
	console.log(` > ERROR: ${message}`);
}

// Cryptography functions for server only (TODO: move elsewhere please)
function GenerateRandomSaltAsHexString(length) {
	return crypto.randomBytes(length).toString("hex");
}

function GenerateRandomAccountClaimCode(length) {
	const charSet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let code = "";

	for (let i = 0; i < length; i++) {
		const randomIndex = crypto.randomInt(charSet.length);
		code += charSet[randomIndex];
	}

	return code;
}

// Server program initialisation (TODO: app.js that does these checks and passes valid data to server.js! modular code plz, not a monolith)
{
	// Sanity checks (if failed, an error message will be printed and the program will pause indefinitely)
	async function BlockProgramExecution() {
		await new Promise(resolve => setTimeout(resolve, 1000000000));
	}

	if (typeof(CONFIG.SERVER_PORT) != "number") {
		ErrorToConsole("You did not specify a port number to run the server on. Please enter a port using --port");
		await BlockProgramExecution();
	}

	if (CONFIG.SERVER_PORT == undefined) {
		ErrorToConsole("You did not specify the port to use for the server. Please indicate using the --port argument when running the server.");
		await BlockProgramExecution();
	}

	// Initialise
	{
		let databaseDirectory = CONFIG.USER_DATABASE_SETTINGS.PARENT_DIRECTORY
		let databaseFilePath = path.join(databaseDirectory, CONFIG.USER_DATABASE_SETTINGS.FILE_NAME);

		// TODO: test absolute path database directory to see if it works

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

			// Define sequelize models
			var unclaimedUserModel = sequelize.define("unclaimedUser", {
				claimCode: { type:DataTypes.STRING, allowNull: true },
				storageQuota: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
				passwordPublicSalt: { type: DataTypes.STRING, allowNull: false },
				passwordPrivateSalt: { type: DataTypes.STRING, allowNull: false },
				masterKeySalt: { type: DataTypes.STRING, allowNull: false }
			}, {
				timestamps: false
			});
			
			var userModel = sequelize.define("user", {
				username: { type: DataTypes.STRING, allowNull: false, unique: true },
				passwordPublicSalt: { type: DataTypes.STRING, allowNull: false },
				passwordPrivateSalt: { type: DataTypes.STRING, allowNull: false },
				masterKeySalt: { type: DataTypes.STRING, allowNull: false },
				passwordHash: { type: DataTypes.STRING, allowNull: false },
				storageQuota: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
				// Storing claimCode prevents a scenario where a user can use one access code to create multiple accounts by making multiple claim account requests extremely quickly
				claimCode: { type:DataTypes.STRING, allowNull: false },
				// TODO: register date of user? (UTC)
			}, {
				timestamps: false
			})

			var userFilesystemModel = sequelize.define("userFilesystem", {
				// A file in the filesystem could also be a folder depending on the metadata JSON
				handle: { type: DataTypes.STRING, allowNull: false },
				virtualPath: { type: DataTypes.STRING, allowNull: false }, // Simply a series of handles separated by single forward slashes
				metadata: { type: DataTypes.BLOB, allowNull: true } // Encrypted, compressed JSON
			}, {
				timestamps: false
			});

			// Define association between user and userFilesystem
			userModel.hasMany(userFilesystemModel);
			userFilesystemModel.belongsTo(userModel);

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

			// TODO: temporarily create test data
			if (!databaseFileExists) {
				// Reserve one account for testing
				unclaimedUserModel.create({
					claimCode: GenerateRandomAccountClaimCode(CONFIG.CLAIM_ACCOUNT_CODE_LENGTH),
					storageQuota: 250000000,
					passwordPublicSalt: GenerateRandomSaltAsHexString(CONFIG.USER_DATA_SALT_LENGTH),
					passwordPrivateSalt: GenerateRandomSaltAsHexString(CONFIG.USER_DATA_SALT_LENGTH),
					masterKeySalt: GenerateRandomSaltAsHexString(CONFIG.USER_DATA_SALT_LENGTH)
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
*/

/* POSSIBLE EXPLOITS
	1. When claiming account, if two requests come to claim an access code at the same. blah blah.
	   anyways it should be fixed, please send two async requests from one client to test!
*/

// Create app
const app = express();

const MemoryStore = MemoryStoreLib(session);

const upload = multer({
	//dest: "./uploads" // TODO: config specify a path for uploads
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
		SESSION COOKIE FORMAT

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
		secure: CONFIG.IS_PRODUCTION_MODE, // Only use secure mode in production mode
		httpOnly: true
	}
}));

// Create rate limiters
const loginRateLimiter = rateLimit({
	windowMs: 30 * 1000, // Rate limit window of 30 seconds
	limit: 10, // 10 requests per window period
});

function logUserIn(req, username) {
	req.session.username = username,
	req.session.loggedIn = true;
}

function logUserOut(req) {
	req.session.username = "",
	req.session.loggedIn = false;
}

function getLoggedInUsername(req) {
	return req.session.username;
}

function isUserLoggedIn(req) {
	return (req.session.loggedIn == true ? true : false);
}

function ifUserLoggedInRedirectToTreasury(req, res, next) {
	if (CONFIG.IS_DEV_MODE) { // When developing, let user access all pages
		next();
		return;
	}

	if (isUserLoggedIn(req)) {
		res.redirect("/treasury");
	} else {
		next();
	}
}

function ifUserLoggedOutRedirectToLogin(req, res, next) {
	if (CONFIG.IS_DEV_MODE) { // When developing, let user access all pages
		next();
		return;
	}

	if (isUserLoggedIn(req) == false) {
		res.redirect("/login");
	} else {
		next();
	}
}

function ifUserLoggedOutSendForbidden(req, res, next) {
	if (isUserLoggedIn(req)) {
		next();
	} else {
		res.sendStatus(403);
	}
}

// API
app.get("/api/getpasswordhashsettings", async (req, res) => {
	res.json({
		parallelism: CONFIG.PW_HASH_SETTINGS.PARALLELISM,
		iterations: CONFIG.PW_HASH_SETTINGS.ITERATIONS,
		memorySize: CONFIG.PW_HASH_SETTINGS.MEMORY_SIZE,
		hashLength: CONFIG.PW_HASH_SETTINGS.HASH_LENGTH,
		saltLength: CONFIG.USER_DATA_SALT_LENGTH
	});
});

app.get("/api/username", async (req, res) => {
	if (isUserLoggedIn(req)) {
		res.send(req.session.username);
	} else {
		res.send("NOT LOGGED IN");
	}
});

// Uses same rate limiter as login
app.post("/api/claimaccount", loginRateLimiter, async (req, res) => {
	const { claimCode, username, password } = req.body;

	// Type checking
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
	const unclaimedUser = await unclaimedUserModel.findOne({ where: { claimCode: claimCode } });

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
		let user = await userModel.findOne({ where: { username: username }});

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
			parallelism: CONFIG.PW_HASH_SETTINGS.PARALLELISM,
			iterations: CONFIG.PW_HASH_SETTINGS.ITERATIONS,
			memorySize: CONFIG.PW_HASH_SETTINGS.MEMORY_SIZE,
			hashLength: CONFIG.PW_HASH_SETTINGS.HASH_LENGTH,
			outputType: "encoded"
		});
		
		if (typeof(passwordHash) != "string") {
			throw new Error("hash did not return string type!");
		}
		
		if (CONFIG.IS_DEV_MODE) {
			LogToConsole(`password: ${password}`)
			LogToConsole(`publicSalt: ${publicSalt}`);
			LogToConsole(`privateSalt: ${privateSalt}`);
			LogToConsole(`masterKeySalt: ${masterKeySalt}`);
			LogToConsole(`passwordHash: ${passwordHash}`);
		}

		// Double check if code has not been used at this stage. If it has, then it's concerning because the code was checked to be valid above.
		const existingUser = await userModel.findOne({ where: { claimCode: claimCode } });

		if (existingUser != null) {
			LogToConsole(`WARNING: A claim code of ${claimCode} has already been used to create a user and managed to get to the password hashing stage!`);
			res.json({ success: false, message: "Code already used!" });
			return;
		}

		// Remove unclaimed user entry
		await unclaimedUserModel.destroy({ where: { claimCode: claimCode } });

		// Create user
		await userModel.create({
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
	if (username.length > CONFIG.MAX_USERNAME_LENGTH || password.length > CONFIG.PW_HASH_SETTINGS.HASH_LENGTH * 2) {
		res.send({ success: false, message: "Bad request!" });
		return;
	}

	// Get user from database
	let user = await userModel.findOne({ where: { username: username } });

	// If the username does not exist or it has not been claimed yet, then fake the existance
	// of the account to the user. This prevents an exploit where someone could check if a 
	// username exists in the database.
	if (user == null) {
		if (CONFIG.IS_DEV_MODE)
			LogToConsole(`Requested username '${username}' doesn't exist!`);
		
		if (password.length > 0) {
			// TODO: possibly hash here just to slow down the server response to prevent some timing test exploit.
			res.send({ success: false, message: "Incorrect credentials!" });
		} else {
			// Generate a fake public password salt to lie about the existance of this username
			try {
				let fakePublicSalt = await argon2id({
					password: username,
					salt: CONFIG.SERVER_SECRET,
					parallelism: CONFIG.PW_HASH_SETTINGS.PARALLELISM,
					iterations: CONFIG.PW_HASH_SETTINGS.ITERATIONS,
					memorySize: CONFIG.PW_HASH_SETTINGS.MEMORY_SIZE,
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

// fileSize is the size in bytes of the final file that will be written to disk on the server
// i.e it must include extra bytes for magic numbers and chunk headers

function GenerateRandomFileTransferHandle() {
	const charSet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let code = "";

	// Generate a 32 character (TODO: put in config) random string that acts as a handle for file transfers
	for (let i = 0; i < 32; i++) {
		const randomIndex = crypto.randomInt(charSet.length);
		code += charSet[randomIndex];
	}

	return code;
}

// FILE UPLOAD API (TODO: PUT IN ANOTHER JS FILE PLZ)
let uploadTransferEntries = {};

// TODO: remove dead handles function (requested from the client everytime they load their page)
function createUploadTransferEntry(username, fileSize, chunkCount) {
	const handle = GenerateRandomFileTransferHandle();

	let data = {
		handle: handle,
		username: username,
		fileSize: fileSize,
		chunkCount: chunkCount,
		writtenBytes: 0, // Stores how many bytes have been written to the file
		prevWrittenChunkId: 0, // Helps ensure that chunks are written in the correct order
		transferFileDescriptor: null,
		destinationFilePath: "",
		mutex: new Mutex() // Used to prevent data races when accessing values from async functions/routes
	};
	
	uploadTransferEntries[handle] = data;
	return data;
}

// TODO: allow user to specify how many uploads they want to start (WITH A LIMIT)
// TODO: ensure user cannot create too many uploads at once. (e.g only 8 uploads can run in parallel and they must be finalised before another one starts)
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
	let uploadHandle = createUploadTransferEntry(username, fileSize, chunkCount);

	// Open new transfer destination file
	try {
		const destinationFile = `./uploads/${uploadHandle.handle}.txt`; // TODO: need a utility function for getting the path of the upload file automatically (based on the user's filesystem path)
		uploadHandle.destinationFilePath = destinationFile;
		
		fs.open(destinationFile, "w", (error, fileDescriptor) => {
			if (error)
				throw error;

			uploadHandle.transferFileDescriptor = fileDescriptor;

			// Append magic number + chunk count + chunk size
			const header = Buffer.alloc(12);
			header.set(ENCRYPTED_FILE_MAGIC_NUMBER, 0);
			header.set(encodeSignedIntAsFourBytes(chunkCount), 4);
			header.set(encodeSignedIntAsFourBytes(ENCRYPTED_CHUNK_FULL_SIZE), 8);

			fs.appendFile(fileDescriptor, header, (error) => {
				if (error) {
					throw error;
				} else {
					uploadHandle.writtenBytes = header.byteLength;
				}
			});

			LogToConsole("File opened and initialised successfully.");
		});
		
		res.json({ success: true,	message: "", handle: uploadHandle.handle });
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

	const destinationFilePath = transferEntry.destinationFilePath;
	const fileDescriptor = transferEntry.transferFileDescriptor;
	delete uploadTransferEntries[handle];

	// Try close the file
	fs.close(fileDescriptor, (error) => {
		if (error) {
			ErrorToConsole(`FAILED TO CLOSE FILE! fd: ${fileDescriptor} message: ${error}`);
			res.status(500).json({ success: false, message: "SERVER ERROR!" });
		}
	});

	// Try remove upload file
	fs.unlink(destinationFilePath, (error) => {
		if (error) {
			ErrorToConsole(`Cancel upload fs error: ${error}`);
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

	// Close the file
	fs.close(transferEntry.transferFileDescriptor, (error) => {
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
	const username = getLoggedInUsername(req);
	const handle = req.body.handle;
	const chunkId = parseInt(req.body.chunkId);
	const chunkBuffer = req.file.buffer;

	if (typeof(handle) != "string") {
		res.status(400).json({success: false, message: "handle must be a string!" });
		return;
	}

	if (chunkId == NaN) {
		res.status(400).json({success: false, message: "chunkId must be a valid number!" });
		return;
	}

	if (chunkBuffer == undefined) {
		res.status(400).json({ success: false, message: "no file buffer sent to server!" });
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

	// Check chunk size
	// Will fail if the chunk size does not match the config AND it isn't trying to write the remaining bytes of the file where
	// it makes sense that the chunkSize would be different AND it isn't the first chunk being uploaded
	const chunkSize = chunkBuffer.byteLength;
	const bytesLeftToWrite = transferEntry.fileSize - transferEntry.writtenBytes;

	// console.log(`${chunkSize} ${bytesLeftToWrite}`);

	if (chunkId != 0 && chunkSize != ENCRYPTED_CHUNK_FULL_SIZE && chunkSize != bytesLeftToWrite) {
		res.status(400).json({ success: false, message: "incorrect chunk size!" });
		return;
	}

	// LogToConsole(`Size: ${chunkSize} Distance: ${transferEntry.fileSize - transferEntry.writtenBytes}`);

	// Ensure user does not upload more data than they requested
	if (transferEntry.writtenBytes + chunkSize > transferEntry.fileSize) {
		res.status(413).json({ success: false, message: "wrote too much data!" });
		return;
	} else {
		transferEntry.writtenBytes += chunkSize;
	}

	const appendBufferToFile = async () => {
		const release = await transferEntry.mutex.acquire();

		try {
			LogToConsole(`Appending: ${chunkId}`);
			const error = await fs.promises.appendFile(transferEntry.destinationFilePath, chunkBuffer);

			if (error) {
				ErrorToConsole(`Append buffer to file error: ${error}`);
				res.status(500).json({ success: false, message: "Failed to upload chunk" }); // TODO: fail chunk function? prevent code repeating
			} else {
				res.json({ success: true, message: "" });
			}

			transferEntry.prevWrittenChunkId = chunkId;
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
		if (chunkIdDifference <= 1) {
			await appendBufferToFile();
		} else {
			LogToConsole(`buffered: ${chunkId} prev: ${prevWrittenChunkId}`);

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
});

// Serve pages
async function serveIndexHtml(req, res) {
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
