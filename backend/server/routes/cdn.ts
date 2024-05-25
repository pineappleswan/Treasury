import fs from "fs";
import path from "path";
import env from "../env";

const ffmpegCoreWasmPath = path.join(env.__dirname, "cdn", "ffmpeg", "ffmpeg-core.wasm");
const ffmpegCoreJsPath = path.join(env.__dirname, "cdn", "ffmpeg", "ffmpeg-core.js");
//const ffmpegCoreWorkerJsPath = path.join(env.__dirname, "cdn", "ffmpeg", "ffmpeg-core.worker.js");

const getFFmpegCoreWasmRoute = async (req: any, res: any) => {
	const fileContents = await fs.promises.readFile(ffmpegCoreWasmPath);
	res.send(fileContents);
};

const getFFmpegCoreJsRoute = async (req: any, res: any) => {
	const fileContents = await fs.promises.readFile(ffmpegCoreJsPath);
	res.send(fileContents);
};

/*
const getFFmpegCoreWorkerJsRoute = async (req: any, res: any) => {
	const fileContents = await fs.promises.readFile(ffmpegCoreJsPath);
	res.send(fileContents);
};
*/

export {
	getFFmpegCoreWasmRoute,
	getFFmpegCoreJsRoute,
	//getFFmpegCoreWorkerJsRoute
}
