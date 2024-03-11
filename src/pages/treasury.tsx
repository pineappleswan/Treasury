import { Suspense, createResource, createSignal } from "solid-js";
import { getFormattedBPSText, getFormattedBytesSizeText, getOriginalFileSizeFromEncryptedFileSize } from "../common/common";
import { TransferStatus } from "../client/enumsAndTypes";
import { FileExplorerWindow, FilesystemEntry, FileCategory } from "../components/fileExplorer";
import { TransferListWindow, createTransferListEntry, TransferListEntry } from "../components/transferList";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { FileUploadResolveInfo, uploadFileToServer } from "../client/transfers";
import { UploadFileEntry } from "../components/uploadFilesPopup";
import UserBar from "../components/userBar";
import { getTimeZones } from "@vvo/tzdb";
import { decryptEncryptedFileCryptKey, decryptFileMetadataAsJsonObject, getMasterKeyAsUint8ArrayFromLocalStorage, FileMetadata, createEncryptedFileMetadata, encryptFileCryptKey } from "../common/clientCrypto";
import base64js from "base64-js";
import CONSTANTS from "../common/constants";

// Icons
import DownloadArrowIcon from "../assets/icons/svg/downloading-arrow.svg?component-solid";
import UploadArrowIcon from "../assets/icons/svg/uploading-arrow.svg?component-solid";
import GearIcon from "../assets/icons/svg/gear.svg?component-solid";
import LogoutIcon from "../assets/icons/svg/logout.svg?component-solid";
import FolderIcon from "../assets/icons/svg/folder.svg?component-solid";
import SharedLinkIcon from "../assets/icons/svg/shared-link.svg?component-solid";
import TrashIcon from "../assets/icons/svg/trash-bin.svg?component-solid";

// ffmpeg -i input.mp4 -c:v copy -c:a copy -f hls -hls_time 10 -hls_flags single_file output.m3u8

// TODO: when uploading file, check magic number of file and fallback to extension as last resort, otherwise unknown extension and its a "File"
//       + try see if file-type package is able to return the correct extension even if file is image.png when its actually a "jpg". Store the 
//			   true file format extension ("png", "jpg", "mov") in the server database. on the client, it can be converted to something like 
//         jpg = "JPEG Image" or svg = "SVG Vector Image"
// TODO: right click menu of file entry copy name feature

// TODO: fix issue where resizing column headers requires aspect ratio tuning! ideally a fix would make it so the column headers are not part
//       of the scrolling list

// TODO: test if can watch 4k videos and even greater like 10 bit or 6k or 8k. (use camera videos as testing data)
// TODO: test if you can download the streamable fragmented video and then upload it again to the server (assuming it isnt converted back to normal mp4 when downloaded)
// TODO: test uploading multiple streamable videos at the same time
// TODO: when uploading a video, streamable video option should be called "Optimise for streaming" as its more realistic. Warn user that when redownloading, it will not be the same file. (aka it's a destructive process)
// TODO: when playing a video, warn user if video is larger than 20 MB that it's not optimised for streaming and they have to download the whole video.
// TODO: confirmation popup system using promises (allow multiple popups stacked on top of each other)
// TODO: make it so that the transfer lists can be cleared simply by CTRL+A and pressing DEL (maybe show a confirmation popup) or selecting manually, right clicking and deleting...
// TODO: file favouriting
// TODO: display size units setting like mebi, kebi, tebi bytes
// TODO: video previews
// TODO: upload from dragging image or file from another tab

/* TODO: SETTINGS PAGE ITEMS

// IDEA: if file text name too long, if hover over, it will scroll to the right automatically
// IDEA: get advanced info from audio like sample rate, channel count, bitrate (wasm audio decoders)

QUOTA
1. Usage per file format (by extension to not confuse the user)
2. Extra bytes used due to treasury file format storing poly1305 tags, nonces, headers, magics, etc. (explain why to user)

SETTINGS
1. configuration of american/international timestamp format e.g MM/DD/YYYY vs DD/MM/YYYY

*/

type StorageQuota = {
	bytesUsed: number,
	totalBytes: number // The total number of bytes the user is allocated
}

