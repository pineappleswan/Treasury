use std::error::Error;
use num_format::{Locale, ToFormattedString};
use rusqlite::{Connection, Result, params};
use crate::Config;
pub struct Database {
  pub connection: Connection
}

#[derive(Debug)]
pub struct ClaimCodeData {
  pub claim_code: String,
  pub storage_quota: u64
}

#[derive(Debug)]
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

#[derive(Debug)]
pub struct ClaimUserRequest {
  pub claim_code: String,
  pub user_data: UserData
}

impl Database {
  pub fn open(config: &Config) -> Result<Database> {
    println!("Opening database at: {}", config.database_path.as_str());

    let connection = Connection::open(config.database_path.as_str())?;
    
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
    println!("Database closed.");
  }

  fn initialise_tables(&mut self) -> Result<()> {
    let tx = self.connection.transaction()?;

    tx.execute(
      "CREATE TABLE IF NOT EXISTS claimCodes (
				code TEXT NOT NULL,
				storageQuota BIGINT NOT NULL DEFAULT 0
			)",
      ()
    )?;

    tx.execute(
      "CREATE TABLE IF NOT EXISTS users (
				id INTEGER PRIMARY KEY,
				username TEXT NOT NULL,
				storageQuota BIGINT NOT NULL DEFAULT 0,
				authKeyHash TEXT NOT NULL,
				salt BLOB NOT NULL,
        encryptedMasterKey BLOB NOT NULL,
				encryptedEd25519PrivateKey BLOB NOT NULL,
				ed25519PublicKey BLOB NOT NULL,
				encryptedX25519PrivateKey BLOB NOT NULL,
				x25519PublicKey BLOB NOT NULL
			)",
      ()
    )?;

    tx.execute(
      "CREATE TABLE IF NOT EXISTS filesystem (
				ownerId INTEGER REFERENCES users(id),
				handle TEXT NOT NULL,
				parentHandle TEXT NOT NULL,
				size BIGINT NOT NULL DEFAULT 0,
				encryptedFileCryptKey BLOB NOT NULL,
				encryptedMetadata BLOB NOT NULL,
				signature BLOB NOT NULL,
				FOREIGN KEY(ownerId) REFERENCES users(id)
			)",
      ()
    )?;

    tx.commit()?;

    Ok(())
  }

  pub fn insert_new_claim_code(&mut self, claim_code: &str, storage_quota: u64) -> Result<usize> {
    self.connection.execute(
      "INSERT INTO claimCodes (code, storageQuota)
      VALUES (?, ?)",
      params![claim_code, storage_quota]
    )
  }

  pub fn get_claim_code_info(&mut self, claim_code: &String) -> Result<ClaimCodeData, rusqlite::Error> {
    let mut statement = self.connection.prepare_cached(
      "SELECT code, storageQuota FROM claimCodes WHERE code = ?"
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
      "SELECT code, storageQuota FROM claimCodes"
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
      "SELECT id, username, storageQuota, authKeyHash, salt, encryptedMasterKey, encryptedEd25519PrivateKey,
      ed25519PublicKey, encryptedX25519PrivateKey, x25519PublicKey FROM users"
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
      "SELECT id, storageQuota, authKeyHash, salt, encryptedMasterKey, encryptedEd25519PrivateKey,
      ed25519PublicKey, encryptedX25519PrivateKey, x25519PublicKey FROM users WHERE username = ?"
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
      "SELECT COALESCE(SUM(size), 0) AS total FROM filesystem WHERE ownerId = ?"
    )?;

    statement.query_row([user_id], |row| {
      Ok(row.get(0)?)
    })
  }

  pub fn claim_user(&mut self, request: &ClaimUserRequest) -> Result<(), rusqlite::Error> {  
    let claim_code_data = self.get_claim_code_info(&request.claim_code)?;
  
    println!("Claiming: {} with quota: {}", claim_code_data.claim_code, claim_code_data.storage_quota.to_formatted_string(&Locale::en));

    // Create a new transaction
    let tx = self.connection.transaction()?;

    // Delete the claim code
    tx.execute(
      "DELETE FROM claimCodes WHERE code = ?",
      [&request.claim_code]
    )?;

    // Create a new user
    tx.execute(
      "INSERT INTO users (username, storageQuota, authKeyHash, salt, encryptedMasterKey,
      encryptedEd25519PrivateKey, ed25519PublicKey, encryptedX25519PrivateKey, x25519PublicKey)
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
}
