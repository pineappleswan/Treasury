use rusqlite::{Connection, Result};
use super::config::Config;

pub struct Database {
  pub connection: Connection,
  pub used_claim_codes_cache: Vec<String>
}

impl Database {
  pub fn open(config: &Config) -> Result<Database> {
    println!("Opening database at: {}", config.database_path.as_str());

    let connection = Connection::open(config.database_path.as_str())?;
    
    let mut database = Database {
      connection: connection,
      used_claim_codes_cache: Vec::new()
    };

    // Initialise
    Self::initialise_tables(&mut database)?;

    Ok(database)
  }

  fn initialise_tables(database: &mut Database) -> Result<()> {
    let tx = database.connection.transaction()?;

    tx.execute(
      "CREATE TABLE IF NOT EXISTS unclaimedUsers (
				claimCode TEXT NOT NULL,
				storageQuota BIGINT NOT NULL DEFAULT 0,
				passwordPublicSalt BLOB NOT NULL,
				passwordPrivateSalt BLOB NOT NULL,
				masterKeySalt BLOB NOT NULL
			)",
      ()
    )?;

    tx.execute(
      "CREATE TABLE IF NOT EXISTS users (
				id INTEGER PRIMARY KEY,
				username TEXT NOT NULL,
				storageQuota BIGINT NOT NULL DEFAULT 0,
				passwordHash TEXT NOT NULL,
				passwordPublicSalt BLOB NOT NULL,
				passwordPrivateSalt BLOB NOT NULL,
				masterKeySalt BLOB NOT NULL,
				ed25519PrivateKeyEncrypted BLOB,
				ed25519PublicKey BLOB,
				x25519PrivateKeyEncrypted BLOB,
				x25519PublicKey BLOB
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
}
