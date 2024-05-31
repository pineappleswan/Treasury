use std::error::Error;
use num_format::{Locale, ToFormattedString};
use rusqlite::{Connection, Result, params};
use super::config::Config;

pub struct Database {
  pub connection: Connection,
  used_claim_codes_cache: Vec<String>
}

#[derive(Debug)]
pub struct ClaimCodeData {
  pub claim_code: String,
  pub storage_quota: u64
}

#[derive(Debug)]
pub struct ClaimUserData {
  pub claim_code: String,
  pub username: String,
  pub auth_key_hash: String,
  pub salt: Vec<u8>,
  pub encrypted_master_key: Vec<u8>,
  pub encrypted_ed25519_private_key: Vec<u8>,
  pub ed25519_public_key: Vec<u8>,
  pub encrypted_x25519_private_key: Vec<u8>,
  pub x25519_public_key: Vec<u8>
}

impl Database {
  pub fn open(config: &Config) -> Result<Database> {
    println!("Opening database at: {}", config.database_path.as_str());

    let connection = Connection::open(config.database_path.as_str())?;
    
    // Use WAL mode
    connection.execute_batch("PRAGMA journal_mode=WAL")?;

    let mut database = Database {
      connection: connection,
      used_claim_codes_cache: Vec::new()
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
				signature TEXT NOT NULL,
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

  pub fn get_claim_code_info(&mut self, claim_code: String) -> Result<Option<ClaimCodeData>> {
    let mut select_task = self.connection.prepare(
      "SELECT code, storageQuota FROM claimCodes WHERE code = ?"
    )?;

    let mut rows = select_task.query([claim_code])?;

    if let Some(row) = rows.next()? {
      Ok(Some(ClaimCodeData {
        claim_code: row.get(0)?,
        storage_quota: row.get(1)?
      }))
    } else {
      Ok(None)
    }
  }

  pub fn get_available_claim_codes(&mut self) -> Result<Vec<ClaimCodeData>> {
    let mut select_task = self.connection.prepare(
      "SELECT code, storageQuota FROM claimCodes"
    )?;

    let mut results: Vec<ClaimCodeData> = Vec::new();
  
    let mut result_iter = select_task.query_map([], |row| {
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

  pub fn claim_user(&mut self, claim_user_data: &ClaimUserData) -> Result<(), Box<dyn Error>> {  
    let claim_code_info = self.get_claim_code_info(claim_user_data.claim_code.clone())?
    .ok_or_else(|| "Invalid claim code")?;
  
    println!("Claiming: {} with quota: {}", claim_code_info.claim_code, claim_code_info.storage_quota.to_formatted_string(&Locale::en));

    // Create a new transaction
    let tx = self.connection.transaction()?;

    // Delete the claim code
    tx.execute(
      "DELETE FROM claimCodes WHERE code = ?",
      [claim_user_data.claim_code.clone()]
    )?;

    // Create a new user
    tx.execute(
      "INSERT INTO users (username, storageQuota, authKeyHash, salt, encryptedMasterKey,
      encryptedEd25519PrivateKey, ed25519PublicKey, encryptedX25519PrivateKey, x25519PublicKey)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params![
        claim_user_data.username,
        claim_code_info.storage_quota,
        claim_user_data.auth_key_hash,
        claim_user_data.salt,
        claim_user_data.encrypted_master_key,
        claim_user_data.encrypted_ed25519_private_key,
        claim_user_data.ed25519_public_key,
        claim_user_data.encrypted_x25519_private_key,
        claim_user_data.x25519_public_key,
      ]
    )?;

    tx.commit()?;

    Ok(())
  }
}
