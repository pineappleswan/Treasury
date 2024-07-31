use thousands::Separable;
use tokio::sync::broadcast;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use dialoguer::{theme::ColorfulTheme, Confirm, Input, Select};
use console::style;
use log::{info, error};

use crate::AppState;
use crate::util::{
  tables::TableBuilder,
  strings::format_size_human_readable,
  generators::generate_claim_code,
  strings::parse_human_readable_size
};

pub async fn interactive_shell(shared_app_state: Arc<AppState>) {
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

async fn new_claim_code_command(shared_app_state: Arc<AppState>) {
  let shell_theme = ColorfulTheme::default();

  let storage_quota_str = Input::with_theme(&shell_theme)
    .with_prompt("Storage quota")
    .validate_with(|input: &String| {
      parse_human_readable_size(input.clone())
        .map(|_| ())
        .map_err(|err| err.to_string())
    })
    .interact_text()
    .unwrap();

  let storage_quota = parse_human_readable_size(storage_quota_str).expect("The storage quota string is already validated!");

  // Confirm creation of new claim code
  let bytes_formatted_str = format_size_human_readable(storage_quota, false, 1);

  let confirmed = Confirm::with_theme(&shell_theme)
    .with_prompt(
      format!(
        "Create new claim code with a storage quota of {} bytes ({})?",
        storage_quota.separate_with_commas(),
        bytes_formatted_str
      )
    )
    .wait_for_newline(true)
    .interact()
    .unwrap();

  if !confirmed {
    return;
  }

  // Generate claim code
  let claim_code = generate_claim_code();

  // Insert into database
  let mut database_guard = shared_app_state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  match database.insert_new_claim_code(claim_code.as_str(), storage_quota) {
    Ok(_) => println!("New claim code: {}", style(claim_code).cyan().bold()),
    Err(_) => error!("Failed to create new claim code.")
  };
}

async fn list_storage_volumes(shared_app_state: Arc<AppState>) {
  // Get all volume stats
  let mut volume_stats = shared_app_state.file_store.get_all_volume_stats().await;

  // Sort by id in ascending order
  volume_stats.sort_by(|a, b| {
    a.id.cmp(&b.id)
  });

  // Create table
  let mut table_builder = TableBuilder::new();
  table_builder.set_header_text(vec![ "Id".into(), "Name".into(), "Usage".into(), "Priority".into(), "Reserved".into() ]);

  for stats in volume_stats {
    let used_fraction = stats.usage as f64 / stats.size as f64;
    let used_percentage = used_fraction * 100.0;
    let usage_str = format!("{:.1}% ({}/{})", used_percentage, stats.usage, stats.size);

    table_builder.push_record(
      vec![
        stats.id.to_string(),
        stats.name,
        usage_str,
        stats.priority_level.to_string(),
        stats.upload_reservation_size.to_string()
      ]
    ).unwrap();
  }

  // Print info to output
  println!("\n{}\n", table_builder.get_table());
}

async fn list_registered_users(shared_app_state: Arc<AppState>) {
  // Acquire database
  let mut database_guard = shared_app_state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  // Get all users in the database
  let all_users = match database.get_all_users() {
    Ok(data) => data,
    Err(_) => return
  };

  drop(database_guard);

  if all_users.is_empty() {
    println!("{}", style("No users found.").yellow());
    return;
  }

  // Create table
  let mut table_builder = TableBuilder::new();
  table_builder.set_header_text(vec![ "Username".into(), "Storage quota".into(), "2FA enabled".into() ]);

  // Add rows
  for user in all_users {
    let storage_quota = user.storage_quota.unwrap();

    let storage_quota_str = format!(
      "{} ({})",
      storage_quota.separate_with_commas(),
      format_size_human_readable(storage_quota, false, 1)
    );

    let two_factor_enabled_str: String = match user.totp_secret.is_some() {
      true => "true".into(),
      false => "false".into()
    };
    
    table_builder.push_record(vec![ user.username, storage_quota_str, two_factor_enabled_str ]).unwrap();
  };
  
  // Print info to output
  println!("\n{}\n", table_builder.get_table());
}

async fn list_available_claim_codes(shared_app_state: Arc<AppState>) {
  // Acquire database
  let mut database_guard = shared_app_state.database.lock().await;
  let database = database_guard.as_mut().unwrap();

  // Get available claim codes from the database
  let claim_codes = match database.get_available_claim_codes() {
    Ok(data) => data,
    Err(_) => return
  };

  drop(database_guard);

  // Print message and return if no claim codes are available.
  if claim_codes.is_empty() {
    println!("{}", style("No claim codes found.").yellow());
    return;
  }

  // Create table
  let mut table_builder = TableBuilder::new();
  table_builder.set_header_text(vec![ "Claim code".into(), "Storage quota".into() ]);

  // Add rows
  for code in claim_codes {
    let storage_quota_str = format_size_human_readable(code.storage_quota, false, 1);
    table_builder.push_record(vec![ code.claim_code, storage_quota_str ]).unwrap();
  };

  // Print info to output
  println!("\n{}\n", table_builder.get_table());
}

async fn web_socket_count_per_user(shared_app_state: Arc<AppState>) {
  // Acquire database
  let mut database_guard = shared_app_state.database.lock().await;
  let database = database_guard.as_mut().unwrap();
  
  // Get all users in the database
  let all_users = match database.get_all_users() {
    Ok(data) => data,
    Err(_) => return
  };

  drop(database_guard);

  if all_users.is_empty() {
    println!("{}", style("No users found.").yellow());
    return;
  }

  if shared_app_state.web_socket_count_per_user_map.is_empty() {
    println!("{}", style("No data as no users have logged in yet.").yellow());
    return;
  }

  // Create hashmap for fast lookup
  let mut user_id_to_username_map: HashMap<u64, String> = HashMap::new();

  for user in all_users {
    user_id_to_username_map.insert(user.user_id.unwrap(), user.username);
  }

  // Create table
  let mut table_builder = TableBuilder::new();
  table_builder.set_header_text(vec![ "Username".into(), "Count".into() ]);

  for entry in shared_app_state.web_socket_count_per_user_map.iter() {
    let count = entry.load(Ordering::SeqCst);
    let username = user_id_to_username_map.get(entry.key()).unwrap();

    table_builder.push_record(vec![ username.clone(), count.to_string() ]).unwrap();
  }

  // Print info to output
  println!("\n{}\n", table_builder.get_table());
}

async fn list_command(shared_app_state: Arc<AppState>) {
  let shell_theme = ColorfulTheme::default();

  // Ask user to select what type of info to list
  let chosen_info_type = Select::with_theme(&shell_theme)
    .with_prompt("Info to list")
    .items(
      &[
        "Storage volumes",
        "Registered users",
        "Available claim codes",
        "Web socket count per user"
      ]
    )
    .default(0)
    .interact()
    .unwrap();

  match chosen_info_type {
    0 => list_storage_volumes(shared_app_state).await,
    1 => list_registered_users(shared_app_state).await,
    2 => list_available_claim_codes(shared_app_state).await,
    3 => web_socket_count_per_user(shared_app_state).await,
    _ => ()
  };
}
