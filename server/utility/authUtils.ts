import { TreasuryDatabase } from "../database/database";
import { UserSessionInfo } from "../types";

function logUserIn(req: any, username: string): boolean {
	try {
		const database: TreasuryDatabase = TreasuryDatabase.getInstance();
		const userId = database.getUserId(username);

		if (userId) {
			req.session.username = username,
			req.session.userId = userId;
			req.session.loggedIn = true;

			return true;
		} else {
			console.warn(`Tried to log user in but userId was not found in database. Username: ${username}`);
			return false;
		}
	} catch (error) {
		console.error(error);
		return false;
	}
}

function logUserOut(req: any) {
	req.session.username = null,
	req.session.userId = null;
	req.session.loggedIn = false;
}

function getUserSessionInfo(req: any): UserSessionInfo {
	return {
		username: req.session.username,
		userId: req.session.userId,
		loggedIn: req.session.loggedIn
	}
}

function isUserLoggedIn(req: any) {
	return (req.session.loggedIn === true ? true : false);
}

export type {
	UserSessionInfo
};

export {
	logUserIn,
	logUserOut,
	getUserSessionInfo,
	isUserLoggedIn,
};
