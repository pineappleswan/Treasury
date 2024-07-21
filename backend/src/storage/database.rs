use rusqlite::{Connection, Result, params};
use log::{error, info};
use std::error::Error;
use std::path::Path;
use path_absolutize::*;
use std::path::PathBuf;
use std::collections::HashMap;
use crate::Config;

use super::file_store::StorageVolumeId;

pub struct Database {
  pub connection: Connection
}

pub struct ClaimCodeData {
  pub claim_code: String,
  pub storage_quota: u64
}

pub struct UserData {
  pub username: String,
  pub auth_key_hash: String,
  pub salt: Vec<u8>,
  pub encrypted_master_key: Vec<u8>,
  pub encrypted_ed25519_private_key: Vec<u8>,
  pub ed25519_public_key: Vec<u8>,
  pub encrypted_x25519_private_key: Vec<u8>,
  pub x25519_public_key: Vec<u8>,

  /// The account creation date as seconds since the unix epoch
  pub creation_date: u64,

  /// For two-factor authentication
  pub totp_secret: Option<Vec<u8>>,

  /// Optional for claim_user() where the storage quota is retrieved from the claim code's data
  pub storage_quota: Option<u64>,

  /// Optional only when calling claim_user()
  pub user_id: Option<u64>
}

pub struct UserFileEntry {
  pub owner_id: u64,
  pub volume_id: Option<u64>,
  pub handle: String,
  pub parent_handle: String,
  pub size: u64,
  pub encrypted_crypt_key: Option<Vec<u8>>,
  pub encrypted_metadata: Vec<u8>
}

pub struct StorageVolumeEntry {
  pub id: u64,
  pub name: String,
  pub volume_type: String,
  pub path: String,
  pub priority: u64,
  pub allocation_size: u64
}

struct StorageVolumeUsageEntry {
  pub id: u64,
  pub usage: u64
}

pub struct ClaimUserRequest {
  pub claim_code: String,
  pub user_data: UserData
}

pub struct EditFileMetadataRequest {
  pub handle: String,
  pub metadata: Vec<u8>
}

impl Database {
  pub fn open(config: &Config) -> Result<Database> {
    let path = Path::new(config.database_path.as_str());
    info!("Opening database at: {}", path.absolutize().unwrap().to_str().unwrap());

    // Check if database already exists so that it can be initialised later
    let created_for_first_time = !path.exists();

    // Open database connection
    let connection = Connection::open(path)?;

    // Use WAL mode
    connection.execute_batch("PRAGMA journal_mode=WAL")?;

    let mut database = Database {
      connection
    };

    // Initialise if database was created for the first time
    if created_for_first_time {
      info!("Initialising database...");
      database.initialise().unwrap();
    }

    Ok(database)
  }

  pub fn close(self) {
    let _ = self.connection.close()
      .map_err(|err| {
        error!("Close database connection error: {:?}", err);
      });

    info!("Database closed.");
  }

  fn initialise(&mut self) -> Result<(), Box<dyn Error>> {
    let tx = self.connection.transaction()?;

    tx.execute(
      "CREATE TABLE claim_codes (
        code TEXT NOT NULL,
        storage_quota INTEGER NOT NULL DEFAULT 0
      )",
      ()
    )?;

