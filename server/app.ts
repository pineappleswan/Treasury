import express from "express";
import MemoryStoreLib from "memorystore"; // TODO: talk about why this is used + make it configurable
import multer from "multer";
import env from "./env";
import { TreasuryDatabase } from "./database/database";
import { loginRateLimiter } from "./utility/rateLimiters";

// API
import {
	startUploadApi,
  cancelUploadApi,
  finaliseUploadApi,
  uploadChunkApi
} from "./routes/api/uploads";

import {
	downloadChunkApi
} from "./routes/api/downloads";

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
import { getUsernameRoute, getStorageQuotaRoute, getStorageUsedRoute } from "./routes/api/getters";
import { createFolderRoute, getFilesystemRoute } from "./routes/api/filesystem";
import { loginRoute, claimAccountRoute, isLoggedInRoute, logoutRoute } from "./routes/api/login"
import { getFFmpegCoreWasmRoute, getFFmpegCoreJsRoute } from "./routes/cdn";

// Initialise treasury database singleton
TreasuryDatabase.initialiseInstance({
	databaseFilePath: env.USER_DATABASE_FILE_PATH
});

const database: TreasuryDatabase = TreasuryDatabase.getInstance();

// Initialise
const app = express();
const MemoryStore = MemoryStoreLib(session);
const multerUpload = multer();

// Middleware
app.use(compression({
	filter: (req: any, res: any) => {
		if (req.url == "/cdn/ffmpegcorewasm") {
			// Compress the ffmpeg wasm
			return true;
		} else {
			return compression.filter(req, res);
		}
	}
}));

app.use(cors());
app.use(express.static("./dist"));
app.use(express.raw({ type: "application/octet-stream", limit: "50mb" })); // Allow binary data
app.use(bodyParser.json({ limit: "5mb" })); // Parse 'application/json' + set json data limit
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
	store: new MemoryStore({
		checkPeriod: 1 * 3600 * 1000 // Prune expired entries every 1 hour
	}),
	name: "TREASURY_SESSION",
	secret: env.SECRET,
	resave: false,
	saveUninitialized: true,
	cookie: {
		sameSite: "strict",
		secure: env.SECURE_COOKIES,
		httpOnly: true
	}
}));

// API
app.get("/api/getusername", ifUserLoggedOutSendForbidden, getUsernameRoute);
app.get("/api/getstoragequota", ifUserLoggedOutSendForbidden, getStorageQuotaRoute);
app.get("/api/getstorageused", ifUserLoggedOutSendForbidden, getStorageUsedRoute);
app.post("/api/getfilesystem", ifUserLoggedOutSendForbidden, getFilesystemRoute); // Maybe rate limit on a reasonable amount (1 per 2 seconds)
app.get("/api/isloggedin", isLoggedInRoute);

app.post("/api/login", loginRateLimiter, loginRoute);
app.post("/api/logout", logoutRoute);
app.post("/api/claimaccount", loginRateLimiter, claimAccountRoute);

app.post("/api/transfer/startupload", ifUserLoggedOutSendForbidden, startUploadApi);
app.post("/api/transfer/cancelupload", ifUserLoggedOutSendForbidden, cancelUploadApi);
app.post("/api/transfer/finaliseupload", ifUserLoggedOutSendForbidden, finaliseUploadApi);
app.post("/api/transfer/uploadchunk", ifUserLoggedOutSendForbidden, multerUpload.single("data"), uploadChunkApi);
app.post("/api/transfer/downloadchunk", ifUserLoggedOutSendForbidden, downloadChunkApi);

app.post("/api/filesystem/createFolder", ifUserLoggedOutSendForbidden, createFolderRoute);

// CDN
app.get("/cdn/ffmpegcorewasm", ifUserLoggedOutSendForbidden, getFFmpegCoreWasmRoute);
app.get("/cdn/ffmpegcorejs", ifUserLoggedOutSendForbidden, getFFmpegCoreJsRoute);
//app.get("/cdn/ffmpegcoreworkerjs", ifUserLoggedOutSendForbidden, getFFmpegCoreWorkerJsRoute);

// Page routes
app.get("/login", ifUserLoggedInRedirectToTreasury, serveIndexHtml);
app.get("/claimaccount", ifUserLoggedInRedirectToTreasury, serveIndexHtml);
app.get("/treasury", ifUserLoggedOutRedirectToLogin, serveIndexHtml);
app.get("/404", serveIndexHtml);

// This is the last route so redirect user to the 404 not found page
app.use((req: any, res: any) => {
	res.status(404).redirect("/404");
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
