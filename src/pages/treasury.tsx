import { Signal, Suspense, createEffect, createResource, createSignal, getOwner, onCleanup, runWithOwner } from "solid-js";
import { getFormattedBytesSizeText } from "../common/commonUtils";
import { FileExplorerWindow, FilesystemEntry, FileExplorerMainPageCallbacks, FileExplorerContext } from "../components/fileExplorer";
import { TransferListWindow, TransferListEntry, TransferStatus, TransferListProgressInfoCallback } from "../components/transferList";
import { SettingsMenuContext, SettingsMenuWindow } from "../components/settingsMenu";
import { UploadFileEntry } from "../components/uploadFilesPopup";
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";
import { WindowType } from "../client/clientEnumsAndTypes";
import { TransfersMenuEntry, TransfersMenuEntrySettings } from "../components/transferMenuEntry";
import { TransferSpeedCalculator } from "../client/transferSpeedCalculator";
import { clearLocalStorageAuthenticationData, getLocalStorageUserCryptoInfo } from "../client/localStorage";
import { UserFilesystem } from "../client/userFilesystem";
import { showSaveFilePicker } from "native-file-system-adapter";
import { getDefaultUserSettings, getTimezoneOffsetInMinutesFromTimezoneName, UserSettings } from "../client/userSettings";
import { Vector2D } from "../client/vectors";
import { deduplicateFileEntryName } from "../utility/fileNames";
import UserBar from "../components/userBar";
import CONSTANTS from "../common/constants";

import {
	TransferType,
	ClientDownloadManager,
	ClientUploadManager,
	UploadFinishCallback,
	UploadFailCallback,
	DownloadFileContext,
	DownloadFileMethod,
	UploadSettings
} from "../client/transfers";

// Icons
import GearIcon from "../assets/icons/svg/gear.svg?component-solid";
import LogoutIcon from "../assets/icons/svg/logout.svg?component-solid";
import FolderIcon from "../assets/icons/svg/folder.svg?component-solid";
import SharedLinkIcon from "../assets/icons/svg/shared-link.svg?component-solid";
import TrashIcon from "../assets/icons/svg/trash-bin.svg?component-solid";
import cloneDeep from "clone-deep";

