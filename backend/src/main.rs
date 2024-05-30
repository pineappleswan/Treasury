use tokio::sync::Mutex;
use std::env;
use http::Method;
use tower_http::cors::{Any, CorsLayer};
use tower_sessions::{cookie::{time::Duration, SameSite}, Expiry, MemoryStore, SessionManagerLayer};
use tower_http::services::{ServeDir, ServeFile};
use std::sync::Arc;
use axum::{routing::{get, post}, Router};
use clap::{arg, command, value_parser};

mod config;
use config::Config;

mod database;
use database::Database;

mod shell;
use shell::interactive_shell;

#[path = "api/account.rs"] mod account_api;

struct AppState {
	database: Option<Database>
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
	let database_instance = Some(Database::open(&config)?);
	
	// Create app state to be shared
	let shared_app_state = Arc::new(Mutex::new(AppState {
		database: database_instance
	}));

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
		.route("/api/claimaccount", post(account_api::claim_account_api))
		.route("/api/checkclaimcode", post(account_api::check_claim_code_api))
		.route("/api/login", post(account_api::login_api))
		.with_state(shared_app_state.clone())
		.layer(session_layer)
		.layer(cors);

	// Create listener
	let listener = tokio::net::TcpListener::bind(format!("{}:{}", config.ip_address, config.port)).await.unwrap();

	// Start server
	println!("Server listening on {}:{}", config.ip_address, config.port);

	axum::serve(listener, router)
		.with_graceful_shutdown(interactive_shell(shared_app_state.clone())) // Start the interactive shell
		.await
		.unwrap();

	// Close database
	println!("Closing database...");

	let database = shared_app_state.lock().await.database.take().expect("Database is none!");
	database.close();

	Ok(())
}
