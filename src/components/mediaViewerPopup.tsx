import { Accessor, createSignal, onCleanup } from "solid-js";
import { VideoPlayer, VideoPlayerContext, VideoPlayInfo } from "./videoPlayer"
import { ImageViewer, ImageViewerContext } from "./imageViewer";
import { FilesystemEntry } from "./fileExplorer";
import { FileCategory, UserFilesystem } from "../client/userFilesystem";
import { ClientDownloadManager, DownloadFileContext, DownloadFileMethod, TransferType } from "../client/transfers";
import { unzlibSync } from "fflate";
import { naturalCompareString } from "../utility/sorting";
import { getFileExtensionFromName } from "../utility/fileNames";
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";
import { TransferListProgressInfoCallback, TransferStatus } from "./transferList";
import { UserSettings } from "../client/userSettings";

import CloseButton from "../assets/icons/svg/close.svg?component-solid";
import AlertTriangle from "../assets/icons/svg/alert-triangle.svg?component-solid";
import RightAngleArrow from "../assets/icons/svg/right-angle-arrow.svg?component-solid";
import CONSTANTS from "../common/constants";

enum ActiveMediaType {
	None,
	Image,
	Video,
	Audio
}

// A list of supported image extensions that is viewable in the media viewer


type MediaViewerOpenFileFunction = (fileEntry: FilesystemEntry) => void;
type MediaViewerErrorMessageCallback = (message: string) => void;

type MediaViewerPopupContext = {
	openFile?: MediaViewerOpenFileFunction;
	showPopup?: () => void;
	minimise?: () => void;
	close?: () => void;
	isOpen?: () => boolean;
	canOpenFile?: (fileEntry: FilesystemEntry) => boolean;
}

type MediaViewerPopupProps = {
	context: MediaViewerPopupContext;
	userFilesystem: UserFilesystem;
	userSettings: Accessor<UserSettings>;
}

