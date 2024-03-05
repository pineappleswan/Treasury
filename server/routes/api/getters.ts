import { isUserLoggedIn } from "../../utility/authentication";

const getUsernameRoute = async (req: any, res: any) => {
	if (isUserLoggedIn(req)) {
		res.send(req.session.username);
	} else {
		res.send("NOT LOGGED IN");
	}
}

export {
  getUsernameRoute
}
