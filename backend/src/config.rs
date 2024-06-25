use std::{env, fs};
use std::path::Path;
use tower_sessions::cookie::Key;
use log::info;
use clap::{arg, command, value_parser};
use base64::{engine::general_purpose, Engine as _};

/// A struct of all the settings found in the .env file.
#[derive(Clone)]
pub struct Config {
  /// The ip address of the server without the port. e.g. 127.0.0.1
  pub ip_address: String,
    
  /// The port the server should listen on.
  pub port: u16,

  /// The secret key used for session cookie signing. Stored as a base64 string in the .env file.
  pub session_secret_key: Key,

  /// The path of the database file. e.g "databases/userdata.db"
  pub database_path: String,

  /// For temporarily storing files that are being uploaded to the server.
  pub user_upload_directory: String,

  /// The root directory of where the files of users will be stored on the filesystem.
  pub user_files_root_directory: String,

  /// Whether session cookies should be secure.
  pub secure_cookies: bool,
}

/// Gets an environment variable's value by its name or panics if the key couldn't be found.
fn get_env_var(key: &str) -> String {
  env::var(key).expect(format!("Missing {} in .env", key).as_str())
}

impl Config {
  pub fn default() -> Config {
    return Config {
      ip_address: "0.0.0.0".to_string(),
      port: 3001,
      session_secret_key: Key::generate(),
      database_path: "../databases/database.db".to_string(),
      user_upload_directory: "../uploads".to_string(),
      user_files_root_directory: "../userfiles".to_string(),
      secure_cookies: true
    };
  }

  pub fn initialise() -> Result<Config, Box<dyn std::error::Error>> {
    // Create .env file with default values if one doesn't exist already.
    if !Path::new(".env").exists() {
      info!("Creating new .env file since none was found.");
      
      // Load default config
      let config = Config::default();

      // Convert secret key to a base64 string
      let session_secret_key_bytes = config.session_secret_key.master();
      let session_secret_key_base64 = general_purpose::STANDARD.encode(session_secret_key_bytes);

      // Create the default .env file content
      let mut contents = String::new();
      contents.push_str(format!("IP_ADDRESS={}\n", config.ip_address).as_str());
      contents.push_str(format!("PORT={}\n", config.port).as_str());
      contents.push_str(format!("SESSION_SECRET_KEY={}\n", session_secret_key_base64).as_str());
      contents.push_str(format!("DATABASE_PATH={}\n", config.database_path).as_str());
      contents.push_str(format!("USER_UPLOAD_DIRECTORY={}\n", config.user_upload_directory).as_str());
      contents.push_str(format!("USER_FILES_ROOT_DIRECTORY={}\n", config.user_files_root_directory).as_str());
      contents.push_str(format!("SECURE_COOKIES={}\n", config.secure_cookies).as_str());
      contents.push_str("RUST_LOG=info,tracing::span=warn\n");

      fs::write(".env", contents)?;
    }

    // Read .env file using dotenvy
    dotenvy::dotenv()?;

    // Fill config with environment variables
    let mut config: Config = Config::default();

    config.ip_address = get_env_var("IP_ADDRESS");
    config.port = get_env_var("PORT").trim().parse()?;
    config.database_path = get_env_var("DATABASE_PATH");
    config.user_upload_directory = get_env_var("USER_UPLOAD_DIRECTORY");
    config.user_files_root_directory = get_env_var("USER_FILES_ROOT_DIRECTORY");

    // TODO: is config.secure_cookies handled here? :/

    // Session secret key is stored as base64 in the .env file so we have to handle that.
    let session_secret_key_b64 = get_env_var("SESSION_SECRET_KEY");
    let session_secret_key_bytes = general_purpose::STANDARD.decode(session_secret_key_b64)?;
    let session_secret_key = Key::try_from(&session_secret_key_bytes[..])?;
    config.session_secret_key = session_secret_key;

    // The database path cannot be a directory! It must be the actual path to the database file.
    assert_eq!(
      Path::new(config.database_path.as_str()).is_dir(), false,
      "The DATABASE_PATH in the .env file CANNOT be a directory! It must be a path to a file."
    );

    // Process program parameters
    let args = command!()
    .arg(
      arg!(--address <string> "The ip address the server listens on.")
        .required(false)
        .value_parser(value_parser!(String))
    )
    .arg(
      arg!(--port <number> "The port the server listens on.")
        .required(false)
        .value_parser(value_parser!(u16))
    )
    .arg(
      arg!(--securecookies <boolean> "Whether session cookies should be secure or not.")
        .required(false)
        .value_parser(value_parser!(bool))
    )
    .get_matches();

    // Override some config values with program parameters
    if let Some(address) = args.get_one::<String>("address") {
      config.ip_address = address.clone();
    }

    if let Some(port) = args.get_one::<u16>("port") {
      config.port = *port;
    }

    if let Some(secure) = args.get_one::<bool>("securecookies") {
      config.secure_cookies = *secure;
    }

    Ok(config)
  }
  
  pub fn initialise_directories(&self) -> Result<(), Box<dyn std::error::Error>> {
    let database_path = Path::new(self.database_path.as_str());
    let user_upload_directory = Path::new(self.user_upload_directory.as_str());
    let user_files_root_directory = Path::new(self.user_files_root_directory.as_str());

    // Get parent directory of database path so we can create the parent directory first before the database file.
    let database_parent_directory = database_path.parent().unwrap();

    if !Path::exists(database_parent_directory) {
      info!("Creating missing database path parent directory at: {}", database_parent_directory.display());
      fs::create_dir_all(database_parent_directory)?;
    }

    if !Path::exists(user_upload_directory) {
      info!("Creating missing user upload directory at: {}", user_upload_directory.display());
      fs::create_dir_all(user_upload_directory)?;
    }

    if !Path::exists(user_files_root_directory) {
      info!("Creating missing user files root directory at: {}", user_files_root_directory.display());
      fs::create_dir_all(user_files_root_directory)?;
    }

    Ok(())
  }
}
