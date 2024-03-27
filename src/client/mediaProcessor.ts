import { FFmpeg } from "@ffmpeg/ffmpeg"
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";

type MediaProcessorProgressCallback = (progress: number) => void;

type OptimiseVideoOutputData = {
	videoBinaryData: Uint8Array,
	m3u8Data: Uint8Array
};

class MediaProcessor {
	private ffmpegInstance: FFmpeg | undefined;
	private isInitialised = false;

	constructor() {
		
	}

	private async tryInitialise(): Promise<void> {
		if (this.isInitialised)
			return;

		return new Promise<void>(async (resolve, reject: (reason: string) => void) => {
			// Download FFmpeg wasm
			const ffmpegCoreWasmResponse = await fetch("/cdn/ffmpegcorewasm");
			const ffmpegCoreJsResponse = await fetch("/cdn/ffmpegcorejs");
			const ffmpegCoreWasmBuffer = await ffmpegCoreWasmResponse.arrayBuffer();
			const ffmpegCoreJsText = await ffmpegCoreJsResponse.text();
			const ffmpegCoreWasmBlobUrl = URL.createObjectURL(new Blob([ ffmpegCoreWasmBuffer ], { type: "application/wasm" }));
			const ffmpegCoreJsBlobUrl = URL.createObjectURL(new Blob([ ffmpegCoreJsText ], { type: "text/javascript" }));

			this.ffmpegInstance = new FFmpeg();

			// TODO: temporary messaging
			this.ffmpegInstance.on("log", ({ message }) => {
				console.log(`ffmpeg: ${message}`);
			});

			await this.ffmpegInstance.load({
				coreURL: ffmpegCoreJsBlobUrl,
				wasmURL: ffmpegCoreWasmBlobUrl
			});

			resolve();
		});
	}

	// TODO: filter input files too big! 2.1 GB max!
	async optimiseVideoForStreaming(inputFileData: Uint8Array, progressCallback: MediaProcessorProgressCallback): Promise<OptimiseVideoOutputData> {
		await this.tryInitialise();

		if (!this.ffmpegInstance)
			throw new Error("FFmpeg failed to initialise!");

		return new Promise<OptimiseVideoOutputData>(async (resolve, reject: (reason: string) => void) => {
			// Get instance
			const ffmpeg = this.ffmpegInstance!;
			
			// Create random directory for operations
			const contextDir = generateSecureRandomAlphaNumericString(16);
			await ffmpeg.createDir(contextDir);

			// Write input file
			const inputFilePath = `${contextDir}/input.bin`;
			await ffmpeg.writeFile(inputFilePath, inputFileData);
			
			// Listen for progress
			const ffmpegProgressCallback = (event: any) => {
				progressCallback(Math.min(Math.max(event.progress, 0), 1));
			};
			
			this.ffmpegInstance!.on("progress", ffmpegProgressCallback);
			
			// Execute operation
			const outputFilePath = `${contextDir}/output.m3u8`;
			await ffmpeg.exec([ "-i", inputFilePath, "-c:v", "copy", "-c:a", "copy", "-f", "hls", "-hls_time", "10", "-hls_flags", "single_file", outputFilePath ]);

			// Set progress to finish and stop listening for progress
			//progressCallback(1);
			this.ffmpegInstance!.off("progress", ffmpegProgressCallback);

			// Read output data
			const videoData = await ffmpeg.readFile(`${contextDir}/output.ts`);
			const m3u8Data = await ffmpeg.readFile(`${contextDir}/output.m3u8`);

			resolve({
				videoBinaryData: videoData as Uint8Array,
				m3u8Data: m3u8Data as Uint8Array
			});
		});
	}
}

export type {
	MediaProcessorProgressCallback,
	OptimiseVideoOutputData
}

export {
	MediaProcessor
}
