import { UploadFileRequest } from "./transfers";
import { FilesystemEntry } from "./userFilesystem";

type AppServices = {
  uploadFiles: (entries: UploadFileRequest[]) => void;
  downloadFiles: (entries: FilesystemEntry[]) => void;
  downloadFilesAsZip: (entries: FilesystemEntry[]) => void;
};

export type {
  AppServices
}
