use tokio::sync::{broadcast, Mutex};
use std::sync::Arc;
use dialoguer::{theme::ColorfulTheme, Confirm, Input, Select};
use console::style;
use std::cmp;
use log::{info, error};
use crate::AppState;

use crate::util::{generate_claim_code, parse_byte_size_str};
use crate::constants;

pub async fn interactive_shell(shared_app_state: Arc<Mutex<AppState>>) {
  // Recommend user to use the 'exit' command to close the server when they press CTRL+C
  ctrlc::set_handler(|| {
    println!("Received CTRL+C. Enter 'exit' to stop the server.");
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
        println!("{}", style("Unknown command.").yellow());
      }
    }
  });

  tokio::select! {
    // _ = ctrl_c_signal => shell.abort(),
    _ = stop_shell_rx.recv() => info!("Shell stopping.")
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

  let storage_quota = parse_byte_size_str(storage_quota_str).expect("The storage quota string is already validated!");

  // Confirm creation of new claim code
  let bytes_formatted_str = bytesize::to_string(storage_quota, false);

  let confirmed = Confirm::with_theme(&shell_theme)
    .with_prompt(format!("Create new claim code with a storage quota of {} bytes?", bytes_formatted_str))
    .wait_for_newline(true)
    .interact()
    .unwrap();

  if !confirmed {
    return;
  }

  // Generate claim code
  let claim_code = generate_claim_code();

  // Insert into database
  let mut app_state = shared_app_state.lock().await;
  let database = app_state.database.as_mut().unwrap();

  match database.insert_new_claim_code(claim_code.as_str(), storage_quota) {
    Ok(_) => println!("New claim code: {}", style(claim_code).cyan().bold()),
    Err(_) => error!("Failed to create new claim code.")
  };
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
      println!("{}", style("No claim codes found.").yellow());
      return;
    }

    // Create text
    let mut output_text = String::new();

    let header_text = format!("{:pad$} | Storage quota\n", "Claim code", pad = constants::CLAIM_CODE_LENGTH);

    output_text.push_str(style(header_text).cyan().bold().to_string().as_str());
  
    // Add rows
    for code in claim_codes {
      output_text.push_str(
        format!(
          "{}   {}\n",
          code.claim_code,
          bytesize::to_string(code.storage_quota, false)
        ).as_str()
      );
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
      println!("{}", style("No users found.").yellow());
      return;
    }

    // Get the max username string length to adjust the column width
    let max_username_length = all_users.iter()
      .map(|user| user.username.len())
      .max()
      .unwrap();

    // Create output text
    let mut output_text = String::new();
  
    let header_text = format!("{:pad$} | Storage quota\n", "Username", pad = max_username_length);
    
    output_text.push_str(style(header_text).cyan().bold().to_string().as_str());
  
    // Add rows
    let row_pad_width = cmp::max(max_username_length, "Username".len());

    for user in all_users {
      let storage_quota_str = bytesize::to_string(user.storage_quota.unwrap(), false);
      let row_str = format!("{:pad$}{}\n", user.username, storage_quota_str, pad = row_pad_width + 3);

      output_text.push_str(row_str.as_str());
    };
    
    // Print info to output
    println!("\n{}", output_text);
  }
}
