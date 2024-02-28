function logUserIn(req: any, username: string) {
	req.session.username = username,
	req.session.loggedIn = true;
}

function logUserOut(req: any) {
	req.session.username = "",
	req.session.loggedIn = false;
}

function getLoggedInUsername(req: any) {
	return req.session.username;
}

function isUserLoggedIn(req: any) {
	return (req.session.loggedIn == true ? true : false);
}

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
	logUserIn,
	logUserOut,
	getLoggedInUsername,
	isUserLoggedIn,
	ifUserLoggedInRedirectToTreasury,
	ifUserLoggedOutRedirectToLogin,
	ifUserLoggedOutSendForbidden
};
