import { Suspense, createResource, createSignal } from "solid-js";
import { getFormattedBytesSizeText, getOriginalFileSizeFromEncryptedFileSize } from "../common/commonUtils";
import { FileExplorerWindow, FilesystemEntry, FileExplorerMainPageCallbacks } from "../components/fileExplorer";
import { TransferListWindow, TransferListEntry, TransferStatus, TransferListProgressInfoCallback } from "../components/transferList";
import { UploadFileEntry } from "../components/uploadFilesPopup";
import { getTimeZones } from "@vvo/tzdb";
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";
import { WindowTypes } from "../client/clientEnumsAndTypes";
import { TransfersMenuEntry, TransfersMenuEntrySettings } from "../components/transferMenuEntry";
import { TransferSpeedCalculator } from "../utility/transferSpeedCalculator";
import { clearLocalStorageAuthenticationData, getLocalStorageKeypairs, getMasterKeyFromLocalStorage } from "../client/localStorage";
import UserBar from "../components/userBar";
import CONSTANTS from "../common/constants";

import {
	DownloadFileEntry,
	TransferType,
	downloadFileFromServer,
	ClientUploadManager,
	UploadFinishCallback,
	UploadFailCallback
} from "../client/transfers";

// Icons
import GearIcon from "../assets/icons/svg/gear.svg?component-solid";
import LogoutIcon from "../assets/icons/svg/logout.svg?component-solid";
import FolderIcon from "../assets/icons/svg/folder.svg?component-solid";
import SharedLinkIcon from "../assets/icons/svg/shared-link.svg?component-solid";
import TrashIcon from "../assets/icons/svg/trash-bin.svg?component-solid";
import { UserFilesystem } from "../client/userFilesystem";

// LIST OF THINGS TO COMPLETE
// - right click menu of file entry copy name feature
// - fix issue where resizing column headers requires aspect ratio tuning! ideally a fix would make it so the column headers are not part
//   of the scrolling list
// - test if can watch 4k videos and even greater like 10 bit or 6k or 8k. (use camera videos as testing data)
// - test if you can download the streamable fragmented video and then upload it again to the server (assuming it isnt converted back to normal mp4 when downloaded)
// - test uploading multiple streamable videos at the same time
// - when uploading a video, streamable video option should be called "Optimise for streaming" as its more realistic. Warn user that when redownloading, it will not be the same file. (aka it's a destructive process)
// - when playing a video, warn user if video is larger than 20 MB that it's not optimised for streaming and they have to download the whole video.
// - confirmation popup system using promises (allow multiple popups stacked on top of each other)
// - make it so that the transfer lists can be cleared simply by CTRL+A and pressing DEL (maybe show a confirmation popup) or selecting manually, right clicking and deleting...
// - file favouriting
// - display size units setting like mebi, kebi, tebi bytes in settings page
// - video previews
// - upload from dragging image or file from another tab
// - failed to load treasury page check if user is logged in first so they know if they are logged in and its not some weird actual issue

/* - SETTINGS PAGE ITEMS

// IDEA: if file text name too long, if hover over, it will scroll to the right automatically
// IDEA: get advanced info from audio like sample rate, channel count, bitrate (wasm audio decoders)

QUOTA
 1. Usage per file format (by extension to not confuse the user)
 2. Extra bytes used due to treasury file format storing poly1305 tags, nonces, headers, magics, etc. (explain why to user)

SETTINGS
 1. configuration of american/international timestamp format e.g MM/DD/YYYY vs DD/MM/YYYY

*/

type TreasuryPageAsyncProps = {
	username: string,
	userFilesystem: UserFilesystem
};

