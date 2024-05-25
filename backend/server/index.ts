import fs from "fs";
import env from "./env";
import app from "./app";
import cli from "./cli";

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
