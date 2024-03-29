import { getUserSessionInfo, isUserLoggedIn } from "../../utility/authentication";
import { TreasuryDatabase } from "../../database/database";

const getUsernameRoute = async (req: any, res: any) => {
	if (isUserLoggedIn(req)) {
		res.send(req.session.username);
	} else {
		res.status(403);
	}
}

const getStorageQuotaRoute = async (req: any, res: any) => {
	const database: TreasuryDatabase = TreasuryDatabase.getInstance();
	const sessionInfo = getUserSessionInfo(req);
	
	try {
		const value = database.getUserStorageQuota(sessionInfo.username);

		if (value) {
			res.json({ quota: value });
		}
	} catch (error) {
		console.error(`getStorageQuotaRoute error: ${error}`);
		res.sendStatus(500);
	}
}

export {
  getUsernameRoute,
	getStorageQuotaRoute
}