enum WindowTypes {
	Uploads,
	Downloads,
	Filesystem,
	Shared,
	Trash,
	Settings
};

type TreasuryPageAsyncProps = {
	username: string,
	storageQuota: StorageQuota,
	filesystemEntries: FilesystemEntry[]
};

type ProcessedFilesystemData = {
	storageUsedBytes: number,
	filesystemEntries: FilesystemEntry[]
};

function Logout() {
	fetch("/api/logout", { method: "POST" })
	.then((response) => {
		if (response.ok) { // When server responds with 200, redirect user to login page
			localStorage.removeItem("masterKey"); // Delete master key
			window.location.pathname = "/login";
		}
	});
}

// TODO: get from server (ensure the user settings are encrypted)
let userSettings = {
	useAmericanDateFormat: false
};

async function TreasuryPageAsync(props: TreasuryPageAsyncProps) {
	const myUsername = props.username;
	let filesystemEntries: FilesystemEntry[] = props.filesystemEntries;
	let currentStorageQuota = props.storageQuota;

	// Get master key first thing
	const masterKey = getMasterKeyAsUint8ArrayFromLocalStorage();

	if (masterKey == null) {
		console.error(`MASTER KEY IS NULL!!!`);
		return;
	}
	
	const forceRefreshListFunctions: Function[] = []; // When functions inside are called, both file explorers (left and right) will refresh

	// Tries to refresh both file explorer lists only when they both exist
	const tryRefreshFileLists = () => {
		if (forceRefreshListFunctions.length == 2) {
			forceRefreshListFunctions.forEach((refresh) => {
				refresh();
			});
		} else {
			// If both not loaded, keep retrying
			setTimeout(tryRefreshFileLists, 250);
		}
	};

	tryRefreshFileLists();

	const [ currentWindow, setCurrentWindow ] = createSignal(WindowTypes.Filesystem); // Default is filesystem view

	// Upload/download speed stats are updated via a callback function given to the transfer windows
	const [ currentUploadSpeed, setCurrentUploadSpeed ] = createSignal(-1);
	const [ currentDownloadSpeed, setCurrentDownloadSpeed ] = createSignal(-1);

	// TODO: upload and download menu entry has the same speed text, maybe create another component for that?
	function UploadsMenuEntry() {
		const [ speedText, setSpeedText ] = createSignal("");
		const [ speedTextVisibility, setSpeedTextVisibility ] = createSignal(false);

		const handleClick = () => {
			setCurrentWindow(WindowTypes.Uploads);
		}

		// Run update loop every 1 second
		setInterval(() => {
			let speed = currentUploadSpeed();

			if (speed == -1) {
				setSpeedTextVisibility(false);
			} else {
				setSpeedText(getFormattedBPSText(speed));
				setSpeedTextVisibility(true);
			}
		}, 1000);

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mb-1 pl-0.5 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowTypes.Uploads) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-6 border-solid border-2 border-[#33bbee]">
					<UploadArrowIcon class="aspect-square h-5" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Uploads</h1>
				<div class={`flex items-center justify-center font bg-[#f4f4f4] px-1.5 h-6 mr-1.5 rounded-md border-solid border-[1px] border-[#dfdfdf]
										${speedTextVisibility() == true ? "visible" : "invisible"}`}>
					<h1 class="font-SpaceGrotesk font-medium text-sm text-zinc-700 select-none">{speedText()}</h1>
				</div>
			</div>
		);
	}

	function DownloadsMenuEntry() {
		const [ speedText, setSpeedText ] = createSignal("");
		const [ speedTextVisibility, setSpeedTextVisibility ] = createSignal(false);

		const handleClick = () => {
			setCurrentWindow(WindowTypes.Downloads);
		}

		// Run update loop every 1 second
		setInterval(() => {
			let speed = currentDownloadSpeed();

			if (speed == -1) {
				setSpeedTextVisibility(false);
			} else {
				setSpeedText(getFormattedBPSText(speed));
				setSpeedTextVisibility(true);
			}
		}, 1000);

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 pl-0.5 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowTypes.Downloads) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-6 border-solid border-2 border-[#11bf22]">
					<DownloadArrowIcon class="aspect-square h-5 rotate-180" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Downloads</h1>
				<div class={`flex items-center justify-center font bg-[#f4f4f4] px-1.5 h-6 mr-1.5 rounded-md border-solid border-[1px] border-[#dfdfdf]
										${speedTextVisibility() == true ? "visible" : "invisible"}`}>
					<h1 class="font-SpaceGrotesk font-medium text-sm text-zinc-700 select-none">{speedText()}</h1>
				</div>
			</div>
		);
	}

	function FilesystemMenuEntry() {
		const handleClick = () => {
			setCurrentWindow(WindowTypes.Filesystem);
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowTypes.Filesystem) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<FolderIcon class="aspect-square h-[26px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Filesystem</h1>
			</div>
		);
	}

	function SharedLinkEntry() {
		const handleClick = () => {
			setCurrentWindow(WindowTypes.Shared);
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowTypes.Shared) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<SharedLinkIcon class="aspect-square h-[24px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Shared</h1>
			</div>
		);
	}

	function TrashMenuEntry() {
		const handleClick = () => {
			setCurrentWindow(WindowTypes.Trash);
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowTypes.Trash) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<TrashIcon class="aspect-square h-[28px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Trash</h1>
			</div>
		);
	}

	function SettingsMenuEntry() {
		const handleClick = () => {
			setCurrentWindow(WindowTypes.Settings);
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowTypes.Settings) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<GearIcon class="aspect-square h-[22px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Settings</h1>
			</div>
		);
	}

	function QuotaMenuEntry() {
		const [ quotaText, setQuotaText ] = createSignal("Loading usage data...");
		const [ barWidth, setBarWidth ] = createSignal(0); // Bar width is a value between 0 and 100 (must be an integer or else the bar won't show)

		// Update the quota text every 1 second
		setInterval(() => {
			const { bytesUsed, totalBytes } = currentStorageQuota;

			if (bytesUsed == -1 || totalBytes == -1) {
				setQuotaText("Loading usage data...");
				setBarWidth(0);
			} else {
				let usedQuotaText = getFormattedBytesSizeText(bytesUsed);
				let totalQuotaText = getFormattedBytesSizeText(totalBytes);
				let ratio = Math.floor((bytesUsed / totalBytes) * 100);
				
				// Clamp between 0-100
				if (ratio < 0) {
					ratio = 0;
				} else if (ratio > 100) {
					ratio = 100;
				}

				setQuotaText(usedQuotaText + " / " + totalQuotaText);
				setBarWidth(ratio);
			}
		}, 1000);

		return (
			<div class="flex flex-col w-[100%] h-12 p-2">
				<h1 class="mb-1 font-SpaceGrotesk font-medium text-sm text-zinc-700">{quotaText()}</h1>
				<div class="flex w-[100%] h-2 rounded-full bg-zinc-300">
					<div style={`width: ${barWidth()}%`} class={`flex h-[100 bg-sky-600 rounded-full`}></div> {/* Uses style for bar width since tailwind can't update that fast */}
				</div>
			</div>
		);
	}

	function LogoutMenuEntry() {
		return (
			<div class="flex flex-row items-center mt-1 py-1 rounded-md drop-shadow-sm hover:bg-red-100 hover:cursor-pointer active:bg-red-200"
					 onClick={Logout}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<LogoutIcon class="aspect-square h-[24px] invert-[20%]" />
				</div>
				<h1 class="flex-grow font-SpaceGrotesk font-medium text-md text-red-500 select-none">Log out</h1>
			</div>
		);
	};

	// Get timezones (TODO: setting for setting current timezone)
	const timeZones = getTimeZones();

	timeZones.sort((a, b) => {
		return (a.name < b.name) ? 0 : 1;
	});

	timeZones.forEach((value) => {
		//console.log(`${value.name} = ${value.currentTimeOffsetInMinutes}`);
	});
	
	// TODO: make generic for downloads/uploads instead of just uploads
	const [ uploadEntriesData, setUploadEntriesData ] = createSignal<TransferListEntry[]>([]);

	const updateUploadTransferEntry = (transferHandle: string, fileName: string, transferSize: number, progress: number, shouldCancel?: boolean, cancelMessage?: string) => {
		const entry = uploadEntriesData().find((e) => e.handle == transferHandle); // TODO: needs to be more efficient! is it already? problem is that upload entries data is an array...

		if (shouldCancel) {
			if (entry == undefined) {
				console.warn(`Trying to cancel an entry that couldn't be found with it's handle: ${transferHandle}`);
				return;
			}

			if (entry.status == TransferStatus.FAILED) {
				console.warn(`Trying to cancel an entry that is already cancelled/failed!`);
				return;
			}

			entry.status = TransferStatus.FAILED;

			// TODO: support custom messages instead of automatic Downloading/Uploading/FAILED/Success by adding property to TransferListEntry for custom message
			if (cancelMessage) {
				// 
			} else {
				// 
			}
			
			return;
		}
		
		if (entry == undefined) {
			// console.log(`CREATING TRANSFER LIST ENTRY! handle: ${transferHandle} name: ${fileName} size: ${transferSize}`);

			// Create entry if undefined
			const newEntry: TransferListEntry = createTransferListEntry(
				transferHandle,
				fileName,
				transferSize
			);
			
			setUploadEntriesData([...uploadEntriesData(), newEntry]);
		} else {
			// Determine if a transfer is finished
			const transferEnded = (entry.status == TransferStatus.FAILED || entry.status == TransferStatus.FINISHED);
			
			if (transferEnded)
				return;

			progress = Math.max(Math.min(progress, 1), 0); // Clamp just in case
			entry.transferredBytes = progress * entry.transferSize;
			entry.status = TransferStatus.UPLOADING;

			if (entry.transferredBytes >= entry.transferSize) {
				entry.transferredBytes = entry.transferSize;
				entry.status = TransferStatus.FINISHED;
			}
		}
	};

	// Upload
	const uploadFileEntriesToServer = (fileEntries: UploadFileEntry[], parentHandle: string) => {
		const masterKey = getMasterKeyAsUint8ArrayFromLocalStorage();

		if (masterKey == null) {
			console.error("MASTER KEY IS NULL!!!");
			return;
		}

		fileEntries.forEach((entry) => {
			const file: File = entry.file;

			// TODO: add failure cases and update transfer entry...
			// Create new transfer entry
			const progressCallback = (transferHandle: string, progress: number) => {
				// console.log(`handle: ${transferHandle} progress: ${progress}`);

				// Update text only with the raw file size and not the encrypted file size or users may be confused that their files suddenly got bigger
				updateUploadTransferEntry(transferHandle, file.name, file.size, progress);
			};

			uploadFileToServer(file, progressCallback)
			.then((result: FileUploadResolveInfo) => {
				if (result) {
					const success = result.success;
					
					if (!success) {
						console.error("Upload did not return success!");
						return;
					}
					
					const trueFileType = result.trueFileType;
					const handle = result.handle;
					const fileCryptKey = result.fileCryptKey; // The key that was used to encrypt the uploaded file
					const utcTimeAsSeconds: number = Math.floor(Date.now() / 1000); // Store as seconds, not milliseconds

					// Create metadata and encrypt the file crypt key
					const fileMetadata: FileMetadata = {
						parentHandle: parentHandle,
						fileName: file.name,
						dateAdded: utcTimeAsSeconds,
						trueFileType: trueFileType
					};

					const encFileCryptKey = encryptFileCryptKey(fileCryptKey, masterKey);
					const encFileMetadata = createEncryptedFileMetadata(fileMetadata, masterKey);

					console.log(`Finalise: ${file.name} -> ${trueFileType}`);
					
					// Finalise upload with the encrypted metadata and file crypt key
					fetch("/api/transfer/finaliseupload", {
						method: "POST",
						headers: {
							"Content-Type": "application/json"
						},
						body: JSON.stringify({
							handle: handle,
							encryptedMetadataB64: base64js.fromByteArray(encFileMetadata),
							encryptedFileCryptKeyB64: base64js.fromByteArray(encFileCryptKey)
						})
					});
				} else {
					console.log("No reponse data from uploadFileToServer() ?");
				}
			})
			.catch((error: any) => {
				const reasonMessage = error.reasonMessage;
				console.error(`Upload cancelled for reason: ${reasonMessage}`);
			});
		});
	};

	// This is called from the upload file popups inside the file explorer window when
	// the user is uploading files
	const uploadFilesCallback = (fileEntries: UploadFileEntry[]) => {
		setCurrentWindow(WindowTypes.Uploads);
		uploadFileEntriesToServer(fileEntries, "00000000000000000000000000000000"); // TODO: constant for root directory name (lots of ascii zeroes)?
	};

	const jsx = (
		<div class="flex flex-row min-w-max w-screen min-h-max h-screen bg-[#eeeeee]"> {/* Background */}
			<div class="flex flex-col min-w-[240px] w-[240px] items-center justify-between h-screen border-r-2 border-solid border-[#] bg-[#fcfcfc]"> {/* Nav bar */}
				<UserBar username={myUsername} />
				<div class="flex flex-col items-center w-[100%]"> {/* Content */}
					<div class="flex flex-col mt-4 w-[95%]"> {/* Transfers section */}
						<h1 class="mb-1 pl-1 font-SpaceGrotesk font-medium text-sm text-zinc-600">Transfers</h1> {/* Title of section */}
						<UploadsMenuEntry />
						<DownloadsMenuEntry />
					</div>
					<div class="flex flex-col mt-4 w-[95%]"> {/* Filesystem section */}
						<h1 class="mb-0 pl-1 font-SpaceGrotesk font-medium text-sm text-zinc-600">Filesystem</h1> {/* Title of section */}
						<FilesystemMenuEntry />
						<SharedLinkEntry />
						<TrashMenuEntry />
					</div>
				</div>
				<div class="flex-grow"> {/* Empty filler section */}

				</div>
				<div class="flex flex-col mt-2 mb-2 w-[95%]"> {/* Bottom section */}
					<QuotaMenuEntry />
					<SettingsMenuEntry />
					<LogoutMenuEntry />
				</div>
			</div>
			<FileExplorerWindow
				forceRefreshListFunctions={forceRefreshListFunctions}
				visible={currentWindow() == WindowTypes.Filesystem}
				userSettings={userSettings}
				globalFileEntries={filesystemEntries}
				uploadFilesCallback={uploadFilesCallback}
			/>
			<TransferListWindow
				visible={currentWindow() == WindowTypes.Uploads}
				userSettings={userSettings}
				transferEntriesGetter={uploadEntriesData}
			/>
		</div>
	);

	return jsx;
}

