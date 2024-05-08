import { FFmpeg } from "@ffmpeg/ffmpeg"
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";
import { Mutex } from "async-mutex";

type MediaProcessorProgressCallback = (progress: number) => void;

type OptimiseVideoOutputData = {
	videoBinaryData: Uint8Array;
	m3u8Data: Uint8Array;
};

class MediaProcessor {
	private ffmpegInstance: FFmpeg | undefined;
	private initialiseMutex: Mutex;
	private isInitialised = false;

	constructor() {
		this.initialiseMutex = new Mutex();
	}

	private async tryInitialise(): Promise<void> {
		return new Promise<void>(async (resolve, reject: (reason: any) => void) => {
			// Acquire mutex so that multiple requests are not made to the server
			const release = await this.initialiseMutex.acquire();
			
			// If already initialised, then return.
			if (this.isInitialised) {
				release();
				resolve();
				return;
			}

			try {
				// Download FFmpeg data
				const ffmpegCoreWasmResponse = await fetch("/cdn/ffmpegcorewasm");
				const ffmpegCoreJsResponse = await fetch("/cdn/ffmpegcorejs");
				//const ffmpegCoreWorkerJsResponse = await fetch("/cdn/ffmpegcorejs");

				const ffmpegCoreWasmBuffer = await ffmpegCoreWasmResponse.arrayBuffer();
				const ffmpegCoreJsText = await ffmpegCoreJsResponse.text();
				//const ffmpegCoreWorkerJsText = await ffmpegCoreWorkerJsResponse.text();

				const ffmpegCoreWasmBlobUrl = URL.createObjectURL(new Blob([ ffmpegCoreWasmBuffer ], { type: "application/wasm" }));
				const ffmpegCoreJsBlobUrl = URL.createObjectURL(new Blob([ ffmpegCoreJsText ], { type: "text/javascript" }));
				//const ffmpegCoreWorkerJsBlobUrl = URL.createObjectURL(new Blob([ ffmpegCoreWorkerJsText ], { type: "text/javascript" }));

				this.ffmpegInstance = new FFmpeg();

				// TODO: temporary messaging
				this.ffmpegInstance.on("log", ({ message }) => {
					console.log(`ffmpeg: ${message}`);
				});

				await this.ffmpegInstance.load({
					coreURL: ffmpegCoreJsBlobUrl,
					wasmURL: ffmpegCoreWasmBlobUrl,
					//workerURL: ffmpegCoreWorkerJsBlobUrl
				});

				this.isInitialised = true;
				resolve();
			} catch (error) {
				reject(error);
			} finally {
				release();
			}
		});
	}

	// TODO: filter input files too big! 2.1 GB max! (or bigger, or maybe if bothered + its better: put warning symbol next to files and include message about how SOME files are very big and may cause optimisation issues)
	async optimiseVideoForStreaming(inputFileData: Uint8Array, progressCallback: MediaProcessorProgressCallback): Promise<OptimiseVideoOutputData> {
		await this.tryInitialise();

		if (!this.ffmpegInstance)
			throw new Error("FFmpeg failed to initialise!");

		return new Promise<OptimiseVideoOutputData>(async (resolve, reject: (reason: any) => void) => {
			// Get instance
			const ffmpeg = this.ffmpegInstance!;
			
			// Create random directory for operations
			const workingDirectory = generateSecureRandomAlphaNumericString(16);
			await ffmpeg.createDir(workingDirectory);

			// Write input file
			const inputFilePath = `${workingDirectory}/input.bin`;
			await ffmpeg.writeFile(inputFilePath, inputFileData);
			
			// Listen for progress
			const ffmpegProgressCallback = (event: any) => {
				progressCallback(Math.min(Math.max(event.progress, 0), 1));
			};
			
			this.ffmpegInstance!.on("progress", ffmpegProgressCallback);
			
			// Execute operation
			const outputFilePath = `${workingDirectory}/video.m3u8`;
			const outputVideoBinaryPath = `${workingDirectory}/video.m4s`;

			await ffmpeg.exec([
				"-i", inputFilePath,
				"-c", "copy",
				"-map", "0:v", // Map video stream
				"-map", "0:a?", // Map audio stream if available
				"-hls_segment_type", "fmp4",
				"-hls_playlist_type", "vod",
				"-hls_time", "6",
				"-hls_list_size", "0",
				"-hls_flags", "single_file",
				outputFilePath
			]);

			// progressCallback(1);

			// Read output data
			try {
				const videoData = await ffmpeg.readFile(outputVideoBinaryPath);
				const m3u8Data = await ffmpeg.readFile(outputFilePath);

				// Cleanup
				await ffmpeg.deleteFile(inputFilePath);
				await ffmpeg.deleteFile(outputVideoBinaryPath);
				await ffmpeg.deleteFile(outputFilePath);
				await ffmpeg.deleteDir(workingDirectory);

				resolve({
					videoBinaryData: videoData as Uint8Array,
					m3u8Data: m3u8Data as Uint8Array
				});
			} catch (error) {
				reject(error);
			} finally {
				// Stop listening for progress
				this.ffmpegInstance!.off("progress", ffmpegProgressCallback);
			}
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
