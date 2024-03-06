import { json } from "@solidjs/router";
import { uint8ArrayToHexString } from "../../../src/common/common";
import { TreasuryDatabase, UserInfo, ClaimUserInfo } from "../../database";
import { getLoggedInUsername, getUserSessionInfo } from "../../utility/authentication";
import base64js from "base64-js";

const getFilesystemRoute = (req: any, res: any) => {
	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance();
		const sessionInfo = getUserSessionInfo(req);
		const entries = database.getUserFilesystem(sessionInfo.userId);
		
		if (entries) {
			console.log(`Found entries of size: ${entries.length}`);
			
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

			res.json({ success: true, message: "Success!", data: response })
		} else {
			console.log("undefined entries");
			res.status(500).json({ success: false, message: "SERVER ERROR" });
			return;
		}
	} catch (error) {
		console.error(error);
		res.status(500).json({ success: false, message: "SERVER ERROR" });
	}
};

export {
	getFilesystemRoute
}
