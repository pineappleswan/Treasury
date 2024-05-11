import { isUserLoggedIn } from "../utility/authUtils";

function ifUserLoggedInRedirectToTreasury(req: any, res: any, next: Function) {
	if (isUserLoggedIn(req)) {
		res.redirect("/treasury");
	} else {
		next();
	}
}

function ifUserLoggedOutRedirectToLogin(req: any, res: any, next: Function) {
	if (isUserLoggedIn(req)) {
		next();
	} else {
		res.redirect("/login");
	}
}

function requireLoggedIn(req: any, res: any, next: Function) {
	if (isUserLoggedIn(req)) {
		next();
	} else {
		res.sendStatus(401);
	}
}

export {
  ifUserLoggedInRedirectToTreasury,
  ifUserLoggedOutRedirectToLogin,
  requireLoggedIn
}
