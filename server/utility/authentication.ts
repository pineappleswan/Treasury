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

export {
	logUserIn,
	logUserOut,
	getLoggedInUsername,
	isUserLoggedIn,
};
