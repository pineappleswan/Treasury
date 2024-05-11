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
	requireLoggedIn,
	ifUserLoggedInRedirectToTreasury,
	ifUserLoggedOutRedirectToLogin
} from "./middleware/auth";

// Routes
import serveIndexHtml from "./routes/indexHtml";
import { getUsernameRoute, getStorageQuotaRoute, getStorageUsedRoute } from "./routes/api/getters";
import { createFolderRoute, getFilesystemRoute, editMetadataRoute } from "./routes/api/filesystem";
import { loginRoute, claimAccountRoute, isLoggedInRoute, logoutRoute } from "./routes/api/login"
import { getFFmpegCoreWasmRoute, getFFmpegCoreJsRoute } from "./routes/cdn";

// Initialise treasury database singleton
TreasuryDatabase.initialiseInstance({
	databaseFilePath: env.USER_DATABASE_FILE_PATH
});

const databaseInstance: TreasuryDatabase = TreasuryDatabase.getInstance();

// Initialise app
const app = express();
const MemoryStore = MemoryStoreLib(session);
const multerUpload = multer();

// Middleware
app.use(compression({
	filter: (req: any, res: any) => {
		if (req.url == "/cdn/ffmpegcorewasm") {
			// Ensure the ffmpeg wasm is compressed
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
app.get("/api/getusername", requireLoggedIn, getUsernameRoute);
app.get("/api/getstoragequota", requireLoggedIn, getStorageQuotaRoute);
app.get("/api/getstorageused", requireLoggedIn, getStorageUsedRoute);
app.post("/api/getfilesystem", requireLoggedIn, getFilesystemRoute);
app.get("/api/isloggedin", isLoggedInRoute);

app.post("/api/login", loginRateLimiter, loginRoute);
app.post("/api/logout", logoutRoute);
app.post("/api/claimaccount", loginRateLimiter, claimAccountRoute);

app.post("/api/transfer/startupload", requireLoggedIn, startUploadApi);
app.post("/api/transfer/cancelupload", requireLoggedIn, cancelUploadApi);
app.post("/api/transfer/finaliseupload", requireLoggedIn, finaliseUploadApi);
app.post("/api/transfer/uploadchunk", requireLoggedIn, multerUpload.single("data"), uploadChunkApi);
app.post("/api/transfer/downloadchunk", requireLoggedIn, downloadChunkApi);

app.post("/api/filesystem/createFolder", requireLoggedIn, createFolderRoute);
app.post("/api/filesystem/editmetadata", requireLoggedIn, editMetadataRoute);

// CDN
app.get("/cdn/ffmpegcorewasm", requireLoggedIn, getFFmpegCoreWasmRoute);
app.get("/cdn/ffmpegcorejs", requireLoggedIn, getFFmpegCoreJsRoute);
//app.get("/cdn/ffmpegcoreworkerjs", requireLoggedIn, getFFmpegCoreWorkerJsRoute);

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
		databaseInstance.close();
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