function Logout() {
	fetch("/api/logout", { method: "POST" })
	.then((response) => {
		if (response.ok) { // When server responds with 200, redirect user to login page
			clearLocalStorageAuthenticationData();
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
	const userFilesystem = props.userFilesystem;

	// Get master key first thing
	const masterKey = getMasterKeyFromLocalStorage();

	if (masterKey == undefined) {
		console.error(`masterKey is undefined!`);
		return;
	}

	// Get keypair info
	const userKeypairInfo = getLocalStorageKeypairs();

	if (userKeypairInfo == undefined) {
		console.error(`user keypairs is undefined!`);
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
	//const [ currentUploadSpeed, setCurrentUploadSpeed ] = createSignal(-1);
	//const [ currentDownloadSpeed, setCurrentDownloadSpeed ] = createSignal(-1);

	const uploadTransferSpeedCalculator = new TransferSpeedCalculator();
	const downloadTransferSpeedCalculator = new TransferSpeedCalculator();

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
			const { bytesUsed, totalBytes } = userFilesystem.getStorageQuota();

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
					<div
						style={`width: ${barWidth()}%`}
						class={`
							flex h-[100 rounded-full
							${barWidth() < 70 ? "bg-sky-600" : (barWidth() < 90 ? "bg-amber-400" : "bg-red-500")}
						`}
					></div> {/* Uses style for bar width since tailwind can't update that fast */}
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
	
	// TODO: move all transfer list entries createSignal and the callback into the transfer list window itself and get the callback from the settings
	const [ transferListEntries, setTransferListEntries ] = createSignal<TransferListEntry[]>([]);

	// TODO: delete transfer list entries function, which will also delete the transferred bytes speed calculator

	// This callback function is used to update the transfer list windows with information that is displayed to the user
	const lastTransferTransferredBytesDictionary: { [key: string]: number } = {}; // Used to calculate delta bytes (TODO: maybe keep this inside transfer speed calculator?)

	const transferListProgressInfoCallback: TransferListProgressInfoCallback = async (
		handle,
		transferType,
		transferStatus,
		parentHandle,
		progress,
		fileName,
		transferSize,
		statusText
	) => {
		const entry = transferListEntries().find((e) => e.handle == handle); // TODO: needs to be more efficient! is it already? problem is that upload entries data is an array...
		
		if (entry == undefined) {
			// Create new entry if undefined
			const newEntry: TransferListEntry = {
				handle: handle,
				parentHandle: parentHandle,
				fileName: fileName || "",
				transferSize: transferSize || 0,
				transferredBytes: 0,
				transferSpeed: 0,
				timeLeft: 0,
				transferStartTime: new Date(),
				transferType: transferType,
				status: transferStatus,
				statusText: statusText || "",
			};

			lastTransferTransferredBytesDictionary[handle] = 0;
			
			// Append
			setTransferListEntries([...transferListEntries(), newEntry]);
		} else {
			// Determine if a transfer is finished
			const transferEnded = (entry.status == TransferStatus.Failed || entry.status == TransferStatus.Finished);
			
			if (transferEnded)
				return;

			if (progress) {
				progress = Math.max(Math.min(progress, 1), 0); // Clamp just in case
				const newTransferredBytes = progress * entry.transferSize;
				entry.transferredBytes = Math.max(entry.transferredBytes, newTransferredBytes); // Don't go lower in case progress callbacks come out of order
			}

			entry.status = transferStatus;

			// Calculate delta bytes
			const deltaBytes = Math.max(0, entry.transferredBytes - lastTransferTransferredBytesDictionary[handle]);
			lastTransferTransferredBytesDictionary[handle] = entry.transferredBytes;

			if (entry.transferType == TransferType.Uploads) {
				uploadTransferSpeedCalculator.appendDeltaBytes(deltaBytes);
			} else {
				downloadTransferSpeedCalculator.appendDeltaBytes(deltaBytes);
			}

			if (statusText) {
				entry.statusText = statusText;
			}

			// Detect finish
			if (entry.transferredBytes >= entry.transferSize) {
				entry.transferredBytes = entry.transferSize;
				entry.status = TransferStatus.Finished;
			}
		}
	};

	const uploadFinishCallback: UploadFinishCallback = (progressCallbackHandle: string, newFilesystemEntry: FilesystemEntry) => {
		userFilesystem.appendFileEntryLocally(newFilesystemEntry);
		tryRefreshFileLists();
	};
	
	const uploadFailCallback: UploadFailCallback = (progressCallbackHandle: string) => {
		transferListProgressInfoCallback(progressCallbackHandle, TransferType.Uploads, TransferStatus.Failed, undefined, undefined, undefined, undefined, "Upload failed!");
	};

	const uploadManager: ClientUploadManager = new ClientUploadManager(
		masterKey,
		userKeypairInfo.ed25519PrivateKey,
		transferListProgressInfoCallback,
		uploadFinishCallback,
		uploadFailCallback
	);

	// These callbacks are called from any child components of the treasury page
	const uploadFilesMainPageCallback = (entries: UploadFileEntry[]) => {
		uploadsMenuEntrySettings.notify!();
		//uploadFilesToServer(entries, masterKey, transferListProgressInfoCallback);

		entries.forEach(entry => {
			uploadManager.uploadFile(entry);
		});
	};

	const downloadFilesMainPageCallback = (entries: DownloadFileEntry[]) => {
		downloadsMenuEntrySettings.notify!();

		// TODO: download files from server function and handle download as zip on the client.
		// TODO: BELOW code is temporary!

		entries.forEach(async (entry) => {
			const realFileSize = getOriginalFileSizeFromEncryptedFileSize(entry.encryptedFileSize);
			const progressCallbackHandle = generateSecureRandomAlphaNumericString(CONSTANTS.PROGRESS_CALLBACK_HANDLE_LENGTH);

			try {
				await downloadFileFromServer(
					entry.handle,
					progressCallbackHandle,
					entry.fileName,
					entry.encryptedFileSize,
					realFileSize,
					masterKey,
					transferListProgressInfoCallback
				);
			} catch (error: any) {
				if (error && error.reason) {
					const reason = error.reason;
					console.error(`Download cancelled for reason: ${reason}`);
				} else {
					console.error(`Download cancelled for error: ${error}`);
				}
			}
		});
	};

	const mainPageCallbacks: FileExplorerMainPageCallbacks = {
		uploadFiles: uploadFilesMainPageCallback,
		downloadFiles: downloadFilesMainPageCallback
	};

	// These are needed for the notify functions inside them
	const uploadsMenuEntrySettings: TransfersMenuEntrySettings = {};
	const downloadsMenuEntrySettings: TransfersMenuEntrySettings = {};

	const jsx = (
		<div class="flex flex-row min-w-max w-screen min-h-max h-screen bg-[#eeeeee]"> {/* Background */}
			<div id="left-nav-bar" class="flex flex-col min-w-[240px] w-[240px] items-center justify-between h-screen border-r-2 border-solid border-[#] bg-[#fcfcfc]"> {/* Nav bar */}
				<UserBar username={myUsername} />
				<div class="flex flex-col items-center w-[100%]"> {/* Content */}
					<div class="flex flex-col mt-4 w-[95%]"> {/* Transfers section */}
						<h1 class="mb-1 pl-1 font-SpaceGrotesk font-medium text-sm text-zinc-600">Transfers</h1> {/* Title of section */}
						<TransfersMenuEntry
							transferType={TransferType.Uploads}
							settings={uploadsMenuEntrySettings}
							getTransferSpeed={uploadTransferSpeedCalculator.getSpeedGetter}
							currentWindowGetter={currentWindow}
							currentWindowSetter={setCurrentWindow}
						/>
						<TransfersMenuEntry
							transferType={TransferType.Downloads}
							settings={downloadsMenuEntrySettings}
							getTransferSpeed={downloadTransferSpeedCalculator.getSpeedGetter}
							currentWindowGetter={currentWindow}
							currentWindowSetter={setCurrentWindow}
						/>
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
				userFilesystem={props.userFilesystem}
				mainPageCallbacks={mainPageCallbacks}
				leftFileExplorerElementId="file-explorer-left"
				rightFileExplorerElementId="file-explorer-right"
			/>
			<TransferListWindow
				// Upload transfers window
				visible={currentWindow() == WindowTypes.Uploads}
				userSettings={userSettings}
				transferEntriesGetter={transferListEntries}
				transferType={TransferType.Uploads}
			/>
			<TransferListWindow
				// Download transfers window
				visible={currentWindow() == WindowTypes.Downloads}
				userSettings={userSettings}
				transferEntriesGetter={transferListEntries}
				transferType={TransferType.Downloads}
			/>
		</div>
	);

	return jsx;
}

// TODO: better loading page where it shows what stage it is at (username -> storage quota -> get filesystem -> processing filesystem)
let isTreasuryLoading = true;

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

function TreasuryPage() {
	const masterKey = getMasterKeyFromLocalStorage();

	if (masterKey == undefined) {
		console.error("MASTER KEY IS UNDEFINED!!!");
		Logout(); // Log out here
		return TreasuryErrorPage();
	}

	const [ page ] = createResource(async () => {
		let pageProps: TreasuryPageAsyncProps = {
			username: "???",
			userFilesystem: new UserFilesystem()
		};
		
		// Check if keypairs and master key has been loaded
		try {
			if (getLocalStorageKeypairs() == undefined || getMasterKeyFromLocalStorage() == undefined) {
				isTreasuryLoading = false;
				return TreasuryErrorPage();
			}
		} catch (error) {
			isTreasuryLoading = false;
			return TreasuryErrorPage();
		}

		// Load all user data
		try {
			const usernameRes = await fetch("/api/getusername");

			if (!usernameRes.ok) {
				if (usernameRes.status == 403) { // If forbidden, then just redirect back to login page
					Logout();
				}

				throw new Error(`getusername responded with status ${usernameRes.status}`);
			}

			pageProps.username = await usernameRes.text();

			// TODO: set timezone!

			// Initialise user filesystem
			await pageProps.userFilesystem.initialise();
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

	// TODO: fix issue with computations created outside a ... (EDIT: what???)

	return (
		<Suspense fallback={TreasuryLoadingPage()}>
			{page()}
		</Suspense>
	)
}

export default TreasuryPage;
