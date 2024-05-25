import { FileCategory } from "./userFilesystem";
import FileIcon from "../assets/icons/svg/files/file.svg?component-solid";
import AudioFileIcon from "../assets/icons/svg/files/file-audio.svg?component-solid";
import VideoFileIcon from "../assets/icons/svg/files/file-video.svg?component-solid";
import ImageFileIcon from "../assets/icons/svg/files/file-image.svg?component-solid";
import ArchiveFileIcon from "../assets/icons/svg/files/file-archive.svg?component-solid";
import DocumentFileIcon from "../assets/icons/svg/files/file-document.svg?component-solid";

const audioFileTypes = [
	"mp3", "m4a",
	"flac",
	"ogg", "oga", "ogx",
	"spx",
	"wav",
	"mid", "midi",
	"mka",
	"aiff",
	"ape"
];

const imageFileTypes = [
	"jpg", "jpeg", "jfif", "jfi", "jpe", "jif",
	"png", "apng",
	"svg",
	"bmp",
	"tif", "tiff",
	"gif",
	"psd",
	"heif", "heic",
	"webp",
	"ico"
];

const videoFileTypes = [
	"mp4",
	"mov",
	"webm",
	"mkv",
	"ogv",
	"avi",
	"mks", "mpg", "mpeg"
];

const archiveFileTypes = [
	"7z",
	"zip"
];

const documentFileTypes = [
	"pdf",
	"pptx",
	"xlsx",
	"docx",
	"txt",
	"html", "htm",
	"css"
];

function getFileCategoryFromExtension(extension: string): FileCategory {
	extension = extension.toLowerCase();

	if (audioFileTypes.indexOf(extension) != -1) {
		return FileCategory.Audio;
	} else if (imageFileTypes.indexOf(extension) != -1) {
		return FileCategory.Image;
	} else if (videoFileTypes.indexOf(extension) != -1) {
		return FileCategory.Video;
	} else if (archiveFileTypes.indexOf(extension) != -1) {
		return FileCategory.Archive;
	} else if (documentFileTypes.indexOf(extension) != -1) {
		return FileCategory.Document;
	}

	return FileCategory.Generic;
}

function getFileIconFromExtension(extension: string) {
	extension = extension.toLowerCase(); // Here just in case any code under here needs to analyse the extension directly
	const fileCategory = getFileCategoryFromExtension(extension);
	const iconClass = `ml-2 h-6 w-6`;

	// TODO: pdf svg icon

	if (fileCategory == FileCategory.Audio) {
		return <AudioFileIcon class={iconClass} />;
	} else if (fileCategory == FileCategory.Image) {
		return <ImageFileIcon class={iconClass} />;
	} else if (fileCategory == FileCategory.Video) {
		return <VideoFileIcon class={iconClass} />;
	} else if (fileCategory == FileCategory.Archive) {
		return <ArchiveFileIcon class={iconClass} />;
	} else if (fileCategory == FileCategory.Document) {
		return <DocumentFileIcon class={iconClass} />;
	}

	return <FileIcon class={iconClass} />;
}

export {
	getFileCategoryFromExtension,
	getFileIconFromExtension,
}
