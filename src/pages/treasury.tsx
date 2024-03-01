import { createSignal } from "solid-js";
import { getFormattedBPSText, getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../client/formatting";
import { TransferStatus, FILESYSTEM_SORT_MODES } from "../client/enumsAndTypes";
import UserBar from "../components/userBar";
import { FileExplorerWindow, FilesystemEntry, FileCategory } from "../components/fileExplorer";
import { TransferListWindow, createTransferListEntry, TransferListEntry } from "../components/transferList";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { uploadFileToServer } from "../client/transfers";
import { UploadFileEntry } from "../components/uploadFilesPopup";

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

/* TODO: SETTINGS PAGE ITEMS

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

function Logout() {
	fetch("/api/logout", { method: "POST" })
	.then((response) => {
		if (response.ok) { // When server responds with 200, redirect user to login page
			localStorage.removeItem("masterKey"); // Delete master key
			window.location.pathname = "/login";
		}
	});
}

// TODO: double check that master key exists, otherwise redirect to login page AND probably submit a logout request

// TODO: get from server (ensure the user settings are encrypted)
let userSettings = {
	useAmericanDateFormat: false
};

// Get user's username from server
let myUsername: any = await fetch("/api/username");
myUsername = await myUsername.text();
console.log(`Logged in as: ${myUsername}`);

function TreasuryPage() {
	let currentStorageQuota: StorageQuota = {
		bytesUsed: 235346837,
		totalBytes: 2000000000
	};

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

	// These objects store data relating to the state of the windows so that everytime
	// the menu tab for the corresponding window is clicked, the state is preserved
	let windowStates = {
		fileExplorerState: {
			splitViewEnabled: false,
			splitViewLeftWidth: 50, // Percentage
			leftFileListState: {
				searchText: "",
				sortMode: FILESYSTEM_SORT_MODES.NAME,
				sortAscending: true
			},
			rightFileListState: {
				searchText: "",
				sortMode: FILESYSTEM_SORT_MODES.NAME,
				sortAscending: true
			}
		},
		uploadsWindowState: {
			searchText: "",
			sortMode: FILESYSTEM_SORT_MODES.NAME,
			sortAscending: true
		},
		downloadsWindowState: {
			searchText: "",
			sortMode: FILESYSTEM_SORT_MODES.NAME,
			sortAscending: true
		}
	};

	// Generate mock file entries data (TODO: this is temporary)
	let filesystemEntries: FilesystemEntry[] = [];
	
	for (let i = 0; i < 100; i++) {
		let handle = Math.floor(Math.random() * 100);
		let currentDate: Date = new Date();
		let dateAdded: number = currentDate.getTime() / 1000;
		dateAdded = dateAdded + (Math.random() - 0.5) * 10000;
		
		let entry: FilesystemEntry = {
			handle: handle.toString(),
			name: handle.toString(),
			size: Math.random() * 100000000,
			category: FileCategory.Generic,
			typeInfoText: "png",
			dateAdded: dateAdded
		};
		
		filesystemEntries.push(entry);
	}
	
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
	const uploadFileEntriesToServer = (fileEntries: UploadFileEntry[]) => {
		fileEntries.forEach((entry) => {
			const file: File = entry.file;

			// TODO: add failure cases and update transfer entry...
			// Create new transfer entry
			const progressCallback = (transferHandle: string, progress: number) => {
				// console.log(`handle: ${transferHandle} progress: ${progress}`);

				// Update only with the raw file size and not the encrypted file size or users may be confused that their files suddenly got bigger
				updateUploadTransferEntry(transferHandle, file.name, file.size, progress);
			};

			uploadFileToServer(file, progressCallback)
			.then((result: any) => {
				if (result) {
					const success = result.success;
					const handle = result.handle;

					if (!success) {
						console.error("Upload did not return success!");
						return;
					}

					console.log(`Upload finished!`);
					console.log(`Finalise transfer handle: ${handle}`);

					// Finalise upload
					fetch("/api/transfer/finaliseupload", {
						method: "POST",
						headers: {
							"Content-Type": "application/json"
						},
						body: JSON.stringify({
							handle: handle
						})
					});
				} else {
					console.log("No reponse data?");
				}
			})
			.catch((error: any) => {
				const reasonMessage = error.reasonMessage;
				console.error(`Upload cancelled for reason: ${reasonMessage}`);
			});
		});
	};

	const uploadFilesCallback = (fileEntries: UploadFileEntry[]) => {
		setCurrentWindow(WindowTypes.Uploads);
		uploadFileEntriesToServer(fileEntries);
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

export default TreasuryPage;
