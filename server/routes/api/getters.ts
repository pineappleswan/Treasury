import { getLoggedInUsername, isUserLoggedIn } from "../../utility/authentication";
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

	if (isUserLoggedIn(req)) {
		const username = getLoggedInUsername(req);
		let quota = 0;
		
		try {
			const value = database.getUserStorageQuota(username);

			if (value) {
				quota = value;
			}
		} catch (error) {
			console.error(`getStorageQuotaRoute error: ${error}`);
		}

		res.json({ quota: quota });
	} else {
		res.json({ quota: 0 });
	}
}

export {
  getUsernameRoute,
	getStorageQuotaRoute
}
