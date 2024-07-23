use std::{env, error::Error, sync::Arc};
use log::{error, info};
use app::Application;
use core::{
  constants,
  app_state::AppState,
  config::Config,
};

mod app;
mod core;
mod admin;
mod routes;
mod storage;
mod util;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
  // Initialise config (must be first)
  let config = Arc::new(Config::initialise()?);

  // Initialise logger (configured with the RUST_LOG environment variable)
  env_logger::init();
  
  // Print working directory
  let working_dir = env::current_dir()?;
  info!("Working directory: {}", working_dir.into_os_string().into_string().unwrap());
  
  // Initialise missing directories defined in the config
  config.initialise_directories()?;

  // Initialise app
  let app = match Application::initialise(&config).await {
    Ok(app) => app,
    Err(err) => {
      error!("Failed to initialise application. Error: {}", err);
      return Err(err.into());
    }
  };

  if let Err(err) = app.start_server().await {
    error!("Server error: {}", err);
  }

  app.close().await?;

  Ok(())
}
