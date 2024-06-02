use console::pad_str_with;
use tokio::sync::{broadcast, Mutex};
use std::sync::Arc;
use dialoguer::{theme::ColorfulTheme, Confirm, Input, Select};
use console::style;
use crate::AppState;

use crate::util::{generate_claim_code, parse_byte_size_str};
use crate::constants;

pub async fn interactive_shell(shared_app_state: Arc<Mutex<AppState>>) {
	// Recommend user to use the 'exit' command to close the server when they press CTRL+C
	ctrlc::set_handler(|| {
		println!("Received CTRL+C.");
	})
	.expect("Error setting CTRL+C handler.");

	// TODO: this is preferred but due to the issue with stopping the listening for user input, recommending
	// the user to just type 'exit' is better...
	/*
	let ctrl_c_signal = async {
		signal::ctrl_c()
			.await
			.expect("Failed to install CTRL+C handler.");

		println!("Received CTRL+C signal. Stopping server...");
	};
	*/

	// Start interactive shell
	let (stop_shell_tx, mut stop_shell_rx) = broadcast::channel::<()>(1);

	tokio::spawn(async move {
		let shell_theme = ColorfulTheme::default();

		loop {
			let command: String = Input::with_theme(&shell_theme)
				.interact_text()
				.unwrap();

			let command_lowercase = command.to_lowercase();

			// Immediately handle the exit command first
			if command_lowercase == "exit" {
				let _ = stop_shell_tx.send(());
				break;
			}

			// Handle commands (TODO: better way with map string to function? + levenshtein distance for "did you mean this command" functionality)
			if command_lowercase == "newcode" {
				new_claim_code_command(shared_app_state.clone()).await;
			} else if command_lowercase == "list" {
				list_command(shared_app_state.clone()).await;
			} else {
				println!("Unknown command.");
			}
		}
	});

	tokio::select! {
		// _ = ctrl_c_signal => shell.abort(),
		_ = stop_shell_rx.recv() => println!("Shell stopping.")
	}
}

// Commands

async fn new_claim_code_command(shared_app_state: Arc<Mutex<AppState>>) {
	let shell_theme = ColorfulTheme::default();

	let storage_quota_str = Input::with_theme(&shell_theme)
		.with_prompt("Storage quota")
		.validate_with(|input: &String| {
			parse_byte_size_str(input.clone())
				.map(|_| ())
				.map_err(|err| err.to_string())
		})
		.interact_text()
		.unwrap();

	if let Ok(storage_quota) = parse_byte_size_str(storage_quota_str) {
		// Confirm creation of new claim code
		let bytes_formatted_str = bytesize::to_string(storage_quota, false);

		let confirmed = Confirm::with_theme(&shell_theme)
			.with_prompt(format!("Create new claim code with a storage quota of {} bytes?", bytes_formatted_str))
			.wait_for_newline(true)
			.interact()
			.unwrap();

		if confirmed {
			// Generate claim code
			let claim_code = generate_claim_code();

			// Insert into database
			let mut app_state = shared_app_state.lock().await;
			let database = app_state.database.as_mut().unwrap();

			match database.insert_new_claim_code(claim_code.as_str(), storage_quota) {
				Ok(_) => println!("New claim code: {}", style(claim_code).cyan().bold()),
				Err(_) => eprintln!("Failed to create new claim code.")
			};
		}
	} else {
		eprintln!("Storage quota string passed validation but couldn't be parsed! This shouldn't happen!");
	}
}

async fn list_command(shared_app_state: Arc<Mutex<AppState>>) {
	let shell_theme = ColorfulTheme::default();

	// Ask user to select what type of info to list
	let chosen_info_type = Select::with_theme(&shell_theme)
		.with_prompt("Info to list")
		.items(&["Available claim codes", "All registered users"])
		.default(0)
		.interact()
		.unwrap();

	// Acquire database
	let mut app_state = shared_app_state.lock().await;
	let database = app_state.database.as_mut().unwrap();

	if chosen_info_type == 0 {
		// Get available claim codes from the database
		let claim_codes = match database.get_available_claim_codes() {
			Ok(data) => data,
			Err(_) => return
		};

		// Print message and return if no claim codes are available.
		if claim_codes.is_empty() {
			println!("{}", style("No claim codes found.").yellow().bold());
			return;
		}

		// Specify the claim code column width so that the "code" title can be padded correctly
		let code_column_width = constants::CLAIM_CODE_LENGTH + 1;
		
		// Create text
		let mut output_text = String::new();
	
		let mut header_text = String::new();
		header_text.push_str(pad_str_with("Claim code", code_column_width, console::Alignment::Left, None, ' ').as_ref());
		header_text.push_str("| Storage quota\n");
	
		output_text.push_str(style(header_text).cyan().bold().to_string().as_str());
	
		// Add rows
		for code in claim_codes {
			let claim_code_str = pad_str_with(code.claim_code.as_str(), code_column_width + 2, console::Alignment::Left, None, ' ');
			let storage_quota_str = bytesize::to_string(code.storage_quota, false);
	
			output_text.push_str(format!("{}{}\n", claim_code_str.as_ref(), storage_quota_str).as_str());
		};
	
		// Print info to output
		println!("\n{}", output_text);
	} else if chosen_info_type == 1 {
		// Get all users in the database
		let all_users = match database.get_all_users() {
			Ok(data) => data,
			Err(_) => return
		};

		if all_users.is_empty() {
			println!("{}", style("No users found.").yellow().bold());
			return;
		}

		// Get the max username string length to adjust the column width
		let max_username_length = all_users.iter()
			.map(|user| user.username.len())
			.max()
			.unwrap();

		// Create text
		let mut output_text = String::new();
	
		let mut header_text = String::new();
		header_text.push_str(pad_str_with("Username", max_username_length + 1, console::Alignment::Left, None, ' ').as_ref());
		header_text.push_str("| Storage quota\n");
		
		output_text.push_str(style(header_text).cyan().bold().to_string().as_str());
	
		// Add rows
		for user in all_users {
			let username_str = pad_str_with(user.username.as_str(), max_username_length + 3, console::Alignment::Left, None, ' ');

			if let Some(storage_quota) = user.storage_quota {
				let storage_quota_str = bytesize::to_string(storage_quota, false);
				output_text.push_str(format!("{}{}\n", username_str.as_ref(), storage_quota_str).as_str());
			} else {
				output_text.push_str(format!("{}{}\n", username_str.as_ref(), "N/A").as_str());
			}
		};
	
		// Print info to output
		println!("\n{}", output_text);
	}
}
