import { UploadFileEntry } from "./transfers";
import { FilesystemEntry } from "./userFilesystem";

type AppServices = {
	uploadFiles: (entries: UploadFileEntry[]) => void;
	downloadFiles: (entries: FilesystemEntry[]) => void;
	downloadFilesAsZip: (entries: FilesystemEntry[]) => void;
};

export type {
	AppServices
}
