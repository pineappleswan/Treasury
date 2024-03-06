import { json } from "@solidjs/router";
import { uint8ArrayToHexString } from "../../../src/common/common";
import { TreasuryDatabase, UserInfo, ClaimUserInfo } from "../../database";
import { getLoggedInUsername, getUserSessionInfo } from "../../utility/authentication";

const getFilesystemRoute = (req: any, res: any) => {
	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance();
		const sessionInfo = getUserSessionInfo(req);
		const entries = database.getUserFilesystem(sessionInfo.userId);
		
		if (entries) {
			console.log(`Found entries of size: ${entries.length}`);
			
			const response: any[] = [];
			
			entries.forEach((entry) => {
				console.log(new Uint8Array(entry.encryptedFileCryptKey));

				const info = {
					handle: entry.handle,
					size: entry.size,
					encryptedFileCryptKey: entry.encryptedFileCryptKey.toString("base64"),
					encryptedMetadata: entry.encryptedMetadata.toString("base64")
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
