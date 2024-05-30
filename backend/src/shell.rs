use tokio::sync::{broadcast, Mutex};
use std::sync::Arc;
use dialoguer::{theme::ColorfulTheme, Confirm, Input};
use num_format::{Locale, ToFormattedString};
use crate::AppState;

#[path = "util.rs"] mod util;
use util::{parse_byte_size_str, secure_random_alphanumeric_str};

#[path = "constants.rs"] mod constants;

pub async fn interactive_shell(shared_app_state: Arc<Mutex<AppState>>) {
  /*
	let ctrl_c = async {
		signal::ctrl_c()
			.await
			.expect("Failed to install CTRL+C handler.");

		println!("Received CTRL+C signal. Stopping server...");
	};
  */

  /*
	#[cfg(unix)]
	let terminate = async {
		signal::unix::signal(signal::unix::SignalKind::termiate())
			.expect("Failed to install unix signal handler.")
			.recv()
			.await;
	};

	#[cfg(not(unix))]
	let terminate = std::future::pending::<()>();
  */

  // Recommend user to use the 'exit' command to close the server when they press CTRL+C
  ctrlc::set_handler(|| {
    println!("Received CTRL+C. Enter 'exit' to close the server.");
  }).expect("Error setting CTRL+C handler.");

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
      if command_lowercase == "newuser" {
        new_claim_code(shared_app_state.clone()).await;
      } else {
        println!("Unknown command.");
      }
		}
	});

	tokio::select! {
		_ = stop_shell_rx.recv() => {
			println!("Shell stopping.");
		}
	}
}

// Commands

async fn new_claim_code(shared_app_state: Arc<Mutex<AppState>>) {
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
        Ok(_) => println!("New claim code: {}", console::style(claim_code).cyan()),
        Err(_) => eprintln!("Failed to create new claim code.")
      };
    }
  } else {
    eprintln!("Storage quota string passed validation but couldn't be parsed! This shouldn't happen!");
  }
}
