import { Mutex } from "async-mutex";
import SqliteDatabase from "better-sqlite3";
import fs from "fs";
import path from "path";

/**
 * A type containing data about an unclaimed user.
 */
type UnclaimedUserData = {
	claimCode: string;
	storageQuota: number;
	passwordPublicSalt: Buffer;
	passwordPrivateSalt: Buffer;
	masterKeySalt: Buffer;
};

/**
 * A type containing account data for an individual user but not any data on their files.
 */
type UserData = {
	id: number;
	username: string;
	storageQuota: number;
	passwordHash: string;
	passwordPublicSalt: Buffer;
	passwordPrivateSalt: Buffer;
	masterKeySalt: Buffer;
	ed25519PrivateKeyEncrypted: Buffer;
	ed25519PublicKey: Buffer;
	x25519PrivateKeyEncrypted: Buffer;
	x25519PublicKey: Buffer;
};

/**
 * A type containing data used for when someone wants to claim an unclaimed user.
 */
type ClaimUserRequest = {
	claimCode: string;
	username: string;
	passwordHash: string;
	ed25519PrivateKeyEncrypted: Buffer;
	ed25519PublicKey: Buffer;
	x25519PrivateKeyEncrypted: Buffer;
	x25519PublicKey: Buffer;
};

/**
 * A type containing data about an individual user file for the backend.
 */
type BackendUserFile = {
	ownerId: number;
	handle: string;
	parentHandle: string;
	size: number; // The raw file's size
	encryptedFileCryptKey: Buffer; // 1. Nonce (24B) 2. Key (32B) 3. poly1305 tag (16B)
	encryptedMetadata: Buffer; // Check the documentation for information about the structure of this
	signature: string; // Base64 string
};


/**
 * A singleton class for the backend SQLite database used for storing account data, file metadata 
 * and more.
 * @class
 */
class TreasuryDatabase {
	private static database: TreasuryDatabase;
	private static sqliteDatabase: SqliteDatabase.Database;
	private static usedClaimCodes: string[] = []; // Fast cache for remembering used claim codes.
	// private static mutex: Mutex;

	/**
	 * @param {string} databaseFilePath - The file path of the database file.
	 */
	private constructor(databaseFilePath: string) {
		const databaseAlreadyExists = fs.existsSync(databaseFilePath);

		// TreasuryDatabase.mutex = new Mutex();
		
		// Initialise parent directory if it doesn't exist
		if (!databaseAlreadyExists) {
			fs.mkdirSync(path.dirname(databaseFilePath), { recursive: true });
			console.log("Created parent directory for the database.");
		}
		
		TreasuryDatabase.sqliteDatabase = new SqliteDatabase(databaseFilePath);
		
		// Initialise database if it didn't already exist
		if (!databaseAlreadyExists) {
			this.initialiseSQLiteDatabase();
		}

		console.log("Database online.");
	}
	
	/**
	 * Initialises the database.
	 * @param {string} databaseFilePath - The file path of the database file.
	 */
	public static initialise(databaseFilePath: string) {
		if (!this.database) {
			this.database = new TreasuryDatabase(databaseFilePath);
		} else {
			throw new Error("Tried to initialise database again when it's already initialised!");
		}
	}

	/**
	 * Gets the instance of the database.
	 * @returns {TreasuryDatabase} The instance of the database.
	 */
	public static getInstance(): TreasuryDatabase {
		return TreasuryDatabase.database;
	};

	/**
	 * Returns the internal SQLite database.
	 * @returns {SqliteDatabase.Database} The internal SQLite database.
	 */
	public get database(): SqliteDatabase.Database {
		return TreasuryDatabase.sqliteDatabase;
	}

