import { isUserLoggedIn } from "../utility/authentication";

// TODO: simplify this code? one singular auth middleware function?

function ifUserLoggedInRedirectToTreasury(req: any, res: any, next: Function) {
	if (isUserLoggedIn(req)) {
		res.redirect("/treasury");
	} else {
		next();
	}
}

function ifUserLoggedOutRedirectToLogin(req: any, res: any, next: Function) {
	if (isUserLoggedIn(req) == false) {
		res.redirect("/login");
	} else {
		next();
	}
}

function ifUserLoggedOutSendForbidden(req: any, res: any, next: Function) {
	if (isUserLoggedIn(req)) {
		next();
	} else {
		res.sendStatus(403);
	}
}

export {
  ifUserLoggedInRedirectToTreasury,
  ifUserLoggedOutRedirectToLogin,
  ifUserLoggedOutSendForbidden
}
