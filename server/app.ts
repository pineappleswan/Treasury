// import { ed25519, x25519 } from "@noble/curves/ed25519"

import express from "express";
import MemoryStoreLib from "memorystore"; // TODO: talk about why this is used
import multer from "multer";
import { TreasuryDatabase } from "./database";
import env from "./env";
import { loginRateLimiter } from "./utility/rateLimiters";

// Middleware
import cors from "cors";
import compression from "compression";
import session from "express-session";
import bodyParser from "body-parser";

import {
	ifUserLoggedOutSendForbidden,
	ifUserLoggedInRedirectToTreasury,
	ifUserLoggedOutRedirectToLogin
} from "./middleware/authentication";

// Routes
import serveIndexHtml from "./routes/indexHtml";
import { getUsernameRoute } from "./routes/api/getters";

import { loginRoute,
	claimAccountRoute,
	isLoggedInRoute,
	logoutRoute
} from "./routes/api/login"

import {
	startUploadApi,
  cancelUploadApi,
  cancelAllUploadsApi,
  finaliseUploadApi,
  uploadChunkApi
} from "./routes/api/uploads";

// Initialise treasury database singleton
TreasuryDatabase.initialiseInstance({
	databaseFilePath: env.USER_DATABASE_FILE_PATH
});

const database: TreasuryDatabase = TreasuryDatabase.getInstance();

// Create app
const app = express();
const MemoryStore = MemoryStoreLib(session);
const multerUpload = multer();

// Middleware
app.use(compression());
app.use(cors());
app.use(express.static("./dist"));
app.use(express.raw({ type: "application/octet-stream", limit: "5mb" })); // Allow binary data
app.use(bodyParser.json({ limit: "5mb" })); // Parse 'application/json' + set json data limit
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
	/*
		SESSION COOKIE FORMAT (TODO: types? req.session as UserSession for example)

		{
			username: string,
			loggedIn: boolean
		}
	*/
	store: new MemoryStore({
		checkPeriod: 1 * 3600 * 1000 // Prune expired entries every 1 hour
	}),
	name: "TREASURY_SESSION",
	secret: env.SECRET,
	resave: false,
	saveUninitialized: true,
	cookie: {
		sameSite: "lax",
		secure: env.SECURE_COOKIES,
		httpOnly: true
	}
}));

// TODO: ensure user cannot create too many uploads at once. (e.g only 8 uploads can run in parallel and they must be finalised before another one starts)
// TODO: make async! (everything should be async?)

// API

app.get("/api/getusername", getUsernameRoute);
app.get("/api/isloggedin", isLoggedInRoute);

app.post("/api/login", loginRateLimiter, loginRoute);
app.post("/api/logout", logoutRoute);
app.post("/api/claimaccount", loginRateLimiter, claimAccountRoute);

app.post("/api/transfer/startupload", ifUserLoggedOutSendForbidden, startUploadApi);
app.post("/api/transfer/cancelupload", ifUserLoggedOutSendForbidden, cancelUploadApi);
app.post("/api/transfer/cancelalluploads", ifUserLoggedOutSendForbidden, cancelAllUploadsApi);
app.post("/api/transfer/finaliseupload", ifUserLoggedOutSendForbidden, finaliseUploadApi);
app.post("/api/transfer/uploadchunk", ifUserLoggedOutSendForbidden, multerUpload.single("data"), uploadChunkApi);

// Page routes
app.get("/login", ifUserLoggedInRedirectToTreasury, serveIndexHtml);
app.get("/claimaccount", ifUserLoggedInRedirectToTreasury, serveIndexHtml);
app.get("/treasury", ifUserLoggedOutRedirectToLogin, serveIndexHtml);
app.get("/404", serveIndexHtml);

// This is the last route so redirect user to the 404 not found page
app.use((req: any, res: any) => {
	res.redirect("/404");
})

// App cleanup events
let ranCleanup = false; // Prevents CleanupApp() from being called more than once

async function CleanupApp() {
	if (ranCleanup)
		return;

	ranCleanup = true;
	
	try {
		console.log("Closing database...");
		database.close();
	} catch (error) {
		console.error(`Failed to close database for reason: ${error}`);
	}

	console.log("Server closed.");
}

process.on("exit", (code) => {
	console.log(`Process will exit with code: ${code}`);
	CleanupApp();
});

process.on("SIGINT", () => {
	console.log(`Received SIGINT. Exiting...`);
	CleanupApp();
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.log(`Received SIGTERM. Exiting...`);
	CleanupApp();
	process.exit(0);
});

export default app;