	/**
	 * Initialises the internal SQLite database. This should only be called once when the database
	 * is first created.
	 */
	private initialiseSQLiteDatabase() {
		this.database.pragma("journal_mode = WAL");

		// Create tables
		const createUnclaimedUsersTable = this.database.prepare(`
			CREATE TABLE unclaimedUsers (
				claimCode TEXT NOT NULL,
				storageQuota BIGINT NOT NULL DEFAULT 0,
				passwordPublicSalt BLOB NOT NULL,
				passwordPrivateSalt BLOB NOT NULL,
				masterKeySalt BLOB NOT NULL
			)
		`);

		const createUsersTable = this.database.prepare(`
			CREATE TABLE users (
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
			)
		`);

		const createFilesystemTable = this.database.prepare(`
			CREATE TABLE filesystem (
				ownerId INTEGER REFERENCES users(id),
				handle TEXT NOT NULL,
				parentHandle TEXT NOT NULL,
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

	/**
	 * Checks if the claim code for an unclaimed user is valid.
	 * @param {string} claimCode - The claim code of an unclaimed user.
	 * @returns {boolean} True if `claimCode` is valid; false otherwise.
	 */
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

	/**
	 * Checks if a username already exists internally in the database.
	 * @param {string} username - The username to check.
	 * @returns {boolean} True if `username` is already taken; false otherwise.
	 */
	public isUsernameTaken(username: string): boolean {
		const user = this.database.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
		return user ? true : false;
	}

	/**
	 * Gets the account data of a user from their username if the username is valid.
	 * @param {string} username - The username to get data about.
	 * @returns {UserData | null} The data of the user if the username is valid; otherwise 
	 * null is returned.
	 */
	public getUserData(username: string): UserData | null {
		const user = this.database.prepare(`SELECT * FROM users WHERE username = ?`).get(username);

		if (user) {
			return user as UserData;
		} else {
			return null;
		}
	}

	/**
	 * Gets all the user files under a specified handle.
	 * @param {number} userId - The id of the user.
	 * @param {string} handle - The handle to get the children of.
	 * @returns {BackendUserFile[]} The user files under the specified handle.
	 */
	public getUserFilesUnderHandle(userId: number, handle: string): BackendUserFile[] {
		const entries = this.database.prepare(`SELECT * FROM filesystem WHERE ownerId = ? AND parentHandle = ?`).all(userId, handle);

		if (entries) {
			const data: BackendUserFile[] = [];

			entries.forEach((entry: any) => data.push(entry as BackendUserFile));

			return data;
		} else {
			return [];
		}
	}

	/**
	 * Gets the storage quota of a user by their username.
	 * @param {string} username - The username to get the storage quota from.
	 * @returns {number | null} The storage quota allocated to the user; otherwise null if the username 
	 * is invalid.
	 */
	public getUserStorageQuota(username: string): number | null {
		const data: any = this.database.prepare(`SELECT storageQuota FROM users WHERE username = ?`).get(username);

		if (data) {
			return data.storageQuota as number;
		} else {
			return null;
		}
	}

	/**
	 * Gets the storage used in bytes by a user.
	 * @param {number} userId - The user id of the user to check.
	 * @returns {number | null} The storage used by the user; otherwise null if the user id is invalid. 
	 */
	public getUserStorageUsed(userId: number): number | null {
		const data: any = this.database.prepare(`SELECT COALESCE(SUM(size), 0) AS total FROM filesystem WHERE ownerId = ?`).get(userId);

		if (data) {
			return data.total as number;
		} else {
			return null;
		}
	}

	// TODO: boolean argument for using a cache. basically there will be a dictionary to store the handle owner ids so no need to do sql requests so much + clear cache functions

	/**
	 * Gets the metadata of a user file.
	 * @param {string} handle - The handle of the file. 
	 * @returns {BackendUserFile} The metadata of the user file; otherwise null if invalid.
	 */
	public getUserFile(handle: string): BackendUserFile | null {
		const data: any = this.database.prepare(`SELECT * FROM filesystem WHERE handle = ?`).get(handle);

		if (data) {
			return data as BackendUserFile;
		} else {
			return null;
		}
	}

	/**
	 * Inserts a new user file into the database.
	 * @param {BackendUserFile} file - The file metadata to insert.
	 */
	public insertUserFile(file: BackendUserFile) {
		this.database.prepare(`
			INSERT INTO filesystem (ownerId, handle, parentHandle, size, encryptedFileCryptKey, encryptedMetadata, signature)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`).run(
			file.ownerId,
			file.handle,
			file.parentHandle,
			file.size,
			file.encryptedFileCryptKey,
			file.encryptedMetadata,
			file.signature
		);
	}

	/**
	 * Updates the encrypted metadata of a user file in the database.
	 * @param {number} ownerUserId - The user id of the owner of the file.
	 * @param {string} handle - The handle of the file. 
	 * @param {Buffer} newEncryptedMetadata - The new encrypted metadata buffer. 
	 */
	public editEncryptedMetadata(ownerUserId: number, handle: string, newEncryptedMetadata: Buffer) {
		this.database.prepare(`
			UPDATE filesystem SET encryptedMetadata = ? WHERE handle = ? AND ownerId = ?
		`).run(
			newEncryptedMetadata,
			handle,
			ownerUserId
		);
	}

	/**
	 * Gets data about an unclaimed user.
	 * @param {string} claimCode - The claim code of the unclaimed user.
	 * @returns {UnclaimedUserData | null} The data of the unclaimed user; otherwise null if the 
	 * claim code was invalid.
	 */
	public getUnclaimedUserData(claimCode: string): UnclaimedUserData | null {
		// Check that the claim code is valid
		const claimCodeIsValid = this.isClaimCodeValid(claimCode);

		if (!claimCodeIsValid)
			return null;

		// Find unclaimed user from claim code
		const unclaimedUser = this.database.prepare(`SELECT * FROM unclaimedUsers WHERE claimCode = ?`).get(claimCode);
		
		if (!unclaimedUser)
			return null;

		return unclaimedUser as UnclaimedUserData;
	}

	/**
	 * Inserts a new unclaimed user into the database which can be claimed by a user via its claim code.
	 * @param {UnclaimedUserData} data - The data of the unclaimed user.
	 */
	public insertUnclaimedUser(data: UnclaimedUserData) {
		this.database.prepare(`
			INSERT INTO unclaimedUsers (claimCode, storageQuota, passwordPublicSalt, passwordPrivateSalt, masterKeySalt)
			VALUES (?, ?, ?, ?, ?)
		`).run(
			data.claimCode,
			data.storageQuota,
			data.passwordPublicSalt,
			data.passwordPrivateSalt,
			data.masterKeySalt
		);
	}

	/**
	 * Uses an unclaimed user entry in the database to create a new user that can be logged in to.
	 * In this process, the unclaimed user entry is deleted.
	 * @param {ClaimUserRequest} request - The data used to claim the user with.
	 * @returns {boolean} True if the operation was successful; false otherwise.
	 */
	public createUserFromUnclaimedUser(request: ClaimUserRequest): boolean {
		// Get the unclaimed user's information
		const unclaimedUserInfo = this.getUnclaimedUserData(request.claimCode);

		if (!unclaimedUserInfo)
			return false;

		// Create transaction for removing the unclaimed user entry and creating a new user
		try {
			this.database.transaction(() => {
				// Delete unclaimed user
				this.database.prepare(`DELETE FROM unclaimedUsers WHERE claimCode = ?`).run(request.claimCode);

				// Create new user
				this.database.prepare(`
					INSERT INTO users (username, storageQuota, passwordHash, passwordPublicSalt, passwordPrivateSalt,
					masterKeySalt, ed25519PrivateKeyEncrypted, ed25519PublicKey, x25519PrivateKeyEncrypted, x25519PublicKey)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`).run(
					request.username,
					unclaimedUserInfo.storageQuota,
					request.passwordHash,
					unclaimedUserInfo.passwordPublicSalt,
					unclaimedUserInfo.passwordPrivateSalt,
					unclaimedUserInfo.masterKeySalt,
					request.ed25519PrivateKeyEncrypted,
					request.ed25519PublicKey,
					request.x25519PrivateKeyEncrypted,
					request.x25519PublicKey
				);
			})();

			// Remember that the claim code has been used
			TreasuryDatabase.usedClaimCodes.push(request.claimCode);

			return true;
		} catch (error) {
			console.error(`Failed to create user from unclaimed user for reason: ${error}`);
			return false;
		}
	}

	/**
	 * Gets the account data of all the users in the database.
	 * @returns {UserData[]} The account data of all the users.
	 */
	public getAllUsers(): UserData[] {
		const users = this.database.prepare(`SELECT * FROM users`).all();
		return users as UserData[];
	}

	/**
	 * Gets the data of all the unclaimed users in the database.
	 * @returns {UnclaimedUserData[]} The data of all unclaimed users.
	 */
	public getAllUnclaimedUsers(): UnclaimedUserData[] {
		const unclaimedUsers = this.database.prepare(`SELECT * FROM unclaimedUsers`).all();
		return unclaimedUsers as UnclaimedUserData[];
	}

	/**
	 * Closes the SQLite database connection.
	 */
	public close() {
		this.database.close();
	}

	/**
	 * Returns the SQLite database.
	 */
	public get getDatabase(): SqliteDatabase.Database {
		return this.database;
	}

	/*
	public get getMutex(): Mutex {
		return TreasuryDatabase.mutex;
	}
	*/
};

export type {
	UnclaimedUserData,
	UserData,
	ClaimUserRequest,
	BackendUserFile
};

export {
	TreasuryDatabase
};
