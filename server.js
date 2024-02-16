// const jsonWebToken = require("jsonwebtoken"); if not needed, uninstall
import express from "express";
import cors from "cors";
import compression from "compression";
import fs from "fs";
import path from "path";
import session from "express-session";
import bodyParser from "body-parser";
import crypto from "crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { utf8ToBytes } from "@noble/ciphers/utils";
import MemoryStoreLib from "memorystore";
import rateLimit from "express-rate-limit";
const MemoryStore = MemoryStoreLib(session);
const app = express();

// Define __dirname since this server is an ES module
const __dirname = import.meta.dirname;

const CONFIG = {
	HASH_SETTINGS: {
		PARALLELISM: 2,
		ITERATIONS: 8,
		MEMORY_SIZE: 32 * 1024, // 32 MiB,
		HASH_LENGTH: 32, // 32 bytes
	},
	IS_DEV_MODE: process.argv.includes("--dev"),
	SERVER_PORT: 3001,
	SESSION_SECRET: crypto.randomBytes(64).toString("hex"),
	MAX_USERNAME_LENGTH: 64,
	MAX_PASSWORD_LENGTH: 64
};

/* TODO
		1. when generating a user's public, private and master key salt, do a check to make sure they arent the same (should never be the same anyways but just do it)
		2. when user is renaming a file, just wait for response from server and change file name on client
		3. client needs a theme for tailwind or something. some central theme selector
*/

/* ENCRYPTION TEST
{
		const key = crypto.randomBytes(32);
		const nonce = crypto.randomBytes(24);
		const chacha = xchacha20poly1305(key, nonce);
		const data = utf8ToBytes("greetings, friend");
		const cipherText = chacha.encrypt(data);

		//cipherText[4] = 123; // tamper with ciphertext as a test

		try {
				const plainText = chacha.decrypt(cipherText);

				console.log(cipherText);
				console.log(plainText);
		} catch (error) {
				if (error.message.includes("invalid tag")) {
						console.error("Failed to decrypt! Data was corrupted!");
				}
		}
}
*/

// const PAGES_PATH = (CONFIG.IS_PRODUCTION_MODE ? "dist" : "src");
// const INDEX_HTML_PATH = path.join("dist", "index.html"); // (CONFIG.IS_PRODUCTION_MODE ? path.join("dist", "index.html") : "index.html");

// Middleware
app.use(compression());
app.use(express.static("./dist"));
app.use(bodyParser.json()); // Parse 'application/json'
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
	limit: 10, // 10 requests per window period (equivalent to 5 login attempts per window)
});

function logUserIn(req, username) {
	req.session.username = username,
		req.session.loggedIn = true;
}

function logUserOut(req) {
	req.session.username = "",
		req.session.loggedIn = false;
}

function isUserLoggedIn(req) {
	return (req.session.loggedIn == true ? true : false);
}

function ifUserLoggedInRedirectToTreasury(req, res, next) {
	// console.log(`Logged in: ${isUserLoggedIn(req)}`);

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
	// console.log(`Logged in: ${isUserLoggedIn(req)}`);

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

// API
app.get("/api/test", (req, res) => {
	res.send({
		"message": "hello, this is the data."
	});
});

app.post("/api/login", loginRateLimiter, async (req, res) => {
	// Generate private key hash (TODO: MOVE TO DATABASE OF COURSE!!!)
	/*
	let privateSaltBuffer   = Buffer.from("12345678123456781234567812345678"); //crypto.randomBytes(32); TODO: this is only for authentication, store in DB

	const hash = await argon2id({
			password: password,
			salt: privateSaltBuffer,
			parallelism: CONFIG.HASH_SETTINGS.PARALLELISM,
			iterations: CONFIG.HASH_SETTINGS.ITERATIONS,
			memorySize: CONFIG.HASH_SETTINGS.MEMORY_SIZE,
			hashLength: CONFIG.HASH_SETTINGS.HASH_LENGTH,
			outputType: "encoded"
	});
	*/

	if (isUserLoggedIn(req)) {
		res.sendStatus(403); // Forbidden, since already logged in
		return;
	}

	const { username,	password } = req.body;
	console.log(`U: ${username} P: ${password}`);

	// Check if username and password was supplied
	if (typeof (username) != "string" || typeof (password) != "string") {
		res.send({
			success: false,
			message: "Bad request!"
		});

		return;
	}

	// Length checks
	if (username.length > CONFIG.MAX_USERNAME_LENGTH || password.length > CONFIG.MAX_PASSWORD_LENGTH) {
		res.send({
			success: false,
			message: "Bad request!"
		});

		return;
	}

	// Check if username exists
	if (username != "test") {
		res.send({
			success: false,
			message: "Incorrect credentials!"
		});

		return;
	}

	// If the password is empty, send the requested user's public salt
	if (password.length == 0) {
		let publicSaltBuffer = Buffer.from("abcdefghijklmnopqrstuvwxyz123456"); //crypto.randomBytes(32);
		let publicSaltArray = Array.from(publicSaltBuffer);

		res.send({
			success: true,
			publicSalt: publicSaltArray
		});

		return;
	}

	// Authenticate user
	const verified = await argon2Verify({
		password: password,
		hash: "$argon2id$v=19$m=32768,t=8,p=2$MTIzNDU2NzgxMjM0NTY3ODEyMzQ1Njc4MTIzNDU2Nzg$JI3yeZpi/jSxnpQ0xgX6oo4EbKJxDC63U63YjlWNbSg"
	});

	if (verified) {
		let masterKeySaltBuffer = Buffer.from("12121212121212121212121212121212");

		logUserIn(req, "test"); // TODO

		res.send({
			success: true,
			message: "Success!",
			masterKeySalt: Array.from(masterKeySaltBuffer)
		});
	} else {
		res.send({
			success: false,
			message: "Incorrect credentials!"
		});
	}
});

app.post("/api/logout", (req, res) => {
	logUserOut(req);
	res.sendStatus(200);
});

app.get("/api/video", (req, res) => {
	res.sendFile(path.join(__dirname, "video", "video.m3u8"));
});

app.get("/api/videodata", (req, res) => {
	res.sendFile(path.join(__dirname, "video", "video.ts"));
});

app.get("/api/isloggedin", (req, res) => {
	res.send({
		value: isUserLoggedIn(req)
	});
});

// Serve pages
function serveIndexHtml(req, res) {
	if (CONFIG.IS_DEV_MODE) {
		res.sendFile(path.join(__dirname, "index.html"));
	} else {
		res.sendFile(path.join(__dirname, "dist", "index.html"));
	}
}

app.get("/login", ifUserLoggedInRedirectToTreasury, serveIndexHtml);
app.get("/createaccount", ifUserLoggedInRedirectToTreasury, serveIndexHtml);
app.get("/treasury", ifUserLoggedOutRedirectToLogin, serveIndexHtml);
app.get("/404", serveIndexHtml); // 404 error page

// This is the last route and so no other routes were taken, so redirect user to the 404 error page
app.use((req, res) => {
	res.redirect("/404");
})

// Start server
app.listen(CONFIG.SERVER_PORT, () => {
	// console.log(`Session secret: ${CONFIG.SESSION_SECRET}`);

	if (CONFIG.IS_DEV_MODE) {
		console.log("Started in DEVELOPMENT mode.");
	} else {
		console.log("Started in PRODUCTION mode.");
	}

	console.log(`Server now listening on port ${CONFIG.SERVER_PORT}`);
});
