import { isUserLoggedIn, logUserIn, logUserOut } from "../../utility/authUtils";
import { TreasuryDatabase, UserInfo, ClaimUserInfo } from "../../database/database";
import { blake3, argon2id, argon2Verify } from "hash-wasm";
import { randomBytes } from "crypto";
import CONSTANTS from "../../../src/common/constants";
import env from "../../env";
import Joi from "joi";
import base64js from "base64-js";

const optionalKeypairsSchema = Joi.object({
	ed25519PrivateKeyEncryptedB64: Joi.string()
		.base64()
		.length(CONSTANTS.NONCE_BYTE_LENGTH + CONSTANTS.CURVE25519_KEY_BYTE_LENGTH + CONSTANTS.POLY1305_TAG_BYTE_LENGTH, "base64"),

	ed25519PublicKeyB64: Joi.string()
		.base64()
		.length(CONSTANTS.CURVE25519_KEY_BYTE_LENGTH, "base64"),

	x25519PrivateKeyEncryptedB64: Joi.string()
		.base64()
		.length(CONSTANTS.NONCE_BYTE_LENGTH + CONSTANTS.CURVE25519_KEY_BYTE_LENGTH + CONSTANTS.POLY1305_TAG_BYTE_LENGTH, "base64"),

	x25519PublicKeyB64: Joi.string()
		.base64()
		.length(CONSTANTS.CURVE25519_KEY_BYTE_LENGTH, "base64"),
});

const loginSchema = Joi.object({
	username: Joi.string()
		.min(CONSTANTS.MIN_USERNAME_LENGTH)
		.max(CONSTANTS.MAX_USERNAME_LENGTH)
		.alphanum()
		.required(),
	
	// Password length must be this specific because the plaintext password is hashed on the client to obtain
	// a new password in the form of a hash and the hash is HASH_LENGTH bytes. The password is encoded as a 
	// hex string, so multiply HASH_LENGTH by 2 to check against.
	password: Joi.string()
		.length(CONSTANTS.PASSWORD_HASH_SETTINGS.HASH_LENGTH * 2)
		.allow("") // Allow empty passwords for getting the user's public password salt
});

const loginRoute = async (req: any, res: any) => {
  if (isUserLoggedIn(req)) {
		// Forbidden, since already logged in. Also sends a redirect url.
    res.status(403).json({ message: "You're still logged in!", redirect: "/treasury" });
		return;
	}
  
	const { username,	password } = req.body;
	
	// Check with schema
	try {
		await loginSchema.validateAsync({ username: username, password: password });
	} catch (error) {
		res.status(400).json({ message: "Bad request!" });
		return;
	}

	// Get user's info from database
  const database: TreasuryDatabase = TreasuryDatabase.getInstance();
	let userInfo: UserInfo | undefined = undefined;

	try {
		userInfo = database.getUserInfo(username);
	} catch (error) {
		console.error(error);
	}

	// If the username does not exist or it has not been claimed yet, then fake the existance
	// of the account to the user. This prevents an easy check for if a username exists
	if (userInfo == undefined) {
		if (password.length > 0) {
			// Hash the password to pretend that the server is busy checking whether the entered credentials
			// for the non-existant user is correct
			await argon2id({
				password: password,
				salt: randomBytes(CONSTANTS.USER_DATA_SALT_BYTE_LENGTH),
				parallelism: CONSTANTS.PASSWORD_HASH_SETTINGS.PARALLELISM,
				iterations: CONSTANTS.PASSWORD_HASH_SETTINGS.ITERATIONS,
				memorySize: CONSTANTS.PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
				hashLength: CONSTANTS.USER_DATA_SALT_BYTE_LENGTH,
				outputType: "hex"
			});
			
			res.status(400).json({ message: "Incorrect credentials!" });
		} else {
			// Generate a fake public password salt to lie about the existance of this username
			// (the hash must be extremely fast because all we're supposed to do is return a string)
			try {
				const fakePublicSalt = await blake3(
					`${username} ${env.SECRET}`, // Hash requested username with server secret (makes it unique)
					CONSTANTS.USER_DATA_SALT_BYTE_LENGTH * 8 // Specify number of bits of output
				);

				console.log(`Sending fake salt for requested username '${username}': ${fakePublicSalt}`);

				res.json({ publicSalt: fakePublicSalt })
			} catch (error) {
				console.error(error);
				res.status(500).json("SERVER ERROR!");
			}
		}

		return;
	}

	// If the password is empty, send the requested user's public salt
	if (password.length == 0) {
		res.json({ publicSalt: userInfo.passwordPublicSalt });
		return;
	}

	// Authenticate user
	try {
		const verified = await argon2Verify({ password: password, hash: userInfo.passwordHash });

		if (verified) {
			const success = logUserIn(req, username);

			if (success) {
				// No need to send the public keys because the user will generate those themselves so they're less reliant on the server
				res.json({
					message: "Success!",
					masterKeySalt: userInfo.masterKeySalt,
					ed25519PrivateKeyEncryptedB64: base64js.fromByteArray(userInfo.ed25519PrivateKeyEncrypted),
					x25519PrivateKeyEncryptedB64: base64js.fromByteArray(userInfo.x25519PrivateKeyEncrypted),
				});
			} else {
				console.error("Failed to log user in!");
				res.status(500).json({ message: "SERVER ERROR"});
			}

			return;
		} else {
			res.status(400).json({ message: "Incorrect credentials!"});
			return;
		}
	} catch (error) {
		// Invalid hash error means that the passwordHash stored on server is not a valid argon2 hash
		console.error(`Failed to verify user's password: ${error}`);
		res.status(500).json({ message: "SERVER ERROR!"});
	}
}

