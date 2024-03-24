import { FileInfo, TreasuryDatabase } from "../../database/database";
import { getUserSessionInfo } from "../../utility/authentication";
import CONSTANTS from "../../../src/common/constants";
import Joi from "joi";
import base64js from "base64-js";
import { generateSecureRandomAlphaNumericString } from "../../../src/common/commonCrypto";

const getFilesystemRoute = (req: any, res: any) => {
	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance();
		const sessionInfo = getUserSessionInfo(req);
		const entries = database.getUserFilesystem(sessionInfo.userId);
		
		if (entries) {
			const response: any[] = [];
			
			entries.forEach((entry) => {
				const info = {
					handle: entry.handle,
					sizeOnServer: entry.size,
					encryptedFileCryptKeyB64: base64js.fromByteArray(entry.encryptedFileCryptKey),
					encryptedMetadataB64: base64js.fromByteArray(entry.encryptedMetadata)
				};

				response.push(info);
			});

			res.json({ message: "Success!", data: response })
		} else {
			console.log("undefined entries");
			res.status(500).json({ message: "SERVER ERROR" });
			return;
		}
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "SERVER ERROR" });
	}
};

const createFolderSchema = Joi.object({
	encryptedMetadataB64: Joi.string()
		.base64()
		.required(),
		
	encryptedFileCryptKeyB64: Joi.string()
		.base64()
		.required()
});

const createFolderRoute = async (req: any, res: any) => {
	const sessionInfo = getUserSessionInfo(req);
	const { encryptedMetadataB64, encryptedFileCryptKeyB64 } = req.body;

	try {
		await createFolderSchema.validateAsync({
			encryptedMetadataB64: encryptedMetadataB64,
			encryptedFileCryptKeyB64: encryptedFileCryptKeyB64
		});

		// Check length
		if (base64js.toByteArray(encryptedFileCryptKeyB64).byteLength != CONSTANTS.ENCRYPTED_CRYPT_KEY_SIZE) {
			throw new Error("encryptedFileCryptKeyB64 size is incorrect!");
		}
		
		if (base64js.toByteArray(encryptedMetadataB64).byteLength > CONSTANTS.ENCRYPTED_FILE_METADATA_MAX_SIZE) {
			throw new Error("encryptedMetadataB64 is too big!");
		}
	} catch (error) {
		res.sendStatus(400);
		return;
	}

	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance();
		
		// Generate new handle for the folder
		const handle = generateSecureRandomAlphaNumericString(CONSTANTS.FILE_HANDLE_LENGTH);

		// Create the file entry and add it to the database
		const fileInfo: FileInfo = {
			handle: handle,
			size: 0,
			encryptedFileCryptKey: Buffer.from(base64js.toByteArray(encryptedFileCryptKeyB64)),
			encryptedMetadata: Buffer.from(base64js.toByteArray(encryptedMetadataB64))
		};

		database.createFileEntry(sessionInfo.userId, fileInfo);

		// Send handle to client
		res.status(200).json({ handle: handle });
	} catch (error) {
		console.error(error);
		res.sendStatus(500);
	}
};

export {
	getFilesystemRoute,
	createFolderRoute
}
