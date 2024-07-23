use std::{error::Error, path::PathBuf, sync::Arc};
use axum::{extract::DefaultBodyLimit, routing::{get, post, put}, Router};
use http::Method;
use tokio::sync::Mutex;
use dashmap::DashMap;
use log::{error, info};
use tower_http::{compression::CompressionLayer, cors::{Any, CorsLayer}, services::{ServeDir, ServeFile}, CompressionLevel};
use tower_sessions::{cookie::{time::Duration, SameSite}, Expiry, MemoryStore, SessionManagerLayer};

use crate::{
  admin::shell::interactive_shell,
  core::{app_state::AppState, config::Config, constants, download_manager::DownloadManager, upload_manager::UploadManager},
  routes,
  storage::{database::Database, file_store::{FileStoreManager, StorageVolumeId}}
};

pub struct Application {
  app_state: Arc<AppState>,
  config: Config
}

impl Application {
  pub async fn initialise(config: &Config) -> Result<Self, Box<dyn Error>> {
    let mut database = Database::open(&config)?;
    let mut file_store = FileStoreManager::new();

    // Register all storage volumes listed in the database
    let storage_volumes = database.get_storage_volumes()?;
    let storage_volumes_usage = database.get_storage_volume_usage()?;

    for volume in storage_volumes {
      let usage = storage_volumes_usage
        .get(&StorageVolumeId(volume.id))
        .expect("Volume usage data expected!");

      // Ensure the volume exists, otherwise error and exit the program
      let volume_path = PathBuf::from(&volume.path);

      match volume_path.try_exists() {
        Ok(exists) => {
          if !exists {
            return Err(format!("Root path of volume {} doesn't exist! Path: {}", volume.id, volume.path).into());
          }
        },
        Err(err) => {
          return Err(format!("Couldn't confirm if root path of volume {} exists! Error: {}", volume.id, err).into());
        }
      }

      if volume.volume_type == "disk" {
        let _ = file_store.register_filesystem_volume(
          StorageVolumeId(volume.id),
          volume.name,
          volume.priority,
          volume.allocation_size as u64,
          *usage,
          volume.path.into()
        ).await?;
      } else {
        error!("Unrecognised storage volume type string: {}", volume.volume_type);
      }
    }

    // Wrap in an Arc
    let file_store = Arc::new(file_store);

    // Initialise download and upload manager
    let uploads_manager = UploadManager::new();
    let mut downloads_manager = DownloadManager::new(file_store.clone());

    // Start inactivity detector in the download manager (this is essential)
    downloads_manager.start_inactivity_detector();

    // Create app state that can be shared
    let app_state = Arc::new(AppState {
      config: Arc::new(config.clone()),
      file_store,
      database: Arc::new(Mutex::new(Some(database))),
      uploads_manager,
      downloads_manager,
      web_socket_broadcast_channels: Arc::new(DashMap::new()),
      web_socket_count_per_user_map: Arc::new(DashMap::new())
    });

    Ok(Self {
      app_state,
      config: config.clone()
    })
  }

  pub async fn start_server(&self) -> Result<(), Box<dyn Error>> {
    // Create the CORS layer
    let cors = CorsLayer::new()
      .allow_methods([ Method::GET, Method::POST, Method::PUT ])
      .allow_origin(Any);

    // Create session store
    let session_store = MemoryStore::default();

    // Create layers
    let session_layer = SessionManagerLayer::new(session_store)
      .with_name(constants::SESSION_COOKIE_NAME)
      .with_secure(self.config.secure_cookies)
      .with_same_site(SameSite::Strict)
      .with_expiry(Expiry::OnInactivity(Duration::seconds(constants::SESSION_EXPIRY_TIME_SECONDS)));

    let compression_layer = CompressionLayer::new()
      .gzip(true)
      .deflate(true)
      .br(true)
      .zstd(true)
      .quality(CompressionLevel::Default);

    // Create router
    let router = Router::new()
      .route_service("/", ServeFile::new(constants::INDEX_HTML_PATH))
      .nest_service("/assets", ServeDir::new(constants::DIST_ASSETS_PATH))
      .route("/ws", get(routes::web_sockets::web_socket_handler))
      .layer(compression_layer.clone())
      .nest("/api", Router::new()
        .route("/sessiondata", get(routes::auth::get_session_data_api))
        .route("/logout", post(routes::auth::logout_api))
        .route("/login", post(routes::auth::login_api))
        .nest("/accounts", Router::new()
          .route("/claim", post(routes::account::claim_api))
          .route("/claimcode/:code", get(routes::account::get_claim_code_api))
          .route("/:username/salt", get(routes::account::get_salt_api))
          .layer(compression_layer.clone())
        )
        .nest("/twofactorauth", Router::new()
          .route("/enable", post(routes::auth::enable_two_factor_auth_api))
          .route("/disable", post(routes::auth::disable_two_factor_auth_api))
          .route("/url", get(routes::auth::get_two_factor_auth_url_api))
          .layer(compression_layer.clone())
        )
        .nest("/filesystem", Router::new()
          .route("/usage", get(routes::filesystem::get_usage_api))
          .route("/folders", post(routes::filesystem::create_folder_api))
          .route("/items", get(routes::filesystem::get_items_by_parent_handle_api))
          .route("/items/:handle", get(routes::filesystem::get_item_api))
          .route("/metadata", put(routes::filesystem::put_metadata_api))
          .layer(compression_layer.clone())
        )
        .nest("/uploads", Router::new()
          .route("/", post(routes::uploads::start_upload_api))
          .route("/:handle/finalise", put(routes::uploads::finalise_upload_api))
          .route("/chunks", post(routes::uploads::upload_chunk_api))

          // Make the default body size limit for the upload routes the chunk data size plus a bit of overhead
          .layer(DefaultBodyLimit::max(constants::CHUNK_DATA_SIZE + 1024))
          .layer(compression_layer.clone())
        )
        .nest("/downloads", Router::new()
          .route("/:handle/chunks/:chunk", get(routes::downloads::download_chunk_api))
        )
      )
      .nest("/cdn", Router::new()
        .route("/:name", get(routes::cdn::cdn_api))
        .layer(compression_layer.clone())
      )
      .fallback(get(routes::html::index_html_route)) // Serve index.html as a fallback because of client side routing
      .with_state(self.app_state.clone())
      .layer(session_layer)
      .layer(cors);

    // Create listener
    let server_ip_address = format!("{}:{}", self.config.ip_address, self.config.port);
    let listener = tokio::net::TcpListener::bind(server_ip_address).await.unwrap();

    // Start server
    info!("Server listening on {}:{}", self.config.ip_address, self.config.port);
    info!("Secure cookies: {}", self.config.secure_cookies);

    axum::serve(listener, router)
      .with_graceful_shutdown(interactive_shell(self.app_state.clone())) // Start the interactive shell
      .await
      .unwrap();

    Ok(())
  }

  pub async fn close(&self) -> Result<(), Box<dyn Error>> {
    // Close database
    info!("Closing database...");
    
    let mut database = self.app_state.database.lock().await;
    let database = database.take().unwrap();
    drop(database);
    
    // Close file store
    info!("Closing file store...");
    self.app_state.file_store.close().await?;

    Ok(())
  }
}
