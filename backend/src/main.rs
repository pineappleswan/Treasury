use tokio::fs::{File};
use std::{env, fs, path::Path};
use http::{Method};
use tower_http::cors::{Any, CorsLayer};
use tower_sessions::{cookie::{time::Duration}, Expiry, MemoryStore, SessionManagerLayer};
use std::error::Error;
use tower_http::services::{ServeDir, ServeFile};
use axum::{routing::{get, post}, Router};

mod config;
use config::Config;

mod database;
use database::Database;

mod api;

fn initialise_directories(config: &Config) -> Result<(), Box<dyn std::error::Error>> {
	let database_path = Path::new(config.database_path.as_str());
	let user_upload_directory = Path::new(config.user_upload_directory.as_str());
	let user_files_root_directory = Path::new(config.user_files_root_directory.as_str());

	// Get parent directory of database path so we can create the parent directory first before the database file.
	let database_parent_directory = database_path.parent().unwrap();

	if !Path::exists(database_parent_directory) {
		println!("Creating missing database path parent directory at: {}", database_parent_directory.display());
		fs::create_dir_all(database_parent_directory)?;
	}

	if !Path::exists(user_upload_directory) {
		println!("Creating missing user upload directory at: {}", user_upload_directory.display());
		fs::create_dir_all(user_upload_directory)?;
	}

	if !Path::exists(user_files_root_directory) {
		println!("Creating missing user files root directory at: {}", user_files_root_directory.display());
		fs::create_dir_all(user_files_root_directory)?;
	}

	Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	// Print working directory
	let working_dir = env::current_dir()?;
	println!("Working directory: {}", working_dir.into_os_string().into_string().unwrap());

	// Get config
	let config = Config::initialise()?;

	// Initialise missing directories defined in the config
	initialise_directories(&config)?;

	// Open the database
	let database = Database::open(&config);

	// Create the CORS layer
	let cors = CorsLayer::new()
		.allow_methods([ Method::GET, Method::POST ])
		.allow_origin(Any);

	// Create session store
	let session_store = MemoryStore::default();

	// Create session store layer
	let session_layer = SessionManagerLayer::new(session_store)
		.with_secure(false)
		.with_expiry(Expiry::OnInactivity(Duration::hours(1)))
		.with_signed(config.session_secret_key);

	// Create router
	let router = Router::new()
		.route_service("/", ServeFile::new("frontend/dist/index.html"))
		.route_service("/assets", ServeDir::new("frontend/dist/assets"))
		.route("/api/login", post(api::login_api))
		.layer(session_layer)
		.layer(cors);

	// Create listener
	let listener = tokio::net::TcpListener::bind(format!("{}:{}", config.ip_address, config.port)).await.unwrap();

	// Start server
	println!("Server listening on {}:{}", config.ip_address, config.port);
	axum::serve(listener, router).await.unwrap();

	Ok(())
}
