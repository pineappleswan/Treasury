import readline from "readline";
import { TreasuryDatabase } from "./database/database";

import {
	CommandContext,
	CommandFunction,
	helpCommand,
	exitCommand,
	newUserCommand,
	viewUsersCommand,
	viewUnclaimedUsersCommand
} from "./commands";

// TODO: prompting loop function for command validation where it has a message to prompt, and a callback that returns true if pass, and false if continue to prompt...
// TODO: command to delete unclaimedaccount via id/index
// TODO: delete unclaimed user code command
// TODO: delete files MUST check the file format first
// TODO: add confirmation message if there are transfers in progress when exiting

const commandFunctions: { [command: string]: CommandFunction } = {
	"exit": exitCommand,
	"help": helpCommand,
	"newuser": newUserCommand,
	"viewusers": viewUsersCommand,
	"viewunclaimedusers": viewUnclaimedUsersCommand
};

async function cli() {
	const readlineInterface = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	const databaseInstance: TreasuryDatabase = TreasuryDatabase.getInstance();

	const startQuestionLoop = async () => {
		while (true) {
			const questionPromise = new Promise((resolve, reject) => {
				readlineInterface.question("", async (answer: string) => {
					// Process command string
					let args = answer.split(" ");
					
					if (args.length == 0) {
						reject("You entered an invalid command.");
						return;
					}
					
					const command = args[0].toLowerCase();
					args.splice(0, 1); // Remove command from the arguments list
					
					// Call command function with arguments
					const commandFunction = commandFunctions[command];

					if (commandFunction != undefined) {
						const context: CommandContext = {
							database: databaseInstance
						};

						await commandFunction(resolve, reject, readlineInterface, args, context);
						resolve(true);
					} else {
						reject("Unknown command!");
						return;
					}
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

	// On SIGINT, confirm with the user that they want to shut the server down
	let lastSIGINT = 0;

	readlineInterface.on("SIGINT", async () => {
		const now = Date.now();

		if (now - lastSIGINT > 2000) {
			lastSIGINT = now;
			console.log(`Press CTRL + C again to shutdown the server.`);
		} else {
			process.exit(0);
		}
	});

	console.log("\nYou may now enter commands. Enter 'help' if you need help.");
	startQuestionLoop();
}

export default cli;
