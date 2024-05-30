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
        masterKeyEncrypted BLOB NOT NULL,
				ed25519PrivateKeyEncrypted BLOB NOT NULL,
				ed25519PublicKey BLOB NOT NULL,
				x25519PrivateKeyEncrypted BLOB NOT NULL,
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
}
