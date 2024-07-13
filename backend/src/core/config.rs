use std::{env, fs};
use rand::{thread_rng, RngCore};
use std::path::Path;
use log::info;
use clap::{arg, command, value_parser};
use base64::{engine::general_purpose, Engine as _};

use crate::constants;

/// A struct of all the settings found in the .env file.
#[derive(Clone)]
pub struct Config {
  /// The ip address of the server without the port. e.g. 127.0.0.1
  pub ip_address: String,
    
  /// The port the server should listen on.
  pub port: u16,

  /// The secret key used for signing or encryption. Stored as a base64 string in the .env file.
  pub server_secret_key: Vec<u8>,

  /// The path of the database file. e.g "databases/userdata.db"
  pub database_path: String,

  /// Whether session cookies should be secure.
  pub secure_cookies: bool
}

/// Gets an environment variable's value by its name or panics if the key couldn't be found.
fn get_env_var(key: &str) -> String {
  env::var(key).expect(format!("Missing environment variable called: {}", key).as_str())
}

impl Config {
  pub fn default() -> Config {
    // Generate a secret key
    let mut server_secret_key = [0 as u8; constants::SERVER_SECRET_KEY_SIZE];
    thread_rng().fill_bytes(&mut server_secret_key);

    return Config {
      ip_address: "0.0.0.0".to_string(),
      port: 3001,
      server_secret_key: server_secret_key.into(),
      database_path: constants::DEFAULT_DATABASE_PATH.to_string(),
      secure_cookies: true
    };
  }

  pub fn initialise() -> Result<Config, Box<dyn std::error::Error>> {
    // Create .env file with default values if one doesn't exist already.
    if !Path::new(constants::DOT_ENV_PATH).exists() {
      info!("Creating new .env file since none was found.");
      
      // Load default config
      let config = Config::default();

      // Convert secret key to a base64 string
      let server_secret_key_base64 = general_purpose::STANDARD.encode(config.server_secret_key);

      // Create the default .env file content
      let mut contents = String::new();
      contents.push_str(format!("IP_ADDRESS={}\n", config.ip_address).as_str());
      contents.push_str(format!("PORT={}\n", config.port).as_str());
      contents.push_str(format!("SERVER_SECRET_KEY={}\n", server_secret_key_base64).as_str());
      contents.push_str(format!("DATABASE_PATH={}\n", config.database_path).as_str());
      contents.push_str(format!("SECURE_COOKIES={}\n", config.secure_cookies).as_str());
      contents.push_str("RUST_LOG=info,tracing::span=warn\n");

      fs::write(constants::DOT_ENV_PATH, contents)?;
    }

    // Read .env file using dotenvy
    dotenvy::dotenv()?;

    // Fill config with environment variables
    let mut config: Config = Config::default();

    config.ip_address = get_env_var("IP_ADDRESS");
    config.port = get_env_var("PORT").trim().parse()?;
    config.database_path = get_env_var("DATABASE_PATH");

    // Session secret key is stored as base64 in the .env file so we have to handle that.
    let server_secret_key_b64 = get_env_var("SERVER_SECRET_KEY");
    config.server_secret_key = general_purpose::STANDARD.decode(server_secret_key_b64)?;

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
    } else {
      config.secure_cookies = get_env_var("SECURE_COOKIES").parse()?;
    }

    Ok(config)
  }
  
  pub fn initialise_directories(&self) -> Result<(), Box<dyn std::error::Error>> {
    let database_path = Path::new(self.database_path.as_str());

    // Get parent directory of database path so we can create the parent directory first before the database file.
    let database_parent_directory = database_path.parent().unwrap();

    if !Path::exists(database_parent_directory) {
      info!("Creating missing database path parent directory at: {}", database_parent_directory.display());
      fs::create_dir_all(database_parent_directory)?;
    }

    Ok(())
  }
}
