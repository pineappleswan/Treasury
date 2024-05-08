import dotenv from "dotenv";
import env from "env-var";
import fs from "fs";
import minimist from "minimist";
import path from "path";
import { generateSecureRandomBytesAsHexString } from "../src/common/commonCrypto";

// Get the root directory of the project which is the parent directory of the parent directory of this env.ts file (i.e env.ts -> 'server' directory -> root directory)
const __dirname = path.dirname(import.meta.dirname);

// The path of the .env file
const configFilePath = "./.env";

// Create new .env file if none exists
if (!fs.existsSync(configFilePath)) {
  console.log(`Creating new .env file since none was found.`);

  try {
    const lines: string[] = [];

    lines.push(`PORT=3001`); // Default port of 3001
    lines.push(`SECRET=${generateSecureRandomBytesAsHexString(64)}`); // 64 bytes = 512 bits
    lines.push(`SECURE_COOKIES=true`);
    lines.push(`USER_DATABASE_FILE_PATH=./databases/userdata.db`);
    lines.push(`USER_FILE_STORAGE_PATH=./userfiles`);
    lines.push(`USER_UPLOAD_TEMPORARY_STORAGE_PATH=./uploads`);
    lines.push(`DEVELOPMENT_MODE=false`); // Only used to determine the path of index.html

    const str = lines.join("\n");  
    fs.writeFileSync(configFilePath, str);
  } catch (error) {
    throw error;
  }
}

// Load .env environment variables into process.env
dotenv.config({
  path: configFilePath
})

// Get environment variables
let PORT = env.get("PORT").required().asPortNumber();
let SECRET = env.get("SECRET").required().asString();
let SECURE_COOKIES = env.get("SECURE_COOKIES").required().asBool();
let USER_DATABASE_FILE_PATH = env.get("USER_DATABASE_FILE_PATH").required().asString();
let USER_FILE_STORAGE_PATH = env.get("USER_FILE_STORAGE_PATH").required().asString();
let USER_UPLOAD_TEMPORARY_STORAGE_PATH = env.get("USER_UPLOAD_TEMPORARY_STORAGE_PATH").required().asString();
let DEVELOPMENT_MODE = env.get("DEVELOPMENT_MODE").required().asBool();

// Override some options with cli arguments if provided
let argv = minimist(process.argv.slice(2));

if (argv.dev) // e.g --dev
  DEVELOPMENT_MODE = true;

if (argv.securecookies == "true") { // e.g --securecookies
  SECURE_COOKIES = true;
} else if (argv.securecookies == "false") {
  SECURE_COOKIES = false;
}

if (typeof(argv.port) == "number")
  PORT = argv.port;

// Secure cookies should be off in development mode
if (DEVELOPMENT_MODE)
  SECURE_COOKIES = false;

export default {
  PORT: PORT,
  SECRET: SECRET,
  SECURE_COOKIES: SECURE_COOKIES,
  USER_DATABASE_FILE_PATH: USER_DATABASE_FILE_PATH,
  USER_FILE_STORAGE_PATH: USER_FILE_STORAGE_PATH,
  USER_UPLOAD_TEMPORARY_STORAGE_PATH: USER_UPLOAD_TEMPORARY_STORAGE_PATH,
  DEVELOPMENT_MODE: DEVELOPMENT_MODE,
  __dirname: __dirname
};
