import { createSignal } from "solid-js";
import { getFormattedBPSText, getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../utility/formatting";

// Icons
import DownloadArrowIcon from "../assets/icons/svg/arrow-download.svg?component-solid";
import UploadArrowIcon from "../assets/icons/svg/arrow-upload.svg?component-solid";
import GearIcon from "../assets/icons/svg/gear.svg?component-solid";
import LogoutIcon from "../assets/icons/svg/logout.svg?component-solid";
import FolderIcon from "../assets/icons/svg/folder.svg?component-solid";
import SharedLinkIcon from "../assets/icons/svg/shared-link.svg?component-solid";
import TrashIcon from "../assets/icons/svg/trash-bin.svg?component-solid";

// Windows
import FileExplorerWindow from "../components/FileExplorerWindow";
import TransferListWindow from "../components/TransferListWindow";
import UserBar from "../components/UserBar";
import { FILESYSTEM_SORT_MODES } from "../utility/enums";

// ffmpeg -i input.mp4 -c:v copy -c:a copy -f hls -hls_time 10 -hls_flags single_file output.m3u8

// TODO: allow configuration of american/international timestamp format e.g MM/DD/YYYY vs DD/MM/YYYY
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

/*
const WINDOW_TYPES = {
	UPLOADS: 0,
	DOWNLOADS: 1,
	FILESYSTEM: 2,
	SHARED: 3,
	TRASH: 4,
	SETTINGS: 5
};
*/

function Logout() {
	fetch("/api/logout", { method: "POST" })
	.then((response) => {
		if (response.ok) { // When server responds with 200, redirect user to login page
			window.location.pathname = "/login";
		}
	});
}

// This object stores shared values used by components in the navbar
const navbarStore = {
	// Used for transfer speed displays in the navbar (in bytes per second). If values are -1, the speed will not be shown in the navbar.
	totalDownloadSpeed: -1,
	totalUploadSpeed: -1,
	// Used for the quota menu entry (self explanatory). Note: if values are -1, the quota menu will show a message indicating that the quota
	// has not been loaded yet
	totalQuotaInBytes: -1,
	quotaUsedInBytes: -1,
	// Stores setters mainly for navbar menu buttons.
	// The use case is mainly to set other menus to be not visibile since only one menu can be selected at once.
	selectedSetters: {},
	selectedGetters: {},
	// Convenience function for automatically calling all setters added to 'selectedSetters'
	deselectAllMenus: () => {
		Object.entries(navbarStore.selectedSetters).forEach(([key, setSelectedFunc]) => {
			setSelectedFunc(false);
		});
	}
};

// TODO: get from server (ensure the user settings are encrypted)
let userSettings = {
	useAmericanDateFormat: false
};

// Get user's username from server
let myUsername = await fetch("/api/username");
myUsername = await myUsername.text();
console.log(`Logged in as: ${myUsername}`);

function TreasuryPage() {
	// TODO: retrieve these values from the server
	navbarStore.quotaUsedInBytes = 235346837;
	navbarStore.totalQuotaInBytes = 2000000000;

	// Get username
	
	function DownloadsMenuEntry() {
		const [ speedText, setSpeedText ] = createSignal("");
		const [ speedTextVisibility, setSpeedTextVisibility ] = createSignal(false);
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.selectedSetters.downloads = setSelected;
		navbarStore.selectedGetters.downloads = isSelected;

		function handleClick() {
			if (isSelected()) 
				return;

			navbarStore.deselectAllMenus();
			setSelected(true);
		}

		// Run update loop every 1 second
		setInterval(() => {
			let speed = navbarStore.totalDownloadSpeed;

			if (speed == -1) {
				setSpeedTextVisibility(false);
			} else {
				setSpeedText(getFormattedBPSText(speed));
				setSpeedTextVisibility(true);
			}
		}, 1000);

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 pl-0.5 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-6 border-solid border-2 border-[#11bf22]">
					<DownloadArrowIcon class="aspect-square h-5 rotate-180" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Downloads</h1>
				<div class={`flex items-center justify-center font bg-[#f4f4f4] px-1.5 h-6 mr-1.5 rounded-md border-solid border-[1px] border-[#dfdfdf]
										${speedTextVisibility() == true ? "visible" : "invisible"}`}>
					<h1 class="font-SpaceGrotesk font-medium text-sm text-zinc-600 select-none">{speedText}</h1>
				</div>
			</div>
		);
	}

	function UploadsMenuEntry() {
		const [ speedText, setSpeedText ] = createSignal("");
		const [ speedTextVisibility, setSpeedTextVisibility ] = createSignal(false);
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.selectedSetters.uploads = setSelected;
		navbarStore.selectedGetters.uploads = isSelected;

		function handleClick() {
			if (isSelected()) 
				return;

			navbarStore.deselectAllMenus();
			setSelected(true);
		}

		// Run update loop every 1 second
		setInterval(() => {
			let speed = navbarStore.totalUploadSpeed;

			if (speed == -1) {
				setSpeedTextVisibility(false);
			} else {
				setSpeedText(getFormattedBPSText(speed));
				setSpeedTextVisibility(true);
			}
		}, 1000);

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mb-1 pl-0.5 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-6 border-solid border-2 border-[#33bbee]">
					<UploadArrowIcon class="aspect-square h-5" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Uploads</h1>
				<div class={`flex items-center justify-center font bg-[#f4f4f4] px-1.5 h-6 mr-1.5 rounded-md border-solid border-[1px] border-[#dfdfdf]
										${speedTextVisibility() == true ? "visible" : "invisible"}`}>
					<h1 class="font-SpaceGrotesk font-medium text-sm text-zinc-600 select-none">{speedText}</h1>
				</div>
			</div>
		);
	}

	function FilesystemMenuEntry() {
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.selectedSetters.filesystem = setSelected;
		navbarStore.selectedGetters.filesystem = isSelected;

		function handleClick() {
			if (isSelected()) 
				return;

			navbarStore.deselectAllMenus();
			setSelected(true);
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<FolderIcon class="aspect-square h-[26px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Filesystem</h1>
			</div>
		);
	}

	function SharedLinkEntry() {
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.selectedSetters.shared = setSelected;
		navbarStore.selectedGetters.shared = isSelected;

		function handleClick() {
			if (isSelected()) 
				return;

			navbarStore.deselectAllMenus();
			setSelected(true);
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<SharedLinkIcon class="aspect-square h-[24px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Shared</h1>
			</div>
		);
	}

	function TrashMenuEntry() {
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.selectedSetters.trash = setSelected;
		navbarStore.selectedGetters.trash = isSelected;

		function handleClick() {
			if (isSelected()) 
				return;

			navbarStore.deselectAllMenus();
			setSelected(true);
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<TrashIcon class="aspect-square h-[28px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Trash</h1>
			</div>
		);
	}

	function SettingsMenuEntry() {
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.selectedSetters.settings = setSelected;
		navbarStore.selectedGetters.settings = isSelected;

		function handleClick() {
			if (isSelected()) 
				return;

			navbarStore.deselectAllMenus();
			setSelected(true);
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
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
			if (navbarStore.quotaUsedInBytes == -1 || navbarStore.totalQuotaInBytes == -1) {
				setQuotaText("Loading usage data...");
				setBarWidth(0);
			} else {
				let usedQuotaText = getFormattedBytesSizeText(navbarStore.quotaUsedInBytes);
				let totalQuotaText = getFormattedBytesSizeText(navbarStore.totalQuotaInBytes);
				let ratio = Math.floor((navbarStore.quotaUsedInBytes / navbarStore.totalQuotaInBytes) * 100);
				
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
				<h1 class="mb-1 font-SpaceGrotesk font-medium text-sm text-zinc-700 select-none">{quotaText}</h1>
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
		}
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
			{() => navbarStore.selectedGetters.filesystem() && (
				<FileExplorerWindow settings={userSettings} state={windowStates.fileExplorerState} />
			)}
			{() => navbarStore.selectedGetters.uploads() && (
				<TransferListWindow settings={userSettings} state={windowStates.uploadsWindowState} />
			)}
		</div>
	);

	// Set filesystem window to be default
	navbarStore.selectedSetters.filesystem(true);

	return jsx;
}

export default TreasuryPage;
