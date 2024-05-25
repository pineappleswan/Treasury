import env from "../env";
import path from "path";

const __dirname = env.__dirname;

async function serveIndexHtml(req: any, res: any) {
	if (env.DEVELOPMENT_MODE) {
		res.sendFile(path.join(__dirname, "index.html"));
	} else {
		res.sendFile(path.join(__dirname, "dist", "index.html"));
	}
}

export default serveIndexHtml;
