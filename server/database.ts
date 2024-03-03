import Database from "better-sqlite3";
import { LogError, LogMessage } from "./logging";
import { Mutex } from "async-mutex";
import fs from "fs";

type TreasuryDatabaseInfo = {
  databaseFilePath: string; // Must include the database file name as well, not simply the directory only
};

type UnclaimedUserInfo = {
  claimCode: string,
  storageQuota: number,
  passwordPublicSalt: string,
  passwordPrivateSalt: string,
  masterKeySalt: string,
};

type UserInfo = {
  username: string,
  storageQuota: number,
  passwordHash: string,
  passwordPublicSalt: string,
  passwordPrivateSalt: string,
  masterKeySalt: string,
  claimCode: string
};

type ClaimUserInfo = {
  claimCode: string,
  username: string,
  passwordHash: string,
};

type FileInfo = {
  handle: string,
  encryptedParentHandle: Buffer, // Structure: 1. Nonce (24B) 2. Data (...) 3. poly1305 auth tag (16B)
  encryptedFileName: Buffer,     // Structure: 1. Nonce (24B) 2. Data (...) 3. poly1305 auth tag (16B)
};

class TreasuryDatabase {
  private database: Database.Database;
  private mutex: Mutex;

  constructor(createInfo: TreasuryDatabaseInfo) {
    const databaseAlreadyExists = fs.existsSync(createInfo.databaseFilePath);

    this.mutex = new Mutex();
    this.database = new Database(createInfo.databaseFilePath);
    
    // Initialise database if it didn't already exist
    if (!databaseAlreadyExists) {
      this.initialiseDatabase();
    }

    LogMessage("Database loaded.");
  }

  private initialiseDatabase() {
    this.database.pragma("journal_mode = WAL");

    // Create tables
    const createUnclaimedUsersTable = this.database.prepare(`
      CREATE TABLE unclaimedUsers (
        claimCode TEXT NOT NULL,
        storageQuota BIGINT NOT NULL DEFAULT 0,
        passwordPublicSalt TEXT NOT NULL,
        passwordPrivateSalt TEXT NOT NULL,
        masterKeySalt TEXT NOT NULL
      )
    `);

    const createUsersTable = this.database.prepare(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        storageQuota BIGINT NOT NULL DEFAULT 0,
        passwordHash TEXT NOT NULL,
        passwordPublicSalt TEXT NOT NULL,
        passwordPrivateSalt TEXT NOT NULL,
        masterKeySalt TEXT NOT NULL,
        claimCode TEXT NOT NULL
      )
    `);

    const createFilesystemTable = this.database.prepare(`
      CREATE TABLE filesystem (
        ownerId INTEGER REFERENCES users(id),
        handle TEXT NOT NULL,
        encryptedParentHandle BLOB NOT NULL,
        encryptedFileName BLOB NOT NULL,
        FOREIGN KEY(ownerId) REFERENCES users(id)
      )
    `);
    
    try {
      const initialiseTransaction = this.database.transaction(() => {
        createUnclaimedUsersTable.run();
        createUsersTable.run();
        createFilesystemTable.run();
      });

      initialiseTransaction();
      LogMessage("Successfully initialised database.");
    } catch (error) {
      LogError(`Failed to initialise database for error: ${error}`);
    }
  }

  claimCodeAlreadyUsed(claimCode: string): boolean {
    const alreadyClaimedUser = this.database.prepare(`SELECT * FROM users WHERE claimCode = ?`).get(claimCode);

    if (alreadyClaimedUser) {
      return true;
    } else {
      return false;
    }
  }

  isClaimCodeValid(claimCode: string): boolean {
    // Verify that the claim code was not already used
    if (this.claimCodeAlreadyUsed(claimCode))
      return false;

    // Find unclaimed user from claim code
    const unclaimedUser = this.database.prepare(`SELECT * FROM unclaimedUsers WHERE claimCode = ?`).get(claimCode);

    if (unclaimedUser) {
      return true;
    } else {
      return false;
    }
  }

  isUsernameTaken(username: string): boolean {
    const user = this.database.prepare(`SELECT * FROM users WHERE username = ?`).get(username);

    if (user) {
      return true;
    } else {
      return false;
    }
  }

  getUserInfo(username: string): UserInfo | undefined {
    const user = this.database.prepare(`SELECT * FROM users WHERE username = ?`).get(username);

    if (user) {
      const info = user as UserInfo;
      return info;
    } else {
      return undefined;
    }
  }

  getUnclaimedUserInfo(claimCode: string): UnclaimedUserInfo | undefined {
    // Check that the claim code is valid
    const claimCodeIsValid = this.isClaimCodeValid(claimCode);

    if (!claimCodeIsValid)
      return undefined;

    // Find unclaimed user from claim code
    const unclaimedUser = this.database.prepare(`SELECT * FROM unclaimedUsers WHERE claimCode = ?`).get(claimCode);
    
    if (!unclaimedUser)
      return undefined;

    try {
      const rawInfo = unclaimedUser as any;
      const info: UnclaimedUserInfo = {
        claimCode: rawInfo.claimCode,
        storageQuota: rawInfo.storageQuota,
        passwordPublicSalt: rawInfo.passwordPublicSalt,
        passwordPrivateSalt: rawInfo.passwordPrivateSalt,
        masterKeySalt: rawInfo.masterKeySalt,
      };

      return info;
    } catch (error) {
      LogError(`Failed to extract information from unclaimed user found with claim code '${claimCode}'. This should not happen!`);
      return undefined;
    }
  }

  createNewUnclaimedUser(info: UnclaimedUserInfo) {
    this.database.prepare(`
      INSERT INTO unclaimedUsers (claimCode, storageQuota, passwordPublicSalt, passwordPrivateSalt, masterKeySalt)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      info.claimCode,
      info.storageQuota,
      info.passwordPublicSalt,
      info.passwordPrivateSalt,
      info.masterKeySalt
    );
  }

  createUserFromUnclaimedUser(info: ClaimUserInfo): boolean {
    // Get the unclaimed user's information
    const unclaimedUserInfo = this.getUnclaimedUserInfo(info.claimCode);

    if (!unclaimedUserInfo)
      return false;

    // Create transaction for removing the unclaimed user entry and creating a new user
    try {
      const transaction = this.database.transaction(() => {
        // Delete unclaimed user
        this.database.prepare(`DELETE FROM unclaimedUsers WHERE claimCode = ?`).run(info.claimCode);

        // Create new user
        this.database.prepare(`
          INSERT INTO users (username, storageQuota, passwordHash, passwordPublicSalt, passwordPrivateSalt, masterKeySalt, claimCode)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          info.username,
          unclaimedUserInfo.storageQuota,
          info.passwordHash,
          unclaimedUserInfo.passwordPublicSalt,
          unclaimedUserInfo.passwordPrivateSalt,
          unclaimedUserInfo.masterKeySalt,
          info.claimCode
        );
      });

      transaction();
    } catch (error) {
      LogError(`Failed to create user from unclaimed user for reason: ${error}`);
      return false;
    }

    return true;
  }

  close() {
    this.database.close();
  }

  get getDatabase(): Database.Database {
    return this.database;
  }

  get getMutex(): Mutex {
    return this.mutex;
  }
};

export type {
  TreasuryDatabaseInfo,
  UnclaimedUserInfo,
  UserInfo,
  ClaimUserInfo,
  FileInfo
};

export {
  TreasuryDatabase
};
