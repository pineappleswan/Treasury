import SqliteDatabase from "better-sqlite3";
import fs from "fs";
import path from "path";
import { Mutex } from "async-mutex";

type TreasuryDatabaseCreateInfo = {
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
  ed25519PrivateKeyEncrypted: Buffer,
  ed25519PublicKey: Buffer,
  x25519PrivateKeyEncrypted: Buffer,
  x25519PublicKey: Buffer,
  claimCode: string
};

type ClaimUserInfo = {
  claimCode: string,
  username: string,
  passwordHash: string,
  ed25519PrivateKeyEncrypted: Buffer,
  ed25519PublicKey: Buffer,
  x25519PrivateKeyEncrypted: Buffer,
  x25519PublicKey: Buffer
};

type FileInfo = {
  handle: string,
  size: number, // The encrypted file's size (not original file size)
  encryptedFileCryptKey: Buffer, // 1. Nonce (24B) 2. Key (32B) 3. poly1305 tag (16B)
  encryptedMetadata: Buffer,
  signature: string // Hex string

  /* encryptedMetadata structure (note: keys are small to save space in the json)
    1. Nonce (24B)
    2. Data (... B) as an encrypted json
      [ph] = parent handle
      [fn] = file name (pad name to obfuscate)
      [da] = date added (as unix timestamp)
      [ft] = file type (e.g jpg, png) - NOT from file extension! must parse magic! only fallback to file extension if failed
    3. poly1305 auth tag (16B)
  */
};

// This database is a singleton
class TreasuryDatabase {
  private static database: TreasuryDatabase;
  private static sqliteDatabase: SqliteDatabase.Database;
  private static usedClaimCodes: string[] = [];
  private static mutex: Mutex;

  private constructor(createInfo: TreasuryDatabaseCreateInfo) {
    const databaseAlreadyExists = fs.existsSync(createInfo.databaseFilePath);

    TreasuryDatabase.mutex = new Mutex();
    
    // Initialise parent directory if it doesn't exist
    if (!databaseAlreadyExists) {
      fs.mkdirSync(path.dirname(createInfo.databaseFilePath), { recursive: true });
    }
    
    TreasuryDatabase.sqliteDatabase = new SqliteDatabase(createInfo.databaseFilePath);
    
    // Initialise database if it didn't already exist
    if (!databaseAlreadyExists) {
      this.initialiseDatabase();
    }

    console.log("Database loaded.");
  }
  
  public static initialiseInstance(createInfo: TreasuryDatabaseCreateInfo) {
    if (!this.database) {
      this.database = new TreasuryDatabase(createInfo);
    } else {
      throw new Error("Tried to initialise database again when it's already initialised!");
    }
  }

  public static getInstance(): TreasuryDatabase {
    return TreasuryDatabase.database;
  };