let isTreasuryLoading = true;

// TODO: better loading page where it shows what stage it is at (username -> storage quota -> get filesystem -> processing filesystem)
function TreasuryLoadingPage() {
	const [ loadingText, setLoadingText ] = createSignal("");
	let dotCount = 0;

	const loadingTextLoop = () => {
		setLoadingText(`Loading your data${".".repeat(dotCount)}`)
		dotCount++;
		dotCount = dotCount % 4;
		
		if (isTreasuryLoading) {
			setTimeout(loadingTextLoop, 750);
		}
	}

	loadingTextLoop();

	return (
		<div class="flex flex-col items-center justify-center w-screen h-screen">
			<h1 class="font-SpaceGrotesk font-medium text-lg mb-2">
				{loadingText()}
			</h1>
		</div>
	);
}

function TreasuryErrorPage() {
	return (
		<div class="flex flex-col items-center justify-center w-screen h-screen">
			<h1 class="font-SpaceGrotesk font-medium text-lg mb-2 text-red-600">
				Your home page failed to load. Try refreshing...
			</h1>
		</div>
	);
}

function ProcessRawFilesystemData(rawData: any, masterKey: Uint8Array): ProcessedFilesystemData {
	const processedFilesystemData: ProcessedFilesystemData = {
		storageUsedBytes: 0,
		filesystemEntries: []
	};

	const decryptFilesystemEntryAndAppend = (entry: any) => {
		try {
			const encryptedFileCryptKey = base64js.toByteArray(entry.encryptedFileCryptKeyB64);

			// Handle and size are not stored in the metadata of the file as they don't need to be encrypted.
			const fileHandle = entry.handle;
			const fileSizeOnServer = entry.sizeOnServer;
			const realFileSize = getOriginalFileSizeFromEncryptedFileSize(fileSizeOnServer);
			let fileCryptKey: Uint8Array;

			// Increment storage quota (use file size on server!)
			processedFilesystemData.storageUsedBytes += fileSizeOnServer;

			try {
				fileCryptKey = decryptEncryptedFileCryptKey(encryptedFileCryptKey, masterKey);
			} catch (error) {
				throw new Error(`Crypt key decrypt failed! Error: ${error}`);
			}

			const encryptedMetadata = base64js.toByteArray(entry.encryptedMetadataB64);
			let fileMetadata: FileMetadata;

			try {
				fileMetadata = decryptFileMetadataAsJsonObject(encryptedMetadata, masterKey);
			} catch (error) {
				throw new Error(`Metadata decrypt failed! Error: ${error}`);
			}

			const fileName = fileMetadata.fileName;

			// Append filesystem entry
			const timezoneOffsetInSeconds = 0 * 60;

			const fileCategory = FileCategory.Generic; // TODO: determine by file type

			let filesystemEntry: FilesystemEntry = {
				handle: fileHandle,
				name: fileName,
				size: realFileSize,
				category: fileCategory,
				trueFileType: fileMetadata.trueFileType,
				dateAdded: fileMetadata.dateAdded + timezoneOffsetInSeconds,
				fileCryptKey: fileCryptKey
			};
			
			processedFilesystemData.filesystemEntries.push(filesystemEntry);
			//console.log(`h: ${fileHandle} ph: ${fileMetadata.parentHandle} n: ${fileMetadata.fileName} size: ${realFileSize} da: ${fileMetadata.dateAdded} ft: ${fileMetadata.fileType}`);
		} catch (error) {
			console.error(`decrypt filesystem entry failed: ${error}`);
		}
	};

	rawData.forEach((entry: any) => {
		decryptFilesystemEntryAndAppend(entry);
	});

	return processedFilesystemData;
}

