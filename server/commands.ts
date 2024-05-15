import readline from "readline";
import CONSTANTS from "../src/common/constants";
import { generateSecureRandomBytesAsHexString, generateSecureRandomAlphaNumericString } from "../src/common/commonCrypto";
import { TreasuryDatabase, UnclaimedUserInfo, UserInfo } from "./database/database";

type CommandContext = {
	database: TreasuryDatabase;
}

type CommandFunction = (
	resolve: (value: unknown) => void,
	reject: (reason?: any) => void,
	readlineInterface: readline.Interface,
	args: string[],
	context: CommandContext
) => Promise<void>;

async function helpCommand(
	resolve: (value: unknown) => void,
	reject: (reason?: any) => void,
	readlineInterface: readline.Interface,
	args: string[],
	context: CommandContext
) {
	console.log();
	console.log("Commands:");
	console.log("  exit - Shuts down the server");
	console.log("  newuser [storageQuota, e.g 512MB, 32GB, 32GiB] - Creates a new user with a specified storage quota. It can be claimed with the returned claim code.");
	console.log("  viewusers - Shows all the users that exist.");
	console.log("  viewunclaimedusers - Shows all the unclaimed users that exist.");
	console.log();
}

async function exitCommand(
	resolve: (value: unknown) => void,
	reject: (reason?: any) => void,
	readlineInterface: readline.Interface,
	args: string[],
	context: CommandContext
) {
	process.exit(0);
}

async function newUserCommand(
	resolve: (value: unknown) => void,
	reject: (reason?: any) => void,
	readlineInterface: readline.Interface,
	args: string[],
	context: CommandContext
) {
	if (args.length == 0) {
		reject("You did not specify the storage quota!");
		return;
	} else if (args.length > 1) {
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
	
	const storageQuotaStr = args[0].toLowerCase().trim();
	
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

	// Confirm with user
	const confirmed = await new Promise<boolean>(resolve => {
		readlineInterface.question(`Create new user with a storage quota of ${storageQuota.toLocaleString()} bytes? (y/N) `, (answer: string) => {
			answer = answer.toLowerCase().trim();

			if (answer == "y") {
				resolve(true);
			} else {
				resolve(false);
			}
		});
	});

	if (!confirmed) {
		reject("Cancelled.");
		return;
	}

	try {
		const claimCode = generateSecureRandomAlphaNumericString(CONSTANTS.CLAIM_ACCOUNT_CODE_LENGTH);

		const newUnclaimedUserInfo: UnclaimedUserInfo = {
			claimCode: claimCode,
			storageQuota: storageQuota,
			passwordPublicSalt: generateSecureRandomBytesAsHexString(CONSTANTS.USER_DATA_SALT_BYTE_LENGTH),
			passwordPrivateSalt: generateSecureRandomBytesAsHexString(CONSTANTS.USER_DATA_SALT_BYTE_LENGTH),
			masterKeySalt: generateSecureRandomBytesAsHexString(CONSTANTS.USER_DATA_SALT_BYTE_LENGTH)
		};
		
		context.database.createNewUnclaimedUser(newUnclaimedUserInfo);
		console.log(`Successfully created user. Claim code: ${claimCode}`);
		resolve(true);
	} catch (error) {
		console.error(error);
		reject();
	}
}

async function viewUsersCommand(
	resolve: (value: unknown) => void,
	reject: (reason?: any) => void,
	readlineInterface: readline.Interface,
	args: string[],
	context: CommandContext
) {
	const allUsers = context.database.getAllUsers();
	
	console.log("\nindex | username");
	allUsers.forEach((info: UserInfo, index) => {
		console.log(`${index.toString().padEnd(7, " ")} ${info.username}`);
	});
	console.log();

	resolve(true);
}

async function viewUnclaimedUsersCommand(
	resolve: (value: unknown) => void,
	reject: (reason?: any) => void,
	readlineInterface: readline.Interface,
	args: string[],
	context: CommandContext
) {
	const allUnclaimedUsers = context.database.getAllUnclaimedUsers();
	
	console.log("\nindex | claim code");
	allUnclaimedUsers.forEach((info: UnclaimedUserInfo, index) => {
		console.log(`${index.toString().padEnd(7, " ")} ${info.claimCode}`);
	});
	console.log();

	resolve(true);
}

export type {
	CommandFunction,
	CommandContext
}

export {
	helpCommand,
	exitCommand,
	newUserCommand,
	viewUsersCommand,
	viewUnclaimedUsersCommand
}
