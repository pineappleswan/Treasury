import { createSignal, createEffect, on, For } from "solid-js";
import { getFormattedBPSText, getFormattedBytesSizeText } from "../utility/formatSizeText";
import DownloadArrowIcon from "../assets/icons/svg/arrow-download.svg?component-solid";
import UploadArrowIcon from "../assets/icons/svg/arrow-upload.svg?component-solid";
import GearIcon from "../assets/icons/svg/gear.svg?component-solid";
import LogoutIcon from "../assets/icons/svg/logout.svg?component-solid";
import FolderIcon from "../assets/icons/svg/folder.svg?component-solid";
import SharedLinkIcon from "../assets/icons/svg/shared-link.svg?component-solid";
import TrashIcon from "../assets/icons/svg/trash-bin.svg?component-solid";

function Logout() {
	fetch("/api/logout", { method: "POST" })
	.then((response) => {
		if (response.ok) { // When server responds with 200, redirect user to login page
			window.location.pathname = "/login";
		}
	});
}

// 'FileExplorerWindow' can hold one or multiple 'FileExplorer's
function FileExplorerWindow() {
	function FileExplorer() {
		// Arbitrary values can be specified to adjust the relative widths of the columns in the file explorer
		const columnWidths = {
			NAME: 8,
			SIZE: 3,
			CREATION_TIME: 4
		};

		let columnWidthDivider = Object.values(columnWidths).reduce((a, b) => a + b, 0) / 100;

		const [ fileEntries, setFileEntries ] = createSignal([]);
		
		const addFileEntry = (entryInfo) => {
			setFileEntries((prevEntries) => [...prevEntries, entryInfo]);
		};
		
		const removeFileEntry = (targetHandle) => {
			setFileEntries((prevEntries) => prevEntries.filter((entry) => { return entry.handle !== targetHandle; }));
		};

		const Column = (props) => {
			// background-color: rgb(0, ${props.relativeWidth * 40}, 0);

			return (
				<div style={`width: ${props.relativeWidth / columnWidthDivider}%;`}
						 class={`flex items-center h-[100%]`}>
					{props.children}
				</div>
			);
		};

		function FileEntry(props) {
			let fileSizeText = getFormattedBytesSizeText(props.fileSizeInBytes);

			// <button class="bg-white ml-2 rounded-md px-1 w-max h-6 font-SpaceGrotesk text-black" onClick={() => { removeFileEntry(props.handle); }}>Remove</button>

			return (
				<div class="flex flex-row flex-nowrap flex-start flex-shrink-0 items-center overflow-x-hidden w-[100%] h-9 border-b-[1px] bg-zinc-100">
					<div class={`flex items-center h-[100%] aspect-[1.2]`}>
						
					</div>
					<Column relativeWidth={columnWidths.NAME}>
						<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-[0.825em] overflow-ellipsis font-normal whitespace-nowrap">{props.fileName}</h1>
					</Column>
					<Column relativeWidth={columnWidths.SIZE}>
						<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-[0.825em] overflow-ellipsis font-normal whitespace-nowrap">{fileSizeText}</h1>
					</Column>
					<Column relativeWidth={columnWidths.CREATION_TIME}>
						<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-[0.825em] overflow-ellipsis font-normal whitespace-nowrap">{"3:17pm 17/02/2024"}</h1>
						
					</Column>
				</div>
			);
		}

		return (
			<div style={`width: ${100}%`} class="flex flex-col h-[100%]"> {/* Style is used for width so it can be resized dynamically using JS */}
				<div class="flex flex-row px-2 items-center flex-shrink-0 w-[100%] h-8 bg-zinc-500">
					<button class="w-max h-6 px-2 mr-2 bg-white rounded-md select-none hover:bg-zinc-200 active:bg-zinc-300" onClick={() => {
						addFileEntry({ handle: Math.random().toString(), fileName: Math.random().toString(), fileSizeInBytes: Math.random() * 100000000 })
					}}>Add</button>
				</div>
				<div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-7 border-b-[1px] border-zinc-300 bg-zinc-200">
					<div class={`flex items-center h-[100%] aspect-[1.55]`}>
						
					</div>
					<Column relativeWidth={columnWidths.NAME}>
						<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-sm overflow-ellipsis font-medium">Name</h1>
					</Column>
					<Column relativeWidth={columnWidths.SIZE}>
						<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-sm overflow-ellipsis font-medium">Size</h1>
					</Column>
					<Column relativeWidth={columnWidths.CREATION_TIME}>
						<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-sm overflow-ellipsis font-medium">Creation time</h1>
					</Column>
				</div>
				<div class="flex flex-col w-[100%] overflow-auto bg-zinc-300">
					<For each={fileEntries()}>
						{(entryInfo) => (
							<FileEntry handle={entryInfo.handle} fileName={entryInfo.fileName} fileSizeInBytes={entryInfo.fileSizeInBytes} />
						)}
					</For>
				</div>
			</div>
		);
	}

	return (
		<div class="flex flex-col w-[100%] h-[100%]">
			<div class="flex flex-row overflow-auto">
				<FileExplorer />
			</div>
		</div>
	);
}

function TreasuryPage() {
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
		setSelectedSetters: {},
		// Convenience function for automatically calling all setters registered in the above dictionary
		deselectAllMenus: () => {
			Object.entries(navbarStore.setSelectedSetters).forEach(([key, setSelectedFunc]) => {
				setSelectedFunc(false);
			});
		}
	};

	function UserBar() {
		return (
			<div class="flex flex-row items-center justify-center mt-1.5 w-[100%]"> {/* User bar */}
				<div class="flex items-center py-2 w-[95%] bg-[#f1f1f1] border-solid border-[1px] border-[#dfdfdf] rounded-md">
					<div class="flex rounded-full aspect-square ml-4 mr-3 h-10 bg-slate-400"></div>
					<h1 class="font-SpaceGrotesk font-semibold text- mr-4 text-center text-slate-900 overflow-auto text-wrap break-words">AxelAnderson</h1>
				</div>
			</div>
		);
	}

	function DownloadsMenuEntry() {
		const [ speedText, setSpeedText ] = createSignal("");
		const [ speedTextVisibility, setSpeedTextVisibility ] = createSignal(false);
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.setSelectedSetters.downloads = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
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
		navbarStore.setSelectedSetters.uploads = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
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
		navbarStore.setSelectedSetters.filesystem = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
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
		navbarStore.setSelectedSetters.shared = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
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
		navbarStore.setSelectedSetters.trash = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
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
		navbarStore.setSelectedSetters.settings = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
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

	// TODO: retrieve these values from the server
	navbarStore.quotaUsedInBytes = 235346837;
	navbarStore.totalQuotaInBytes = 2000000000;

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

	return (
		<div class="flex flex-row w-screen h-screen bg-[#eeeeee]"> {/* Background */}
			<div class="flex flex-col min-w-[240px] w-[240px] items-center justify-between h-screen border-r-2 border-solid border-[#] bg-[#fcfcfc]"> {/* Nav bar */}
				<UserBar />
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
			<FileExplorerWindow />
		</div>
	);
}

export default TreasuryPage;
