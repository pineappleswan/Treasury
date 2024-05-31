use console::pad_str_with;
use tokio::signal;
use tokio::sync::{broadcast, Mutex};
use std::sync::Arc;
use dialoguer::{theme::ColorfulTheme, Confirm, Input, Select};
use num_format::{Locale, ToFormattedString};
use crate::AppState;

#[path = "util.rs"] mod util;
use util::{parse_byte_size_str, secure_random_alphanumeric_str};

#[path = "constants.rs"] mod constants;

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

	let shell = tokio::spawn(async move {
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
    let bytes_formatted_str = storage_quota.to_formatted_string(&Locale::en);

    let confirmed = Confirm::with_theme(&shell_theme)
      .with_prompt(format!("Create new claim code with a storage quota of {} bytes?", bytes_formatted_str))
      .wait_for_newline(true)
      .interact()
      .unwrap();

    if confirmed {
      // Generate claim code
      let claim_code = secure_random_alphanumeric_str(constants::CLAIM_CODE_LENGTH);

      // Insert into database
      let mut app_state = shared_app_state.lock().await;
      let database = app_state.database.as_mut().unwrap();

      match database.insert_new_claim_code(claim_code.as_str(), storage_quota) {
        Ok(_) => println!("New claim code: {}", console::style(claim_code).cyan().bold()),
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
      Ok(info) => info,
      Err(_) => return
    };
  
    // Specify the claim code column width so that the "code" title can be padded correctly
    let code_column_width = constants::CLAIM_CODE_LENGTH + 1;
    
    // Create text
    let mut output_text = String::new();
  
    let mut header_text = String::new();
    header_text.push_str(pad_str_with("Claim code", code_column_width, console::Alignment::Left, None, ' ').as_ref());
    header_text.push_str("| Storage quota in bytes\n");
  
    output_text.push_str(console::style(header_text).cyan().bold().to_string().as_str());
  
    // Add rows
    for code in claim_codes {
      let claim_code_str = pad_str_with(code.claim_code.as_str(), code_column_width + 2, console::Alignment::Left, None, ' ');
      let storage_quota_str = code.storage_quota.to_formatted_string(&Locale::en);
  
      output_text.push_str(format!("{}{}\n", claim_code_str.as_ref(), storage_quota_str).as_str());
    };
  
    // Print info to output
    println!("\n{}", output_text);
  } else if chosen_info_type == 1 {
    println!("NOT IMPLEMENTED!");
  }
}
