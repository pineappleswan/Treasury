import { getUserSessionInfo, isUserLoggedIn } from "../../utility/authUtils";
import { TreasuryDatabase } from "../../database/database";

const getUsernameRoute = async (req: any, res: any) => {
	if (isUserLoggedIn(req)) {
		res.send(req.session.username);
	} else {
		res.status(401);
	}
}

/**
 * IMPORTANT: This route assumes that the request is being sent from an authorised user who is 
 * logged in.
 */
const getStorageQuotaRoute = async (req: any, res: any) => {
	const database: TreasuryDatabase = TreasuryDatabase.getInstance();
	const sessionInfo = getUserSessionInfo(req);
	
	try {
		const value = database.getUserStorageQuota(sessionInfo.username!);
		res.json({ value: value });
	} catch (error) {
		console.error(`getStorageQuotaRoute error: ${error}`);
		res.sendStatus(500);
	}
}

/**
 * IMPORTANT: This route assumes that the request is being sent from an authorised user who is 
 * logged in.
 */
const getStorageUsedRoute = async (req: any, res: any) => {
	const database: TreasuryDatabase = TreasuryDatabase.getInstance();
	const sessionInfo = getUserSessionInfo(req);
	
	try {
		const value = database.getUserStorageUsed(sessionInfo.userId!);
		res.json({ value: value });
	} catch (error) {
		console.error(`getStorageUsedRoute error: ${error}`);
		res.sendStatus(500);
	}
}

export {
	getUsernameRoute,
	getStorageQuotaRoute,
	getStorageUsedRoute
}