    tx.execute(
      "CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        storage_quota INTEGER NOT NULL DEFAULT 0,
        auth_key_hash TEXT NOT NULL,
        salt BLOB NOT NULL,
        encrypted_master_key BLOB NOT NULL,
        encrypted_ed25519_private_key BLOB NOT NULL,
        ed25519_public_key BLOB NOT NULL,
        encrypted_x25519_private_key BLOB NOT NULL,
        x25519_public_key BLOB NOT NULL,
        totp_secret BLOB,
        creation_date INTEGER NOT NULL
      )",
      ()
    )?;

    tx.execute(
      "CREATE TABLE storage_volumes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        volume_type TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        priority INTEGER NOT NULL UNIQUE,
        allocation_size INTEGER NOT NULL DEFAULT 0
      )",
      ()
    )?;

    tx.execute(
      "CREATE TABLE files (
        owner_id INTEGER NOT NULL REFERENCES users(id),
        volume_id INTEGER REFERENCES storage_volumes(id),
        handle TEXT NOT NULL,
        parent_handle TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        encrypted_file_crypt_key BLOB,
        encrypted_metadata BLOB NOT NULL
      )",
      ()
    )?;

    // Create indexes
    tx.execute("CREATE INDEX idx_owner_id ON files(owner_id)", ())?;
    tx.execute("CREATE INDEX idx_handle ON files(handle)", ())?;
    tx.execute("CREATE INDEX idx_parent_handle ON files(parent_handle)", ())?;

    // TODO: DEBUG ONLY
    for i in 0..2 {
      let storage_volume_path = PathBuf::from(format!("../USERDATA/userfiles/{}", i)).absolutize().unwrap().to_path_buf();

      tx.execute(
        "INSERT INTO storage_volumes (id, name, volume_type, path, priority, allocation_size)
        VALUES (?, ?, ?, ?, ?, ?)",
        params![
          i,
          "default", // Default name
          "disk", // Type
          storage_volume_path.to_str(),
          i, // Priority
          1 * 1000 * 1000 * 1000 // 1 GB default allocation size
        ]
      )?;
    }

    tx.commit()?;

    Ok(())
  }

  /// Returns a hashmap where the key is the storage volume id and the value is the total used bytes
  pub fn get_storage_volume_usage(&mut self) -> Result<HashMap<StorageVolumeId, u64>, rusqlite::Error> {
    let mut statement = self.connection.prepare(
      "SELECT
        volume.id AS id,
        COALESCE(SUM(fs.size), 0) AS usage
      FROM
        storage_volumes volume
      LEFT JOIN
        files fs ON volume.id = fs.volume_id
      GROUP BY
        volume.id"
    )?;

    let mut usage_map: HashMap<StorageVolumeId, u64> = HashMap::new();
  
    let result_iter = statement.query_map([], |row| {
      Ok(StorageVolumeUsageEntry {
        id: row.get(0)?,
        usage: row.get(1)?
      })
    })?;
  
    for result in result_iter {
      let entry = result.unwrap();
      usage_map.insert(StorageVolumeId(entry.id), entry.usage);
    }

    Ok(usage_map)
  }

  pub fn edit_file_metadata_multiple(&mut self, owner_user_id: u64, requests: &Vec<EditFileMetadataRequest>) -> Result<(), rusqlite::Error> {
    let tx = self.connection.transaction()?;

    for request in requests {
      let _ = tx.execute(
        "UPDATE files SET encrypted_metadata = ? WHERE handle = ? AND owner_id = ?",
        params![request.metadata, request.handle, owner_user_id]
      );
    }

    tx.commit()?;

    Ok(())
  }

  pub fn set_user_totp_secret(&mut self, user_id: u64, secret: Option<Vec<u8>>) -> Result<usize, rusqlite::Error> {
    self.connection.execute(
      "UPDATE users SET totp_secret = ? WHERE id = ?",
      params![secret, user_id]
    )
  }

  pub fn insert_new_claim_code(&mut self, claim_code: &str, storage_quota: u64) -> Result<usize, rusqlite::Error> {
    self.connection.execute(
      "INSERT INTO claim_codes (code, storage_quota)
      VALUES (?, ?)",
      params![claim_code, storage_quota]
    )
  }
  
  pub fn insert_new_user_file(&mut self, entry: &UserFileEntry) -> Result<usize, rusqlite::Error> {
    self.connection.execute(
      "INSERT INTO files (owner_id, volume_id, handle, parent_handle, size, encrypted_file_crypt_key, encrypted_metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)",
      params![
        entry.owner_id,
        entry.volume_id,
        entry.handle,
        entry.parent_handle,
        entry.size,
        entry.encrypted_crypt_key,
        entry.encrypted_metadata
      ]
    )
  }

  pub fn claim_user(&mut self, request: &ClaimUserRequest) -> Result<(), rusqlite::Error> {  
    let claim_code_data = self.get_claim_code_info(&request.claim_code)?;
  
    // Create a new transaction
    let tx = self.connection.transaction()?;

    // Delete the claim code
    tx.execute(
      "DELETE FROM claim_codes WHERE code = ?",
      [&request.claim_code]
    )?;

    // Create a new user
    tx.execute(
      "INSERT INTO users (username, storage_quota, auth_key_hash, salt, encrypted_master_key,
      encrypted_ed25519_private_key, ed25519_public_key, encrypted_x25519_private_key, x25519_public_key,
      totp_secret, creation_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params![
        request.user_data.username,
        claim_code_data.storage_quota,
        request.user_data.auth_key_hash,
        request.user_data.salt,
        request.user_data.encrypted_master_key,
        request.user_data.encrypted_ed25519_private_key,
        request.user_data.ed25519_public_key,
        request.user_data.encrypted_x25519_private_key,
        request.user_data.x25519_public_key,
        None::<Vec<u8>>,
        request.user_data.creation_date
      ]
    )?;

    tx.commit()?;

    Ok(())
  }

  pub fn is_username_taken_case_insensitive(&mut self, username: &String) -> Result<bool, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT * FROM users WHERE LOWER(username) = ?"
    )?;

    match statement.query_row([username.to_ascii_lowercase()], |_| Ok(())) {
      Ok(_) => Ok(true), // Username is taken
      Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false), // Username is not taken
      Err(err) => Err(err) // rusqlite error occurred
    }
  }

  pub fn get_claim_code_info(&mut self, claim_code: &String) -> Result<ClaimCodeData, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT code, storage_quota FROM claim_codes WHERE code = ?"
    )?;

    statement.query_row([claim_code], |row| {
      Ok(ClaimCodeData {
        claim_code: row.get(0)?,
        storage_quota: row.get(1)?
      })
    })
  }

  pub fn get_available_claim_codes(&mut self) -> Result<Vec<ClaimCodeData>> {
    let mut statement = self.connection.prepare_cached(
      "SELECT code, storage_quota FROM claim_codes"
    )?;

    let mut results: Vec<ClaimCodeData> = Vec::new();
  
    let result_iter = statement.query_map([], |row| {
      Ok(ClaimCodeData {
        claim_code: row.get(0)?,
        storage_quota: row.get(1)?
      })
    })?;
  
    for result in result_iter {
      results.push(result.unwrap());
    }

    Ok(results)
  }

  pub fn get_all_users(&mut self) -> Result<Vec<UserData>> {
    let mut statement = self.connection.prepare_cached(
      "SELECT * FROM users"
    )?;

    let mut results: Vec<UserData> = Vec::new();
  
    let result_iter = statement.query_map([], |row| {
      Ok(UserData {
        user_id: row.get(0)?,
        username: row.get(1)?,
        storage_quota: row.get(2)?,
        auth_key_hash: row.get(3)?,
        salt: row.get(4)?,
        encrypted_master_key: row.get(5)?,
        encrypted_ed25519_private_key: row.get(6)?,
        ed25519_public_key: row.get(7)?,
        encrypted_x25519_private_key: row.get(8)?,
        x25519_public_key: row.get(9)?,
        totp_secret: row.get(10)?,
        creation_date: row.get(11)?
      })
    })?;
  
    for result in result_iter {
      results.push(result.unwrap());
    }

    Ok(results)
  }

  pub fn get_user_data(&mut self, username: &String) -> Result<UserData, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT id, storage_quota, auth_key_hash, salt, encrypted_master_key, encrypted_ed25519_private_key,
      ed25519_public_key, encrypted_x25519_private_key, x25519_public_key, totp_secret,
      creation_date FROM users WHERE username = ?"
    )?;

    statement.query_row([username], |row| {
      Ok(UserData {
        username: username.clone(),
        user_id: row.get(0)?,
        storage_quota: row.get(1)?,
        auth_key_hash: row.get(2)?,
        salt: row.get(3)?,
        encrypted_master_key: row.get(4)?,
        encrypted_ed25519_private_key: row.get(5)?,
        ed25519_public_key: row.get(6)?,
        encrypted_x25519_private_key: row.get(7)?,
        x25519_public_key: row.get(8)?,
        totp_secret: row.get(9)?,
        creation_date: row.get(10)?
      })
    })
  }

  pub fn get_user_storage_used(&mut self, user_id: u64) -> Result<u64, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE owner_id = ?"
    )?;

    statement.query_row([user_id], |row| {
      Ok(row.get(0)?)
    })
  }

  pub fn get_file_from_handle(&mut self, user_id: u64, handle: &String) -> Result<UserFileEntry, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT * FROM files WHERE owner_id = ? AND handle = ?"
    )?;

    statement.query_row(params![user_id, handle], |row| {
      Ok(UserFileEntry {
        owner_id: row.get(0)?,
        volume_id: row.get(1)?,
        handle: row.get(2)?,
        parent_handle: row.get(3)?,
        size: row.get(4)?,
        encrypted_crypt_key: row.get(5)?,
        encrypted_metadata: row.get(6)?
      })
    })
  }

  pub fn get_files_under_handle(&mut self, user_id: u64, handle: &String) -> Result<Vec<UserFileEntry>, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT * FROM files WHERE owner_id = ? AND parent_handle = ?"
    )?;

    let mut results: Vec<UserFileEntry> = Vec::new();
  
    let result_iter = statement.query_map(params![user_id, handle], |row| {
      Ok(UserFileEntry {
        owner_id: row.get(0)?,
        volume_id: row.get(1)?,
        handle: row.get(2)?,
        parent_handle: row.get(3)?,
        size: row.get(4)?,
        encrypted_crypt_key: row.get(5)?,
        encrypted_metadata: row.get(6)?
      })
    })?;
  
    for result in result_iter {
      results.push(result.unwrap());
    }

    Ok(results)
  }

  pub fn get_storage_volumes(&mut self) -> Result<Vec<StorageVolumeEntry>, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT * FROM storage_volumes"
    )?;

    let mut results: Vec<StorageVolumeEntry> = Vec::new();
  
    let result_iter = statement.query_map([], |row| {
      Ok(StorageVolumeEntry {
        id: row.get(0)?,
        name: row.get(1)?,
        volume_type: row.get(2)?,
        path: row.get(3)?,
        priority: row.get(4)?,
        allocation_size: row.get(5)?
      })
    })?;
  
    for result in result_iter {
      results.push(result.unwrap());
    }

    Ok(results)
  }
}