const claimAccountSchema = Joi.object({
	username: Joi.string()
		.alphanum()
		.min(CONSTANTS.MIN_USERNAME_LENGTH)
		.max(CONSTANTS.MAX_USERNAME_LENGTH),

	password: Joi.string()
		.min(0)
		.max(CONSTANTS.MAX_PASSWORD_LENGTH),

	claimCode: Joi.string()
		.length(CONSTANTS.CLAIM_ACCOUNT_CODE_LENGTH)
		.required(),
});

const claimAccountRoute = async (req: any, res: any) => {
	const {
		claimCode,
		username,
		password,
		ed25519PrivateKeyEncryptedB64,
		ed25519PublicKeyB64,
		x25519PrivateKeyEncryptedB64,
		x25519PublicKeyB64,
	} = req.body;

	// Check with schema
	try {
		await claimAccountSchema.validateAsync({ claimCode: claimCode, username: username, password: password });

		await optionalKeypairsSchema.validateAsync({
			ed25519PrivateKeyEncryptedB64: ed25519PrivateKeyEncryptedB64,
			ed25519PublicKeyB64: ed25519PublicKeyB64,
			x25519PrivateKeyEncryptedB64: x25519PrivateKeyEncryptedB64,
			x25519PublicKeyB64: x25519PublicKeyB64
		});
	} catch (error) {
		console.log(error);
		res.status(400).json({ message: "Bad request!" });
		return;
	}

  const database: TreasuryDatabase = TreasuryDatabase.getInstance();

	// Get unclaimed user information
	const unclaimedUserInfo = database.getUnclaimedUserInfo(claimCode);

	if (unclaimedUserInfo == undefined) {
		res.status(400).json({ message: "Invalid code!" });
		return;
	}

	// If both username and password not given, return information about unclaimed user.
	if (username == undefined && password == undefined) {
		res.json({
			message: "Success!",
			storageQuota: unclaimedUserInfo.storageQuota,
			passwordPublicSalt: unclaimedUserInfo.passwordPublicSalt,
			masterKeySalt: unclaimedUserInfo.masterKeySalt
		});

		return;
	}

	if (!username || !password) {
		res.status(400).json({ message: "Bad request!" });
		return;
	}

	// Check if username already exists
	const usernameIsTaken = database.isUsernameTaken(username);

	if (usernameIsTaken) {
		res.status(400).json({ message: "Username already taken!" });
		return;
	}
	
	// Ensure user has provided their keypair data at this point
	if (!ed25519PrivateKeyEncryptedB64 || !ed25519PublicKeyB64 || !x25519PrivateKeyEncryptedB64 || !x25519PublicKeyB64) {
		res.status(400).json({ message: "Bad request!" });
		return;	
	}
	
	// Hash password with private salt buffer
	const privateSalt = unclaimedUserInfo.passwordPrivateSalt;

	try {
		let passwordHash = await argon2id({
			password: password,
			salt: privateSalt,
			parallelism: CONSTANTS.PASSWORD_HASH_SETTINGS.PARALLELISM,
			iterations: CONSTANTS.PASSWORD_HASH_SETTINGS.ITERATIONS,
			memorySize: CONSTANTS.PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
			hashLength: CONSTANTS.PASSWORD_HASH_SETTINGS.HASH_LENGTH,
			outputType: "encoded"
		});

		if (typeof(passwordHash) != "string")
			throw new Error("hash did not return string type!");

		// Double check if code has not been used at this stage. If it has, then it's concerning because the code was checked to be valid above.
		const stillValid = database.isClaimCodeValid(claimCode);

		if (stillValid == false) {
			console.log(`WARNING: A claim code of ${claimCode} has already been used to create a user and managed to get to the password hashing stage!`);
			res.status(400).json({ message: "Code already used!" });
			return;
		}

		// Finally, claim the user
		const claimUserInfo: ClaimUserInfo = {
			claimCode: claimCode,
			username: username,
			passwordHash: passwordHash,
			ed25519PrivateKeyEncrypted: Buffer.from(base64js.toByteArray(ed25519PrivateKeyEncryptedB64)),
			ed25519PublicKey: Buffer.from(base64js.toByteArray(ed25519PublicKeyB64)),
			x25519PrivateKeyEncrypted: Buffer.from(base64js.toByteArray(x25519PrivateKeyEncryptedB64)),
			x25519PublicKey: Buffer.from(base64js.toByteArray(x25519PublicKeyB64))
		};

		database.createUserFromUnclaimedUser(claimUserInfo);
		res.json({ message: "Success!" });
	} catch (error) {
		console.error(`Password hashing error: ${error}`);
		res.status(500).json({ message: "SERVER ERROR" });
	};
}

const isLoggedInRoute = async (req: any, res: any) => {
	res.json({
		value: isUserLoggedIn(req)
	});
}

const logoutRoute = async (req: any, res: any) => {
	logUserOut(req);
	res.sendStatus(200);
}

export {
  loginRoute,
  claimAccountRoute,
  isLoggedInRoute,
  logoutRoute
}
