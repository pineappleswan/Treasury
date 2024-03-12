import FileIcon from "../assets/icons/svg/files/file.svg?component-solid";
import AudioFileIcon from "../assets/icons/svg/files/file-audio.svg?component-solid";
import VideoFileIcon from "../assets/icons/svg/files/file-video.svg?component-solid";
import ImageFileIcon from "../assets/icons/svg/files/file-image.svg?component-solid";
import ArchiveFileIcon from "../assets/icons/svg/files/file-archive.svg?component-solid";
import DocumentFileIcon from "../assets/icons/svg/files/file-document.svg?component-solid";

function getFileExtensionFromName(name: string) {
  const nameParts = name.split(".");
  
  if (nameParts.length >= 2) {
    const extension = nameParts[nameParts.length - 1] as string;
    return extension.toLowerCase();
  } else {
    return "";
  }
}

function getFileIconFromExtension(extension: string) {
  extension = extension.toLowerCase();

  const iconClass = `ml-2 h-6 w-6`;

  // TODO: get file category first, then use category to determine icon? much simpler and more streamlined that way
  // TODO: pdf svg icon

  const audioFileTypes = [
    "mp3",
    "m4a",
    "flac",
    "ogg",
    "oga",
    "ogx",
    "spx",
    "wav",
    "mid",
    "midi",
    "mka",
    "aiff",
    "ape"
  ];

  const imageFileTypes = [
    "jpg", "jpeg", "jfif", "jfi", "jpe", "jif",
    "png", "apng",
    "svg",
    "bmp",
    "tif",
    "tiff",
    "gif",
    "psd",
    "heif",
    "heic",
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
    "mks",
    "mpg",
    "mpeg"
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
    "html",
    "htm",
    "css"
  ];

  if (audioFileTypes.indexOf(extension) != -1) {
    return <AudioFileIcon class={iconClass} />;
  } else if (imageFileTypes.indexOf(extension) != -1) {
    return <ImageFileIcon class={iconClass} />;
  } else if (videoFileTypes.indexOf(extension) != -1) {
    return <VideoFileIcon class={iconClass} />;
  } else if (archiveFileTypes.indexOf(extension) != -1) {
    return <ArchiveFileIcon class={iconClass} />;
  } else if (documentFileTypes.indexOf(extension) != -1) {
    return <DocumentFileIcon class={iconClass} />;
  }

  return <FileIcon class={iconClass} />;
}

export {
  getFileExtensionFromName,
  getFileIconFromExtension,
}