function MediaViewerPopup(props: MediaViewerPopupProps) {
	const { userFilesystem, userSettings } = props;
	const [ visible, setVisible ] = createSignal(false);
	const [ activeMediaType, setActiveMediaType ] = createSignal(ActiveMediaType.None);
	const [ titleText, setTitleText ] = createSignal("");
	const [ errorMessage, setErrorMessage ] = createSignal("");
	const [ currentDirectoryMediaFiles, setCurrentDirectoryMediaFiles ] = createSignal<FilesystemEntry[]>([]);
	const [ browseIndex, setBrowseIndex ] = createSignal(0);
	const [ controlsVisible, setControlsVisible ] = createSignal(true);
	const originalDocumentTitle = document.title;
	
	// Loading state
	const [ loadingBarVisible, setLoadingBarVisible ] = createSignal(false);
	const [ loadingProgress, setLoadingProgress ] = createSignal(0); // The loading bar progress (0-1)

	// Used to 
	const showLoadingBarDownloadTimeThresholdMs = 100; // How many milliseconds must a download take before the loading bar is shown
	let lastOpenFileTime = Date.now(); // The Date.now() timestamp of when the last time openFile was called

	// Contexts
	const imageViewerContext: ImageViewerContext = {};
	const videoPlayerContext: VideoPlayerContext = {};

	// Controls visibility logic
	let controlsTimeoutId: any = undefined;

	const startControlsTimeout = () => {
		if (controlsTimeoutId)
			clearTimeout(controlsTimeoutId);
	
		controlsTimeoutId = setTimeout(() => {
			setControlsVisible(false);
		}, 2000);
	};

	// Create a progress callback (even though this isn't a transfer list, also some arguments
	// are left out because they are unused)
	const loadingProgressCallback: TransferListProgressInfoCallback = (
		progressHandle: string,
		transferType: TransferType,
		transferStatus: TransferStatus,
		parentHandle?: string,
		progress?: number,
		// Some arguments left out because they're unused
	) => {
		if (progress) {
			// Only show the loading bar once the loading time is greater than the threshold
			if (Date.now() - lastOpenFileTime > showLoadingBarDownloadTimeThresholdMs) {
				setLoadingBarVisible(true);
			}

			setLoadingProgress(progress);
		}
	};

	props.context.canOpenFile = (fileEntry: FilesystemEntry) => {
		const extension = getFileExtensionFromName(fileEntry.name);

		// TODO: probably should have supported video extension list as well?
		return CONSTANTS.MEDIA_VIEWER_VIEWABLE_EXTENSIONS.indexOf(extension) != -1 || fileEntry.category == FileCategory.Video;
	}

	props.context.openFile = async (fileEntry: FilesystemEntry) => {
		lastOpenFileTime = Date.now();
		setErrorMessage(""); // Clear error message
		setTitleText(fileEntry.name); // Set title text
		
		// Get all files in the same directory
		let directoryMediaFiles = userFilesystem.getFileEntriesUnderHandle(fileEntry.parentHandle);

		// Sort entries alphabetically
		directoryMediaFiles.sort((a, b) => naturalCompareString(a.name, b.name));

		// Filter only openable files
		directoryMediaFiles = directoryMediaFiles.filter(entry => {
			return props.context.canOpenFile!(entry);
		});
		
		// Calculate index of fileEntry in directoryFiles
		const currentFileIndex = directoryMediaFiles.findIndex(entry => entry.handle == fileEntry.handle);

		if (currentFileIndex == -1) {
			console.error("Couldn't find current file's index inside the current directory files array!");
			return;
		}

		const downloadManager = new ClientDownloadManager();

		setCurrentDirectoryMediaFiles(directoryMediaFiles);
		setBrowseIndex(currentFileIndex);
		setLoadingBarVisible(false);
		setLoadingProgress(0);

		// Check if video is optimised for streaming
		if (fileEntry.category == FileCategory.Video) {
			// Sync children m3u8
			await userFilesystem.syncFiles(fileEntry.handle);

			// Check for an m3u8 file located under the video file
			const childFileEntries = userFilesystem.getFileEntriesUnderHandle(fileEntry.handle);
			const m3u8Entry = childFileEntries.find(entry => entry.name == "m3u8");

			// If found, then the video is optimised for streaming
			if (m3u8Entry) {
				// Download m3u8 silently firstly
				const downloadContext: DownloadFileContext = { method: DownloadFileMethod.Silent };
				const m3u8compressedBinary = await downloadManager.downloadWholeFile(m3u8Entry, downloadContext);

				if (!m3u8compressedBinary.data) {
					console.error(`Failed to download m3u8 compressed binary!`);
					setLoadingBarVisible(false);
					return;
				}

				// Decompress the m3u8
				const m3u8Binary = unzlibSync(m3u8compressedBinary.data);

				// Convert to text (TODO: convert to text not needed, but it's nice to have i guess?)
				const m3u8Text = new TextDecoder().decode(m3u8Binary);
				
				const playInfo: VideoPlayInfo = {
					videoFileEntry: fileEntry,
					m3u8Optional: m3u8Text
				};

				setActiveMediaType(ActiveMediaType.Video);
				videoPlayerContext.playVideo!(playInfo);

				// Return here as the video is now playing
				return;
			}
		}

		// Download, then open the  file
		try {
			const downloadContext: DownloadFileContext = {
				method: DownloadFileMethod.Silent
			}

			const downloadBrowseIndex = browseIndex();
			const progressHandle = generateSecureRandomAlphaNumericString(16);

			const shouldCancelCallback = () => {
				return browseIndex() != downloadBrowseIndex || visible() == false;
			}
	
			const resolveInfo = await downloadManager.downloadWholeFile(
				fileEntry,
				downloadContext,
				shouldCancelCallback,
				progressHandle,
				undefined,
				loadingProgressCallback
			);
			
			if (resolveInfo.wasCancelled) {
				return;
			}

			if (!resolveInfo.data) {
				errorMessageCallback("Failed to download data");
				return;
			}

			setLoadingBarVisible(false);

			// Open the file
			if (fileEntry.category == FileCategory.Audio) {
				// TODO: dedicated audio player class
				const playInfo: VideoPlayInfo = {
					videoFileEntry: fileEntry,
					videoBinaryOptional: resolveInfo.data
				};

				setActiveMediaType(ActiveMediaType.Audio);
				videoPlayerContext.playVideo!(playInfo);
			} else if (fileEntry.category == FileCategory.Image) {
				setActiveMediaType(ActiveMediaType.Image);
				await imageViewerContext.openImage!(resolveInfo.data);
			} else if (fileEntry.category == FileCategory.Video) {
				const playInfo: VideoPlayInfo = {
					videoFileEntry: fileEntry,
					videoBinaryOptional: resolveInfo.data
				};

				setActiveMediaType(ActiveMediaType.Video);
				videoPlayerContext.playVideo!(playInfo);
			}
		} catch (error) {
			if (typeof(error) == "string") {
				errorMessageCallback(error);
			} else {
				errorMessageCallback("Unknown error");
			}
		}
	};

	props.context.showPopup = () => {
		setVisible(true);
		startControlsTimeout();
	}

	props.context.minimise = () => {
		setActiveMediaType(ActiveMediaType.None);
	}

	props.context.close = () => {
		setVisible(false);
		setActiveMediaType(ActiveMediaType.None);
		document.title = originalDocumentTitle; // Reset document's title to the original
	}

	props.context.isOpen = () => {
		return visible();
	}

	const errorMessageCallback: MediaViewerErrorMessageCallback = (message: string) => {
		setErrorMessage(message);
	};

	const handleCloseButton = () => {
		props.context.close!();
	}

	const updateBrowse = (newIndex: number) => {
		const newFile = currentDirectoryMediaFiles()[newIndex];
		setBrowseIndex(newIndex);
		props.context.openFile!(newFile);
	}

	const browse = (clicked: boolean, increment: number) => {
		let newIndex = browseIndex() + increment;
		const mediaFileCount = currentDirectoryMediaFiles().length;

		if (newIndex < 0) {
			newIndex = mediaFileCount - 1;
		} else if (newIndex >= mediaFileCount) {
			newIndex = 0;
		}

		if (clicked) {
			setControlsVisible(true);
			startControlsTimeout();
		}

		updateBrowse(newIndex);
	}
	
	const handleKeyDown = (event: KeyboardEvent) => {
		if (!visible())
			return;

		if (event.key == "ArrowLeft") {
			browse(false, -1);
		} else if (event.key == "ArrowRight") {
			browse(false, 1);
		} else if (event.key == "Escape") {
			props.context.close!();
		}
	};

	const handleMouseMove = () => {
		setControlsVisible(true);
		startControlsTimeout();
	};

	// Hides the controls when the mouse leaves the browser window
	const handleMouseOut = (event: MouseEvent) => {
		if (event.relatedTarget == null) {
			setControlsVisible(false);
		}
	};

	/*
	TODO: issue where controls go invisible, then don't move the mouse and click, and controls come visible
				but the video doesnt pause until you click twice and the controls still don't show

	const handleMouseDown = () => {
		setControlsVisible(true);
		startControlsTimeout();
	};
	*/

	document.addEventListener("keydown", handleKeyDown);
	document.addEventListener("mousemove", handleMouseMove);
	document.addEventListener("mouseout", handleMouseOut);
	// document.addEventListener("mousedown", handleMouseDown);
	
	onCleanup(() => {
		document.removeEventListener("keydown", handleKeyDown);
		document.removeEventListener("mousemove", handleMouseMove);
		document.removeEventListener("mouseout", handleMouseOut);
		// document.removeEventListener("mousedown", handleMouseDown);
	});

	return (
		<div
			class={`
				flex absolute inset-0 w-full h-full z-10 bg-black
				${!controlsVisible() && "cursor-none"}
				${!visible() && "hidden"}
			`}
		>
			{/* Media viewer */}
			<div class="absolute flex items-center justify-center w-full h-full">
				{loadingBarVisible() ? (
					<div class="flex flex-col min-w-48 w-[10%]">
						<span class="font-SpaceGrotesk text-sm font-medium text-white text-center mb-2">
							{`Downloading: ${(Math.round(Math.min(loadingProgress(), 1) * 1000) / 10).toFixed(1)}%`}
						</span>
						<div
							class="w-full h-2 bg-zinc-700 rounded-full"
						>
							<div
								class="h-full bg-sky-500 rounded-full"
								style={`width: ${loadingProgress() * 100}%;`}
							></div>
						</div>
					</div>
				) : (
					(() => {
						switch (activeMediaType()) {
							case ActiveMediaType.None  : return <></>;
							case ActiveMediaType.Audio : return <VideoPlayer
								context={videoPlayerContext}
								userSettings={userSettings}
								errorMessageCallback={errorMessageCallback}
								controlsVisibleAccessor={controlsVisible}
							/>;
							case ActiveMediaType.Image : return <ImageViewer context={imageViewerContext} />;
							case ActiveMediaType.Video : return <VideoPlayer
								context={videoPlayerContext}
								userSettings={userSettings}
								errorMessageCallback={errorMessageCallback}
								controlsVisibleAccessor={controlsVisible}
							/>;
						}
					})()
				)}
			</div>

			{/* Top bar */}
			<div class={`absolute flex flex-row items-center w-full`}>
				<div
					class={`
						flex flex-col items-center w-full h-full pt-1 pb-2 whitespace-nowrap text-center bg-black bg-opacity-50
						transition-all duration-300
						${!controlsVisible() && "opacity-0"}
					`}
				>
					<span
						class={`
							max-w-full px-10 font-SpaceGrotesk text-lg font-bold text-zinc-50 overflow-hidden text-ellipsis
							transition-all duration-300
							${!controlsVisible() && "opacity-0"}
						`}
					>{titleText()}</span>
					<span
						class={`
							px-10 font-SpaceGrotesk text-sm font-medium text-zinc-400 overflow-hidden text-ellipsis
							transition-all duration-300
							${!controlsVisible() && "opacity-0"}
						`}
					>
						{`${browseIndex() + 1}/${currentDirectoryMediaFiles().length}`}
					</span>
					{errorMessage().length > 0 && (
						<div class={`flex flex-row justify-center items-center px-3`}>
							<AlertTriangle class="w-4 h-4 text-red-500" />
							<span class="font-SpaceGrotesk text-sm text-red-500 pl-2">{errorMessage()}</span>
						</div>
					)}
				</div>
				<span class="grow"></span>
				<CloseButton
					class={`
						absolute right-0 w-9 h-9 mr-4 bg-black bg-opacity-30 text-zinc-50 rounded-xl
						hover:opacity-50 hover:cursor-pointer active:opacity-30 transition-all duration-300
						${!controlsVisible() && "opacity-0"}
					`}
					onClick={handleCloseButton}
				/>
			</div>

			{/* Previous button */}
			<div
				class={`
					flex absolute items-center justify-center self-center aspect-square w-20
					transition-all duration-300
					hover:cursor-pointer
					${(!controlsVisible() || currentDirectoryMediaFiles().length === 1) && "opacity-0"}
				`}
				onClick={() => browse(true, -1)}
			>
				<RightAngleArrow class="w-9 h-9 text-zinc-50 bg-black bg-opacity-30 rounded-xl -rotate-90" />
			</div>

			{/* Next button */}
			<div
				class={`
					flex absolute right-0 items-center justify-center self-center aspect-square w-20
					transition-all duration-300
					hover:cursor-pointer
					${(!controlsVisible() || currentDirectoryMediaFiles().length === 1) && "opacity-0"}
				`}
				onClick={() => browse(true, 1)}
			>
				<RightAngleArrow class="w-9 h-9 text-zinc-50 bg-black bg-opacity-30 rounded-xl rotate-90" />
			</div>
		</div>
	)
}

export type {
	MediaViewerPopupContext
}

export {
	MediaViewerPopup
}