  public get database(): SqliteDatabase.Database {
    return TreasuryDatabase.sqliteDatabase;
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
        ed25519PrivateKeyEncrypted BLOB,
        ed25519PublicKey BLOB,
        x25519PrivateKeyEncrypted BLOB,
        x25519PublicKey BLOB
      )
    `);

    const createFilesystemTable = this.database.prepare(`
      CREATE TABLE filesystem (
        ownerId INTEGER REFERENCES users(id),
        handle TEXT NOT NULL,
        size BIGINT NOT NULL DEFAULT 0,
        encryptedFileCryptKey BLOB NOT NULL,
        encryptedMetadata BLOB NOT NULL,
        signature TEXT NOT NULL,
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
      console.log("Successfully initialised database.");
    } catch (error) {
      console.error(`Failed to initialise database for error: ${error}`);
    }
  }

  public isClaimCodeValid(claimCode: string): boolean {
    // Verify that the claim code was not already used
    if (TreasuryDatabase.usedClaimCodes.indexOf(claimCode) != -1)
      return false;

    // Find unclaimed user from claim code
    const unclaimedUser = this.database.prepare(`SELECT * FROM unclaimedUsers WHERE claimCode = ?`).get(claimCode);

    if (unclaimedUser) {
      return true;
    } else {
      return false;
    }
  }

  public isUsernameTaken(username: string): boolean {
    const user = this.database.prepare(`SELECT * FROM users WHERE username = ?`).get(username);

    if (user) {
      return true;
    } else {
      return false;
    }
  }

  public getUserInfo(username: string): UserInfo | undefined {
    const user: any = this.database.prepare(`SELECT * FROM users WHERE username = ?`).get(username);

    if (user) {
      const info: UserInfo = {
        username: user.username,
        storageQuota: user.storageQuota,
        passwordHash: user.passwordHash,
        passwordPublicSalt: user.passwordPublicSalt,
        passwordPrivateSalt: user.passwordPrivateSalt,
        masterKeySalt: user.masterKeySalt,
        ed25519PrivateKeyEncrypted: user.ed25519PrivateKeyEncrypted,
        ed25519PublicKey: user.ed25519PublicKey,
        x25519PrivateKeyEncrypted: user.x25519PrivateKeyEncrypted,
        x25519PublicKey: user.x25519PublicKey,
        claimCode: user.claimCode,
      };

      return info;
    } else {
      return undefined;
    }
  }

  public getUserId(username: string): number | undefined {
    const user: any = this.database.prepare(`SELECT id FROM users WHERE username = ?`).get(username);

    if (user) {
      return user.id;
    } else {
      return undefined
    }
  }

  public getUserFilesystem(userId: number): FileInfo[] | undefined {
    const entries = this.database.prepare(`SELECT * FROM filesystem WHERE ownerId = ?`).all(userId);

    if (entries) {
      const data: FileInfo[] = [];

      entries.forEach((entry: any) => {
        data.push({
          handle: entry.handle,
          size: entry.size,
          encryptedFileCryptKey: entry.encryptedFileCryptKey,
          encryptedMetadata: entry.encryptedMetadata,
          signature: entry.signature
        });
      });

      return data;
    } else {
      return undefined;
    }
  }

  public getUserStorageQuota(username: string): number | undefined {
    const data: any = this.database.prepare(`SELECT storageQuota FROM users WHERE username = ?`).get(username);

    if (data) {
      return data.storageQuota as number;
    } else {
      return undefined;
    }
  }

  // TODO: boolean argument for using a cache. basically there will be a dictionary to store the handle owner ids so no need to do sql requests so much + clear cache functions
  public getFileHandleOwnerUserId(handle: string): number | undefined {
    const data: any = this.database.prepare(`SELECT ownerId FROM filesystem WHERE handle = ?`).get(handle);

    if (data) {
      return data.ownerId as number;
    } else {
      return undefined;
    }
  }

  public getEncryptedFileCryptKey(handle: string): Buffer | undefined {
    const data: any = this.database.prepare(`SELECT encryptedFileCryptKey FROM filesystem WHERE handle = ?`).get(handle);

    if (data) {
      return data.encryptedFileCryptKey as Buffer;
    } else {
      return undefined;
    }
  }

  public createFileEntry(ownerUserId: number, info: FileInfo) {
    this.database.prepare(`
      INSERT INTO filesystem (ownerId, handle, size, encryptedFileCryptKey, encryptedMetadata, signature)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      ownerUserId,
      info.handle,
      info.size,
      info.encryptedFileCryptKey,
      info.encryptedMetadata,
      info.signature
    );
  }

  public getUnclaimedUserInfo(claimCode: string): UnclaimedUserInfo | undefined {
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
      console.error(`Failed to extract information from unclaimed user found with claim code '${claimCode}'. This should not happen!`);
      return undefined;
    }
  }

  public createNewUnclaimedUser(info: UnclaimedUserInfo) {
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

  public createUserFromUnclaimedUser(info: ClaimUserInfo): boolean {
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
          INSERT INTO users (username, storageQuota, passwordHash, passwordPublicSalt, passwordPrivateSalt, masterKeySalt, ed25519PrivateKeyEncrypted, ed25519PublicKey, x25519PrivateKeyEncrypted, x25519PublicKey)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          info.username,
          unclaimedUserInfo.storageQuota,
          info.passwordHash,
          unclaimedUserInfo.passwordPublicSalt,
          unclaimedUserInfo.passwordPrivateSalt,
          unclaimedUserInfo.masterKeySalt,
          info.ed25519PrivateKeyEncrypted,
          info.ed25519PublicKey,
          info.x25519PrivateKeyEncrypted,
          info.x25519PublicKey
        );
      });

      transaction();

      // Remember that the claim code has been used
      TreasuryDatabase.usedClaimCodes.push(info.claimCode);
    } catch (error) {
      console.error(`Failed to create user from unclaimed user for reason: ${error}`);
      return false;
    }

    return true;
  }

  public getAllUsers(): UserInfo[] {
    const users = this.database.prepare(`SELECT * FROM users`).all();
    return users as UserInfo[];
  }

  public getAllUnclaimedUsers(): UnclaimedUserInfo[] {
    const unclaimedUsers = this.database.prepare(`SELECT * FROM unclaimedUsers`).all();
    return unclaimedUsers as UnclaimedUserInfo[];
  }

  public close() {
    this.database.close();
  }

  public get getDatabase(): SqliteDatabase.Database {
    return this.database;
  }

  public get getMutex(): Mutex {
    return TreasuryDatabase.mutex;
  }
};

export type {
  TreasuryDatabaseCreateInfo,
  UnclaimedUserInfo,
  UserInfo,
  ClaimUserInfo,
  FileInfo
};

export {
  TreasuryDatabase
};