function TreasuryPage() {
	const masterKey = getMasterKeyAsUint8ArrayFromLocalStorage();

	if (masterKey == null) {
		console.error("MASTER KEY IS NULL!!!");
		return TreasuryErrorPage();
	}

	const [ page ] = createResource(async () => {
		let pageProps: TreasuryPageAsyncProps = {
			username: "???",
			storageQuota: {
				totalBytes: 0,
				bytesUsed: 0
			},
			filesystemEntries: []
		};

		try {
			const [ usernameRes, storageQuotaRes ] = await Promise.all([
				fetch("/api/getusername"),
				fetch("/api/getstoragequota")
			]);

			if (!usernameRes.ok)
				throw new Error(`getusername responded with status ${usernameRes.status}`);

			if (!storageQuotaRes.ok)
				throw new Error(`getstoragequota responded with status ${storageQuotaRes.status}`);

			const quotaJson = await storageQuotaRes.json();
			pageProps.storageQuota.totalBytes = quotaJson.quota;
			pageProps.username = await usernameRes.text();

			// Get filesystem data and process it
			const fsResponse = await fetch("/api/getfilesystem");

			if (!fsResponse.ok)
				throw new Error(`getfilesystem responded with status: ${fsResponse.status}`);

			const fsJson = await fsResponse.json();

			if (fsJson.success) {
				// Process all data
				const processedData = ProcessRawFilesystemData(fsJson.data, masterKey);
				pageProps.filesystemEntries = processedData.filesystemEntries;
				pageProps.storageQuota.bytesUsed = processedData.storageUsedBytes;
			} else {
				console.error(`Get filesystem failed. Message: ${fsJson.message}`);
			}
		} catch (error) {
			console.error(error);
			isTreasuryLoading = false;
			return TreasuryErrorPage();
		}

		// Manual delay to test loading page
		//await new Promise((resolve) => setTimeout(resolve, 2000));

		isTreasuryLoading = false;
		return TreasuryPageAsync(pageProps);
	});

	// TODO: fix issue with computations created outside a ...

	return (
		<Suspense fallback={TreasuryLoadingPage()}>
			{page()}
		</Suspense>
	)
}

export default TreasuryPage;
