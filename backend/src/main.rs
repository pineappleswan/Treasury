use tokio::sync::Mutex;
use tokio::signal;
use std::{env, fs, path::Path};
use http::{Method};
use tower_http::cors::{Any, CorsLayer};
use tower_sessions::{cookie::{time::Duration, SameSite}, Expiry, MemoryStore, SessionManagerLayer};
use tower_http::services::{ServeDir, ServeFile};
use std::sync::Arc;
use axum::{routing::{get, post}, Router};
use clap::{arg, command, value_parser, ArgAction, Command};
use dialoguer::{theme::ColorfulTheme, Select, Input};

mod config;
use config::Config;

mod database;
use database::Database;

mod api;

mod util;

struct AppState {
	database: Mutex<Option<Database>>
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	// TODO: args for database path, user files path, etc. ?

	let args = command!()
		.arg(
			arg!(--address <string> "The ip address the server listens on.")
				.required(false)
				.value_parser(value_parser!(String))
		)
		.arg(
			arg!(--port <number> "The port the server listens on.")
				.required(false)
				.value_parser(value_parser!(String))
		)
		.get_matches();

	// Print working directory
	let working_dir = env::current_dir()?;
	println!("Working directory: {}", working_dir.into_os_string().into_string().unwrap());

	// Get config
	let mut config = Config::initialise()?;

	// Override some config values if user supplied arguments.
	if let Some(address) = args.get_one::<String>("address") {
		config.ip_address = address.clone();
	}

	if let Some(port) = args.get_one::<String>("port") {
		if let Ok(port) = port.trim().parse::<u16>() {
			config.port = port;
		}
	}

	// Initialise missing directories defined in the config
	config.initialise_directories()?;

	// Open the database
	let database_instance = Mutex::new(Some(Database::open(&config)?));
	
	// Create app state to be shared
	let shared_app_state = Arc::new(AppState {
		database: database_instance
	});

	// Create the CORS layer
	let cors = CorsLayer::new()
		.allow_methods([ Method::GET, Method::POST ])
		.allow_origin(Any);

	// Create session store
	let session_store = MemoryStore::default();

	// Create session store layer
	let session_layer = SessionManagerLayer::new(session_store)
		.with_secure(false)
		.with_same_site(SameSite::Strict)
		.with_expiry(Expiry::OnInactivity(Duration::hours(1)))
		.with_signed(config.session_secret_key);

	// Create router
	let router = Router::new()
		.route_service("/", ServeFile::new("frontend/dist/index.html"))
		.route_service("/assets", ServeDir::new("frontend/dist/assets"))
		.route("/api/login", post(api::login_api))
		.with_state(shared_app_state.clone())
		.layer(session_layer)
		.layer(cors);
	
	// TEST ZONE
	/*
	let mut db_guard = shared_app_state.database.lock().await;

	match db_guard.as_mut() {
		Some(db) => {
			match db.insert_new_claim_code("hey".to_string(), 123412345) {
				Ok(_) => println!("Inserted successfully."),
				Err(_) => eprintln!("Failed to insert claimcode.")
			};

			let is_valid = match db.is_claim_code_valid("hey".to_string()) {
				Ok(valid) => valid,
				Err(err) => {
					println!("rusqlite error: {}", err);
					false
				}
			};

			println!("is valid: {}", is_valid);
		}
		None => {
			eprintln!("No database!?");
		}
	};
	*/

	let new_user_storage_quota = Input::with_theme(&ColorfulTheme::default())
		.with_prompt("Storage quota")
		.validate_with(|input: &String| -> Result<(), &str> {
			if !input.contains("%") {
				Ok(())
			} else {
				Err("Bad")
			}
		})
		.interact_text()
		.unwrap();

	let bytes: i64 = match util::parse_byte_size_str(new_user_storage_quota) {
		Ok(bytes) => {
			bytes as i64
		},
		Err(err) => {
			eprintln!("parse failed: {}", err);
			-1
		}
	};

	// Create listener
	let listener = tokio::net::TcpListener::bind(format!("{}:{}", config.ip_address, config.port)).await.unwrap();

	// Start server
	println!("Server listening on {}:{}", config.ip_address, config.port);

	axum::serve(listener, router)
		.with_graceful_shutdown(shutdown_signal())
		.await
		.unwrap();

	// Close database
	println!("Closing database...");

	let mut db_guard = shared_app_state.database.lock().await;
	db_guard.take().expect("Database not found!").close();

	Ok(())
}

async fn shutdown_signal() {
	let ctrl_c = async {
		signal::ctrl_c()
			.await
			.expect("Failed to install CTRL+C handler.");

		println!("Received CTRL+C signal. Stopping server...");
	};

	#[cfg(unix)]
	let terminate = async {
		signal::unix::signal(signal::unix::SignalKind::termiate())
			.expect("Failed to install unix signal handler.")
			.recv()
			.await;
	};

	#[cfg(not(unix))]
	let terminate = std::future::pending::<()>();

	tokio::select! {
		_ = ctrl_c => {},
		_ = terminate => {}
	}
}
