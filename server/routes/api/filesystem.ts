import { BackendUserFile, TreasuryDatabase } from "../../database/database";
import { getUserSessionInfo } from "../../utility/authUtils";
import { EditMetadataEntry } from "../../../src/common/commonTypes";
import cryptoRandomString from "crypto-random-string";
import CONSTANTS from "../../../src/common/constants";
import Joi from "joi";
import base64js from "base64-js";
import env from "../../env";

const getFilesystemSchema = Joi.object({
	handle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
		.alphanum()
		.required()
});

const getFilesystemRoute = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);
	const { handle } = req.body;

	// Check with schema
	try {
		await getFilesystemSchema.validateAsync(req.body);
	} catch (error) {
		console.error(`User (${sessionInfo.userId}) tried to get filesystem but failed the schema!`);
		res.sendStatus(400);

		if (env.DEVELOPMENT_MODE)
			console.error(error);

		return;
	}

	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance();
		const entries = database.getUserFilesUnderHandle(sessionInfo.userId!, handle);
		
		if (entries.length > 0) {
			const response: any[] = [];
			
			entries.forEach((entry) => {
				const info = {
					handle: entry.handle,
					size: entry.size,
					encryptedFileCryptKeyB64: base64js.fromByteArray(entry.encryptedFileCryptKey),
					encryptedMetadataB64: base64js.fromByteArray(entry.encryptedMetadata),
					signature: entry.signature
				};

				response.push(info);
			});

			res.json({ data: response })
		} else {
			console.log("undefined entries");
			res.sendStatus(500);
			return;
		}
	} catch (error) {
		console.error(error);
		res.sendStatus(500);
	}
};

const createFolderSchema = Joi.object({
	parentHandle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
		.alphanum()
		.required(),

	encryptedMetadataB64: Joi.string()
		.base64()
		.max(CONSTANTS.ENCRYPTED_FILE_METADATA_MAX_SIZE, "base64")
		.required(),
});

const createFolderRoute = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);
	const { parentHandle, encryptedMetadataB64 } = req.body;

	// Ensure user id is valid
	if (sessionInfo.userId === null) {
		res.sendStatus(400);
		return;
	}

	// Validate with schema
	try {
		await createFolderSchema.validateAsync(req.body);
	} catch (error) {
		res.sendStatus(400);

		if (env.DEVELOPMENT_MODE)
			console.error(error);

		return;
	}

	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance();
		
		// Generate new handle for the folder
		const handle = cryptoRandomString({ length: CONSTANTS.FILE_HANDLE_LENGTH, type: "alphanumeric" });

		// Create the file entry and add it to the database
		const fileInfo: BackendUserFile = {
			ownerId: sessionInfo.userId,
			handle: handle,
			parentHandle: parentHandle,
			size: 0,
			encryptedFileCryptKey: Buffer.alloc(0), // No file crypt key as folders don't have file data
			encryptedMetadata: Buffer.from(base64js.toByteArray(encryptedMetadataB64)),
			signature: "" // No signature because folders don't have any file data that can be signed
		};

		database.insertUserFile(fileInfo);

		// Send handle to client
		res.json({ handle: handle });
	} catch (error) {
		console.error(error);
		res.sendStatus(500);
	}
};

const editSingleMetadataSchema = Joi.object({
	handle: Joi.string()
		.length(CONSTANTS.FILE_HANDLE_LENGTH)
		.alphanum()
		.required(),

	encryptedMetadataB64: Joi.string()
		.base64()
		.max(CONSTANTS.ENCRYPTED_FILE_METADATA_MAX_SIZE, "base64")
		.required(),
});

const editMetadataSchema = Joi.array().items(editSingleMetadataSchema);

const editMetadataRoute = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);

	try {
		await editMetadataSchema.validateAsync(req.body);
	} catch (error) {
		res.sendStatus(400);

		if (env.DEVELOPMENT_MODE)
			console.error(error);

		return;
	}

	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance()
		const data = req.body as EditMetadataEntry[];

		database.database.transaction(() => {
			data.forEach(entry => {
				const encryptedMetadata = Buffer.from(base64js.toByteArray(entry.encryptedMetadataB64));
				database.editEncryptedMetadata(sessionInfo.userId!, entry.handle, encryptedMetadata);
			});
		})();

		res.sendStatus(200);
	} catch (error) {
		console.error(error);
		res.sendStatus(500);
	}
};

export {
	getFilesystemRoute,
	createFolderRoute,
	editMetadataRoute
}
