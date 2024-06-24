use rusqlite::{Connection, Result, params};
use log::info;
use std::path::Path;
use path_absolutize::*;
use crate::Config;

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
  
  // Optional for claim_user() where the storage quota is retrieved from the claim code's data
  pub storage_quota: Option<u64>,

  // Optional only when calling claim_user()
  pub user_id: Option<u64>
}

pub struct UserFileEntry {
  pub owner_id: u64,
  pub handle: String,
  pub parent_handle: String,
  pub size: u64,
  pub encrypted_crypt_key: Option<Vec<u8>>, // Option since some values can be null
  pub encrypted_metadata: Vec<u8>,
  pub signature: Option<Vec<u8>>
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

    let connection = Connection::open(path)?;
    
    // Use WAL mode
    connection.execute_batch("PRAGMA journal_mode=WAL")?;

    let mut database = Database {
      connection: connection
    };

    // Initialise
    database.initialise_tables()?;

    Ok(database)
  }

  pub fn close(self) {
    let _ = self.connection.close();
    info!("Database closed.");
  }

  fn initialise_tables(&mut self) -> Result<()> {
    let tx = self.connection.transaction()?;

    tx.execute(
      "CREATE TABLE IF NOT EXISTS claim_codes (
        code TEXT NOT NULL,
        storage_quota BIGINT NOT NULL DEFAULT 0
      )",
      ()
    )?;

    tx.execute(
      "CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        storage_quota BIGINT NOT NULL DEFAULT 0,
        auth_key_hash TEXT NOT NULL,
        salt BLOB NOT NULL,
        encrypted_master_key BLOB NOT NULL,
        encrypted_ed25519_private_key BLOB NOT NULL,
        ed25519_public_key BLOB NOT NULL,
        encrypted_x25519_private_key BLOB NOT NULL,
        x25519_public_key BLOB NOT NULL
      )",
      ()
    )?;

    tx.execute(
      "CREATE TABLE IF NOT EXISTS filesystem (
        owner_id INTEGER REFERENCES users(id),
        handle TEXT NOT NULL,
        parent_handle TEXT NOT NULL,
        size BIGINT NOT NULL DEFAULT 0,
        encrypted_file_crypt_key BLOB,
        encrypted_metadata BLOB NOT NULL,
        signature BLOB,
        FOREIGN KEY(owner_id) REFERENCES users(id)
      )",
      ()
    )?;

    tx.commit()?;

    Ok(())
  }

  pub fn edit_file_metadata_multiple(&mut self, owner_user_id: u64, requests: &Vec<EditFileMetadataRequest>) -> Result<(), rusqlite::Error> {
    let tx = self.connection.transaction()?;

    for request in requests {
      let _ = tx.execute(
        "UPDATE filesystem SET encrypted_metadata = ? WHERE handle = ? AND owner_id = ?",
        params![request.metadata, request.handle, owner_user_id]
      );
    }

    tx.commit()?;

    Ok(())
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
      "INSERT INTO filesystem (owner_id, handle, parent_handle, size, encrypted_file_crypt_key, encrypted_metadata, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?)",
      params![
        entry.owner_id,
        entry.handle,
        entry.parent_handle,
        entry.size,
        entry.encrypted_crypt_key,
        entry.encrypted_metadata,
        entry.signature
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
      encrypted_ed25519_private_key, ed25519_public_key, encrypted_x25519_private_key, x25519_public_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params![
        request.user_data.username,
        claim_code_data.storage_quota,
        request.user_data.auth_key_hash,
        request.user_data.salt,
        request.user_data.encrypted_master_key,
        request.user_data.encrypted_ed25519_private_key,
        request.user_data.ed25519_public_key,
        request.user_data.encrypted_x25519_private_key,
        request.user_data.x25519_public_key
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
        x25519_public_key: row.get(9)?
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
      ed25519_public_key, encrypted_x25519_private_key, x25519_public_key FROM users WHERE username = ?"
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
        x25519_public_key: row.get(8)?
      })
    })
  }

  pub fn get_user_storage_used(&mut self, user_id: u64) -> Result<u64, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT COALESCE(SUM(size), 0) AS total FROM filesystem WHERE owner_id = ?"
    )?;

    statement.query_row([user_id], |row| {
      Ok(row.get(0)?)
    })
  }

  pub fn get_files_under_handle(&mut self, user_id: u64, handle: &String) -> Result<Vec<UserFileEntry>, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT * FROM filesystem WHERE owner_id = ? AND parent_handle = ?"
    )?;

    let mut results: Vec<UserFileEntry> = Vec::new();
  
    let result_iter = statement.query_map(params![user_id, handle], |row| {
      Ok(UserFileEntry {
        owner_id: row.get(0)?,
        handle: row.get(1)?,
        parent_handle: row.get(2)?,
        size: row.get(3)?,
        encrypted_crypt_key: row.get(4)?,
        encrypted_metadata: row.get(5)?,
        signature: row.get(6)?
      })
    })?;
  
    for result in result_iter {
      results.push(result.unwrap());
    }

    Ok(results)
  }
}
