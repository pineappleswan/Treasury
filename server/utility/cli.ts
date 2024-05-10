import readline from "readline";
import CONSTANTS from "../../src/common/constants";
import { generateSecureRandomBytesAsHexString, generateSecureRandomAlphaNumericString } from "../../src/common/commonCrypto";
import { TreasuryDatabase, UnclaimedUserInfo, UserInfo } from "../database/database";

const database: TreasuryDatabase = TreasuryDatabase.getInstance();

// TODO: prompting loop function for command validation where it has a message to prompt, and a callback that returns true if pass, and false if continue to prompt...
// TODO: command to delete unclaimedaccount via id/index

async function cli() {
	const readlineInterface = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	const startQuestionLoop = async () => {
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
						console.log("  exit - Shuts down the server");
						console.log("  newuser [storageQuota, e.g 512MB, 32GB, 32GiB] - Creates a new user with a specified storage quota. It can be claimed with the returned claim code.");
						console.log("  viewusers - Shows all the users that exist.");
						console.log("  viewunclaimedusers - Shows all the unclaimed users that exist.");
						console.log();
	
						resolve(true);
					} else if (command == "exit") {
						// TODO: add confirmation message if there are transfers in progress
						process.exit(0);
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
							const claimCode = generateSecureRandomAlphaNumericString(CONSTANTS.CLAIM_ACCOUNT_CODE_LENGTH);
	
							const newUnclaimedUserInfo: UnclaimedUserInfo = {
								claimCode: claimCode,
								storageQuota: storageQuota,
								passwordPublicSalt: generateSecureRandomBytesAsHexString(CONSTANTS.USER_DATA_SALT_BYTE_LENGTH),
								passwordPrivateSalt: generateSecureRandomBytesAsHexString(CONSTANTS.USER_DATA_SALT_BYTE_LENGTH),
								masterKeySalt: generateSecureRandomBytesAsHexString(CONSTANTS.USER_DATA_SALT_BYTE_LENGTH)
							};
							
							database.createNewUnclaimedUser(newUnclaimedUserInfo);
							console.log(`Successfully created user. Claim code: ${claimCode}`);
							resolve(true);
						} catch (error) {
							console.error(error);
							reject();
						}
					} else if (command == "viewusers") {
						const allUsers = database.getAllUsers();
	
						console.log("index | username");
						allUsers.forEach((info: UserInfo, index) => {
							console.log(`${index.toString().padEnd(7, " ")} ${info.username}`);
						});
						console.log();
	
						resolve(true);
					} else if (command == "viewunclaimedusers") {
						const allUnclaimedUsers = database.getAllUnclaimedUsers();
	
						console.log("index | claim code");
						allUnclaimedUsers.forEach((info: UnclaimedUserInfo, index) => {
							console.log(`${index.toString().padEnd(7, " ")} ${info.claimCode}`);
						});
						console.log();
	
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
	};

	// On SIGINT, notify the user how they should shut it down.
	readlineInterface.on("SIGINT", async () => {
		console.log(`Type 'exit' to shutdown the server.`);
	});

	console.log("\nYou may now enter commands. Enter 'help' if you need help.");
	startQuestionLoop();
}

export default cli;
