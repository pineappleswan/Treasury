import { Mutex } from "async-mutex"

type UploadTransferEntry = {
	handle: string,
	username: string,
	fileSize: number,
	chunkCount: number, // TODO: i dont think this value is needed anymore
	writtenBytes: number, // Stores how many bytes have been written to the file
	prevWrittenChunkId: number, // Helps ensure that chunks are written in the correct order (MUST BE -1 INITIALLY!)
	uploadFileDescriptor: number | null,
	uploadFilePath: string, // The path where the temporary upload file will be stored at
	mutex: Mutex // Used to prevent data races when accessing values from async functions/routes
};

type UploadTransferEntryDictionary = {
	[key: string]: UploadTransferEntry
};

export type {
	UploadTransferEntry,
	UploadTransferEntryDictionary
}
