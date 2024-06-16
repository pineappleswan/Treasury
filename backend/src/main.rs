use api::uploads::ActiveUploadsDatabase;
use tokio::sync::Mutex;
use std::env;
use http::Method;
use tower_http::cors::{Any, CorsLayer};
use tower_sessions::{cookie::{time::Duration, SameSite}, Expiry, MemoryStore, SessionManagerLayer};
use tower_http::services::{ServeDir, ServeFile};
use std::sync::Arc;
use axum::{extract::DefaultBodyLimit, routing::{get, post, put}, Router};
use log::info;

mod config;
mod database;
mod shell;
mod api;
mod constants;
mod util;

use config::Config;
use shell::interactive_shell;
use database::Database;

struct AppState {
	config: Config,
	database: Option<Database>,
	active_uploads: ActiveUploadsDatabase
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	// Get config
	let config = Config::initialise()?;
	
	// Initialise logger (configured with the RUST_LOG environment variable)
	env_logger::init();
	
	// Print working directory
	let working_dir = env::current_dir()?;
	info!("Working directory: {}", working_dir.into_os_string().into_string().unwrap());

	// Initialise missing directories defined in the config
	config.initialise_directories()?;

	// Initialise databases
	let database_instance = Some(Database::open(&config)?);

	let active_uploads_database = ActiveUploadsDatabase::new(&config);
	
	// Create app state to be shared
	let config_clone = config.clone();

	let shared_app_state = Arc::new(Mutex::new(AppState {
		config: config,
		database: database_instance,
		active_uploads: active_uploads_database
	}));

	// Create the CORS layer
	let cors = CorsLayer::new()
		.allow_methods([ Method::GET, Method::POST ])
		.allow_origin(Any);

	// Create session store
	let session_store = MemoryStore::default();

	// Create session store layer
	let session_layer = SessionManagerLayer::new(session_store)
		.with_secure(config_clone.secure_cookies)
		.with_same_site(SameSite::Strict)
		.with_expiry(Expiry::OnInactivity(Duration::seconds(constants::SESSION_EXPIRY_TIME_SECONDS)))
		.with_signed(config_clone.session_secret_key);

	// Create router (TODO: try without slashes? especially for nested apis)
	let router = Router::new()
		.route_service("/", ServeFile::new("frontend/dist/index.html"))
		.route_service("/assets", ServeDir::new("frontend/dist/assets"))
		.nest("/api", Router::new()
			// General apis
			.route("/sessiondata", get(api::general::get_session_data_api))
			.route("/logout", post(api::general::logout_api))
			.route("/login", post(api::general::login_api))

			// Account apis
			.nest("/accounts", Router::new()
				.route("/claim", post(api::account::claim_api))
				.route("/claimcode", get(api::account::get_claim_code_api))
				.route("/:username/salt", get(api::account::get_salt_api))
			)

			// Filesystem apis
			.nest("/filesystem", Router::new()
				.route("/usage", get(api::filesystem::get_usage_api))
				.route("/folders", post(api::filesystem::create_folder_api))
				.route("/items", get(api::filesystem::get_items_api))
				.route("/metadata", put(api::filesystem::put_metadata_api))
				// TODO: /chunks/{handle}/{chunk id} ?
			)

			// Uploads apis
			.nest("/uploads", Router::new()
				.route("/", post(api::uploads::start_upload_api))
				.route("/:handle/finalise", put(api::uploads::finalise_upload_api))
				.route("/chunks", post(api::uploads::upload_chunk_api))
				// Make the default body limit for the upload routes the chunk data size plus a bit of overhead
				.layer(DefaultBodyLimit::max(constants::CHUNK_DATA_SIZE + 1024))
			)
		)
		.with_state(shared_app_state.clone())
		.layer(session_layer)
		.layer(cors);

	// Create listener
	let listener = tokio::net::TcpListener::bind(format!("{}:{}", config_clone.ip_address, config_clone.port)).await.unwrap();

	// Start server
	info!("Server listening on {}:{}", config_clone.ip_address, config_clone.port);
	info!("Secure cookies: {}", config_clone.secure_cookies);

	axum::serve(listener, router)
		.with_graceful_shutdown(interactive_shell(shared_app_state.clone())) // Start the interactive shell
		.await
		.unwrap();

	// Close database
	info!("Closing database...");

	let database = shared_app_state.lock().await.database.take().expect("Database is none!");
	database.close();

	Ok(())
}