type TreasuryPageAsyncProps = {
	username: string;
	userFilesystem: UserFilesystem;
	userSettings: UserSettings;
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

async function TreasuryPageAsync(props: TreasuryPageAsyncProps) {
	// Check user crypto info
	const userLocalCryptoInfo = getLocalStorageUserCryptoInfo();

	if (userLocalCryptoInfo == null) {
		console.error(`userLocalCryptoInfo is null!`);
		return;
	}

	const { userFilesystem } = props;
	const [ currentWindow, setCurrentWindow ] = createSignal(WindowType.Filesystem); // Default is filesystem view
	const [ userSettings, updateUserSettings ] = createSignal(props.userSettings);
	let leftSideNavBar: HTMLDivElement | undefined;
	
	// Transfer speed calculators
	const uploadTransferSpeedCalculator = new TransferSpeedCalculator();
	const downloadTransferSpeedCalculator = new TransferSpeedCalculator();

	// Tries to refresh the file explorer list only when the callback exists
	const tryRefreshFileLists = () => {
		if (fileExplorerWindowContext.refreshFileExplorer) {
			fileExplorerWindowContext.refreshFileExplorer();
		} else {
			// If not loaded, keep retrying
			setTimeout(tryRefreshFileLists, 250);
		}
	};

	function FilesystemMenuEntry() {
		const handleClick = () => {
			setCurrentWindow(WindowType.Filesystem);
		}

		return (
			<div class={`flex flex-row w-full items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowType.Filesystem) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<FolderIcon class="aspect-square h-[26px] invert-[20%]" />
				</div>
				<span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Filesystem</span>
			</div>
		);
	}

	function SharedMenuEntry() {
		const handleClick = () => {
			setCurrentWindow(WindowType.Shared);
		}

		return (
			<div class={`flex flex-row w-full items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowType.Shared) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<SharedLinkIcon class="aspect-square h-[24px] invert-[20%]" />
				</div>
				<span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Shared</span>
			</div>
		);
	}

	function TrashMenuEntry() {
		const handleClick = () => {
			setCurrentWindow(WindowType.Trash);
		}

		return (
			<div class={`flex flex-row w-full items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowType.Trash) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<TrashIcon class="aspect-square h-[28px] invert-[20%]" />
				</div>
				<span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Trash</span>
			</div>
		);
	}

	function SettingsMenuEntry() {
		const handleClick = () => {
			setCurrentWindow(WindowType.Settings);
		}

		return (
			<div class={`flex flex-row w-full items-center mr-2 mt-1 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${(currentWindow() == WindowType.Settings) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<GearIcon class="aspect-square h-[22px] invert-[20%]" />
				</div>
				<span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Settings</span>
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
				let usedQuotaText = getFormattedBytesSizeText(bytesUsed, userSettings().dataSizeUnit);
				let totalQuotaText = getFormattedBytesSizeText(totalBytes, userSettings().dataSizeUnit);
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
			<div class="flex flex-col w-full h-12 p-2">
				<span class="mb-1 font-SpaceGrotesk font-medium text-sm text-zinc-700">{quotaText()}</span>
				<div class="flex w-full h-2 rounded-full bg-zinc-300">
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
					<LogoutIcon class="aspect-square h-[24px] text-red-500" />
				</div>
				<span class="flex-grow font-SpaceGrotesk font-medium text-md text-red-500 select-none">Log out</span>
			</div>
		);
	};

	// TODO: move all transfer list entries createSignal and the callback into the transfer list window itself and get the callback from the settings
	const [ transferListEntrySignals, setTransferListEntrySignals ] = createSignal<Signal<TransferListEntry>[]>([]);

	// TODO: delete transfer list entries function, which will also delete the transferred bytes speed calculator

	// Used to calculate transfer delta bytes
	const prevTransferBytesMap = new Map<string, number>(); // TODO: use this instead of the above
	
	// This callback function is used to update individual transfer list entries by their handle.
	// These changes are reflected instantly in their corresponding transfer list window.
	const transferListProgressInfoCallback: TransferListProgressInfoCallback = async (
		progressHandle,
		transferType,
		transferStatus,
		parentHandle,
		progress,
		fileName,
		transferSize,
		statusText
	) => {
		const entry = transferListEntrySignals().find((e) => e[0]().progressHandle == progressHandle); // TODO: needs to be more efficient! is it already? problem is that upload entries data is an array...
		
		if (entry == undefined) { // Create new entry if undefined
			prevTransferBytesMap.set(progressHandle, 0);

			setTransferListEntrySignals([...transferListEntrySignals(), createSignal<TransferListEntry>({
				progressHandle: progressHandle,
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
			})]);
		} else {
			let newEntry = cloneDeep(entry[0]());

			// Determine if a transfer is finished
			const transferEnded = (newEntry.status == TransferStatus.Failed || newEntry.status == TransferStatus.Finished);
			
			if (transferEnded)
				return;

			if (progress) {
				progress = Math.max(Math.min(progress, 1), 0); // Clamp just in case
				const newTransferredBytes = progress * newEntry.transferSize;
				newEntry.transferredBytes = Math.max(newEntry.transferredBytes, newTransferredBytes);
			}

			newEntry.status = transferStatus;

			if (statusText != undefined)
				newEntry.statusText = statusText;

			// Calculate delta bytes
			let previousBytes = prevTransferBytesMap.get(progressHandle);
			previousBytes = previousBytes === undefined ? -1 : previousBytes;

			if (previousBytes == -1) {
				console.error(`Previous bytes was undefined for progress handle: ${progressHandle}`);
			}

			const deltaBytes = Math.max(0, newEntry.transferredBytes - previousBytes);
			prevTransferBytesMap.set(progressHandle, newEntry.transferredBytes);

			// Update transfer speed calculations for the menu entries
			if (newEntry.transferType == TransferType.Uploads) {
				uploadTransferSpeedCalculator.appendDeltaBytes(deltaBytes);
			} else {
				downloadTransferSpeedCalculator.appendDeltaBytes(deltaBytes);
			}
			
			newEntry.transferredBytes = Math.min(newEntry.transferredBytes, newEntry.transferSize); // Cap the value

			// Update the entry
			entry[1](newEntry);
		}
	};

	const uploadFinishCallback: UploadFinishCallback = (progressCallbackHandle: string, newFilesystemEntries: FilesystemEntry[]) => {
		newFilesystemEntries.forEach(entry => userFilesystem.addNewFileEntryLocally(entry, entry.parentHandle));
		tryRefreshFileLists();
	};
	
	const uploadFailCallback: UploadFailCallback = (progressCallbackHandle: string) => {
		transferListProgressInfoCallback(progressCallbackHandle, TransferType.Uploads, TransferStatus.Failed, undefined, undefined, undefined, undefined, "");
	};

	const [ uploadSettings, setUploadSettings ] = createSignal<UploadSettings>({
		optimiseVideosForStreaming: false
	});

	const uploadManager: ClientUploadManager = new ClientUploadManager(
		uploadFinishCallback,
		uploadFailCallback,
		userSettings,
		uploadSettings,
		transferListProgressInfoCallback
	);

	const downloadManager = new ClientDownloadManager();

	// These callbacks are called from any child components of the treasury page
	const uploadFilesMainPageCallback = (entries: UploadFileEntry[]) => {
		uploadsMenuEntrySettings.notify!();
		setCurrentWindow(WindowType.Uploads);

		entries.forEach(entry => {
			// Deduplicate the file name
			const deduplicatedName = deduplicateFileEntryName(entry.fileName, entry.parentHandle, userFilesystem);
			
			// TODO: show user popup with all the deduplicated names as a warning! User should confirm/deny.
			if (entry.fileName != deduplicatedName) {
				console.log("Deduplicated file entry name!");
			}

			entry.fileName = deduplicatedName;

			uploadManager.addToUploadQueue(entry);
		});
	};

	const downloadFilesMainPageCallback = (entries: FilesystemEntry[]) => {
		downloadsMenuEntrySettings.notify!();

		entries.forEach(async (entry) => {
			if (entry.isFolder) {
				console.log("Download folder is not implemented yet!"); // TODO: folder download support
				return;
			}

			const progressCallbackHandle = generateSecureRandomAlphaNumericString(CONSTANTS.PROGRESS_CALLBACK_HANDLE_LENGTH);

			try {
				// Open output file
				const outputFileHandle = await showSaveFilePicker({
					suggestedName: entry.name
				});

				const outputWritableStream = await outputFileHandle.createWritable();

				const downloadContext: DownloadFileContext = {
					method: DownloadFileMethod.WritableStream,
					writableStream: outputWritableStream
				};

				await downloadManager.downloadWholeFile(
					entry,
					downloadContext,
					undefined,
					progressCallbackHandle,
					entry.name,
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

	const downloadFilesAsZipMainPageCallback = async (entries: FilesystemEntry[]) => {
		downloadsMenuEntrySettings.notify!();

		// Open output file
		const outputFileHandle = await showSaveFilePicker({
			suggestedName: "download.zip" // TODO: maybe include timestamp?
		});

		const outputWritableStream = await outputFileHandle.createWritable();

		const downloadContext: DownloadFileContext = {
			method: DownloadFileMethod.WritableStream,
			writableStream: outputWritableStream
		};

		const result = await downloadManager.downloadFilesAsZip(entries, downloadContext, undefined, transferListProgressInfoCallback);

		console.log(result);
	};

	const mainPageCallbacks: FileExplorerMainPageCallbacks = {
		uploadFiles: uploadFilesMainPageCallback,
		downloadFiles: downloadFilesMainPageCallback,
		downloadFilesAsZip: downloadFilesAsZipMainPageCallback,
	};

	const fileExplorerWindowContext: FileExplorerContext = {};

	// These are needed for the notify functions inside them
	const uploadsMenuEntrySettings: TransfersMenuEntrySettings = {};
	const downloadsMenuEntrySettings: TransfersMenuEntrySettings = {};

	const [ navbarVisible, setNavbarVisible ] = createSignal(true);

	const checkScreenFit = () => {
		const windowSize: Vector2D = { x: window.innerWidth, y: window.innerHeight };
		const documentSize: Vector2D = { x: document.body.clientWidth, y: document.body.clientHeight };

		if (documentSize.x < 800) { // TODO: show controls at bottom of screen + ONLY check screen fit for mobile plz, detect mobile device
			setNavbarVisible(false);
		} else {
			setNavbarVisible(true);
		}
	}

	window.addEventListener("resize", checkScreenFit);
	checkScreenFit();

	onCleanup(() => {
		window.removeEventListener("resize", checkScreenFit);
	});

	// Initialise
	tryRefreshFileLists();

	// Settings menu callbacks
	const userSettingsUpdateCallback = (settings: UserSettings) => {
		updateUserSettings(settings);

		// Refresh file explorer
		fileExplorerWindowContext.refreshFileExplorer!();

		return true;
	};

	const settingsMenuWindowContext: SettingsMenuContext = {};

	createEffect(() => {
		if (currentWindow() != WindowType.Settings) {
			settingsMenuWindowContext.close!();
		}
	});

	const jsx = (
		<div class="flex flex-row w-screen h-screen bg-zinc-50 overflow-hidden">
			<div
				ref={leftSideNavBar}
				class={`flex flex-col min-w-[240px] w-[240px] items-center justify-between h-screen border-r-2 border-solid border-[#] bg-[#fcfcfc]`}
				style={`${!navbarVisible() && "display: none;"}`}
			>
				<UserBar username={props.username} />
				<div class="flex flex-col items-center w-full">
					{/* Transfers section */}
					<div class="flex flex-col mt-4 w-[95%]">
						<span class="mb-1 pl-1 font-SpaceGrotesk font-medium text-sm text-zinc-600">Transfers</span>
						<TransfersMenuEntry
							transferType={TransferType.Uploads}
							settings={uploadsMenuEntrySettings}
							getTransferSpeed={uploadTransferSpeedCalculator.getSpeedGetter}
							userSettingsAccessor={userSettings}
							currentWindowGetter={currentWindow}
							currentWindowSetter={setCurrentWindow}
						/>
						<TransfersMenuEntry
							transferType={TransferType.Downloads}
							settings={downloadsMenuEntrySettings}
							getTransferSpeed={downloadTransferSpeedCalculator.getSpeedGetter}
							userSettingsAccessor={userSettings}
							currentWindowGetter={currentWindow}
							currentWindowSetter={setCurrentWindow}
						/>
					</div>

					{/* Filesystem section */}
					<div class="flex flex-col mt-4 w-[95%]"> 
						<span class="mb-0 pl-1 font-SpaceGrotesk font-medium text-sm text-zinc-600">Filesystem</span>
						<FilesystemMenuEntry />
						<SharedMenuEntry />
						<TrashMenuEntry />
					</div>
				</div>
				<div class="flex-grow"></div>
				<div class="flex flex-col mt-2 mb-2 w-[95%]">
					<QuotaMenuEntry />
					<SettingsMenuEntry />
					<LogoutMenuEntry />
				</div>
			</div>
			<FileExplorerWindow
				context={fileExplorerWindowContext}
				visible={currentWindow() == WindowType.Filesystem}
				userFilesystem={props.userFilesystem}
				leftSideNavBar={leftSideNavBar}
				mainPageCallbacks={mainPageCallbacks}
				userSettingsAccessor={userSettings}
				uploadSettingsAccessor={uploadSettings}
				currentWindowTypeAccessor={currentWindow}
			/>
			<TransferListWindow
				// Upload transfers window
				visible={currentWindow() == WindowType.Uploads}
				userSettings={userSettings}
				transferEntrySignals={transferListEntrySignals}
				transferType={TransferType.Uploads}
			/>
			<TransferListWindow
				// Download transfers window
				visible={currentWindow() == WindowType.Downloads}
				userSettings={userSettings}
				transferEntrySignals={transferListEntrySignals}
				transferType={TransferType.Downloads}
			/>
			<SettingsMenuWindow
				context={settingsMenuWindowContext}
				userSettingsAccessor={userSettings}
				userSettingsUpdateCallback={userSettingsUpdateCallback}
				visible={currentWindow() == WindowType.Settings}
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
			<span class="font-SpaceGrotesk font-medium text-lg mb-2">
				{loadingText()}
			</span>
		</div>
	);
}

function TreasuryErrorPage() {
	return (
		<div class="flex flex-col items-center justify-center w-screen h-screen">
			<span class="font-SpaceGrotesk font-medium text-lg mb-2 text-red-600">
				Your home page failed to load. Try refreshing...
			</span>
		</div>
	);
}

function TreasuryPage() {
	const userLocalCryptoInfo = getLocalStorageUserCryptoInfo();

	if (userLocalCryptoInfo == null) {
		console.error("userLocalCryptoInfo is null!");
		Logout(); // Log out here
		return TreasuryErrorPage();
	}

	// Fixes the 'computations created outside' blah blah solidjs error
	const owner = getOwner();

	const [ page ] = createResource(async () => {
		let pageProps: TreasuryPageAsyncProps = {
			username: "???",
			userFilesystem: new UserFilesystem(),
			userSettings: getDefaultUserSettings()
		};
		
		// Load all user data
		try {
			// Get user's username
			const usernameRes = await fetch("/api/getusername");

			if (!usernameRes.ok) {
				if (usernameRes.status == 403 || usernameRes.status == 401) { // If forbidden/unauthorised, then just redirect back to login page
					Logout();
				}

				throw new Error(`/api/getusername responded with status ${usernameRes.status}`);
			}

			pageProps.username = await usernameRes.text();

			// Get timezone offset automatically if setting is automatic
			pageProps.userSettings.timezoneOffsetInMinutes = getTimezoneOffsetInMinutesFromTimezoneName(pageProps.userSettings.timezoneSetting);

			// Initialise user filesystem
			await pageProps.userFilesystem.initialise();
		} catch (error) {
			console.error(error);
			isTreasuryLoading = false;
			return TreasuryErrorPage();
		}

		isTreasuryLoading = false;

		return runWithOwner(owner, async () => {
			return await TreasuryPageAsync(pageProps);
		})
	});

	return (
		<Suspense fallback={TreasuryLoadingPage()}>
			{page()}
		</Suspense>
	)
}

export default TreasuryPage;
