import { createSignal, createEffect, on, For } from "solid-js";
import { getFormattedBPSText, getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../utility/formatting";
import DownloadArrowIcon from "../assets/icons/svg/arrow-download.svg?component-solid";
import UploadArrowIcon from "../assets/icons/svg/arrow-upload.svg?component-solid";
import GearIcon from "../assets/icons/svg/gear.svg?component-solid";
import LogoutIcon from "../assets/icons/svg/logout.svg?component-solid";
import FolderIcon from "../assets/icons/svg/folder.svg?component-solid";
import SharedLinkIcon from "../assets/icons/svg/shared-link.svg?component-solid";
import TrashIcon from "../assets/icons/svg/trash-bin.svg?component-solid";
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import SplitLayoutIcon from "../assets/icons/svg/split-layout.svg?component-solid";

// TODO: allow configuration of american/international timestamp format e.g MM/DD/YYYY vs DD/MM/YYYY
// TODO: when uploading file, check magic number of file and fallback to extension as last resort, otherwise unknown extension and its a "File"
//       + try see if file-type package is able to return the correct extension even if file is image.png when its actually a "jpg". Store the 
//			   true file format extension ("png", "jpg", "mov") in the server database. on the client, it can be converted to something like 
//         jpg = "JPEG Image" or svg = "SVG Vector Image"
// TODO: right click menu of file entry copy name feature

// TODO: fix issue where resizing column headers requires aspect ratio tuning! ideally a fix would make it so the column headers are not part
//       of the scrolling list

function Logout() {
	fetch("/api/logout", { method: "POST" })
	.then((response) => {
		if (response.ok) { // When server responds with 200, redirect user to login page
			window.location.pathname = "/login";
		}
	});
}

// 'FileExplorerWindow' can hold one or multiple 'FileExplorer' components
function FileExplorerWindow() {
	// TODO: settings
	let useAmericanDateFormat = false;

	const FileExplorer = () => {
		// Arbitrary values can be specified to adjust the relative widths of the columns in the file explorer
		const columnWidths = {
			NAME: 8,
			TYPE: 2,
			SIZE: 2,
			DATE_ADDED: 4
		};

		let columnWidthDivider = Object.values(columnWidths).reduce((a, b) => a + b, 0) / 100;

		// This stores all the metadata of files in the user's currentl filepath.
		// When setFileEntries() is called, the DOM will update with the new entries.
		// To create a file entry, call 'createFileEntry'
		const [ fileEntries, setFileEntries ] = createSignal([]);
		
		// Constructs a file entry object that can be appended to fileEntries() and updated with setFileEntries()
		const createFileEntry = (handle, fileName, fileSizeInBytes, fileType, dateAdded) => {
			// Type checking
			if (typeof(handle) != "string") throw new TypeError("handle must be a string!");
			if (typeof(fileName) != "string") throw new TypeError("fileName must be a string!");
			if (typeof(fileSizeInBytes) != "number") throw new TypeError("fileSizeInBytes must be a number!");
			if (typeof(fileType) != "string") throw new TypeError("fileType must be a string!");
			if (typeof(dateAdded) != "number") throw new TypeError("dateAdded must be a number!");

			return {
				handle: handle,
				fileName: fileName,
				fileSizeInBytes: fileSizeInBytes,
				fileType: fileType,
				dateAdded: dateAdded
			};
		}

		// Adds a single file entry and immediately updates the DOM
		const addSingleFileEntry = (entry) => {
			setFileEntries((prevEntries) => [...prevEntries, entry]);
		};
		
		// Removes any file entry that has a handle that exactly matches 'targetHandle' and immediately updates the DOM
		const removeFileEntriesByHandle = (targetHandle) => {
			setFileEntries((prevEntries) => prevEntries.filter((entry) => { return entry.handle != targetHandle; }));
		};

		// This function populates the file list with file entries defined in 'fileEntries'.
		// If 'searchText' is not empty, only files found with 'searchText' in the file's name will be shown in the file list.
		const refreshFileList = (searchText) => {
			let newEntries = [];

			// TODO: create a mock file list that is not random perhaps? or just use real data for once.
			for (let i = 0; i < 10; i++) {
				let handle = Math.floor(Math.random() * 100);
				let dateAdded = (new Date()) / 1000;

				try {
					let entry = createFileEntry(
						handle.toString(),
						handle.toString(),
						Math.random() * 100000000,
						"png",
						dateAdded
					);

					newEntries.push(entry);
				} catch (error) {
					console.error(error);
				}
			}

			setFileEntries(newEntries);
		};

		const onSearchBarKeypress = (event) => {
			if (event.keyCode != 13)
				return;

			let searchText = event.target.value;
			
			// Unfocus the search bar
			event.target.blur();

			if (searchText.length == 0) {
				refreshFileList();
			} else {
				setFileEntries(fileEntries().filter(entry => {
					let findIndex = entry.fileName.toLowerCase().search(searchText.toLowerCase());
					return findIndex != -1;
				}));
			}
		}

		const Column = (props) => {
			return (
				<div style={`width: ${props.relativeWidth / columnWidthDivider}%;`}
						 class={`flex items-center h-[100%]`}>
					{props.children}
				</div>
			);
		};

		const FileEntryColumnText = (props) => {
			return (
				<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-[0.825em] overflow-ellipsis font-normal whitespace-nowrap">{props.text}</h1>
			);
		};

		const ColumnHeaderText = (props) => {
			return (
				<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-sm overflow-ellipsis font-medium whitespace-nowrap">{props.text}</h1>
			);
		};

		const FileEntry = (props) => {
			let fileTypeText = props.fileType
			let sizeText = getFormattedBytesSizeText(props.fileSizeInBytes);
			let dateAddedText = getDateAddedTextFromUnixTimestamp(props.dateAdded + (Math.random() - 0.5) * 10000, useAmericanDateFormat);

			return (
				<div class="flex flex-row flex-nowrap flex-start flex-shrink-0 items-center overflow-x-hidden w-[100%] h-8 border-b-[1px] bg-zinc-100">
					<div class={`flex justify-center items-center h-[100%] aspect-[1.2]`}>
						<div class="aspect-square ml-2 h-[80%] bg-indigo-500">

						</div>
					</div>
					<Column relativeWidth={columnWidths.NAME}>
						<FileEntryColumnText text={props.fileName}/>
					</Column>
					<Column relativeWidth={columnWidths.TYPE}>
						<FileEntryColumnText text={fileTypeText}/>
					</Column>
					<Column relativeWidth={columnWidths.SIZE}>
						<FileEntryColumnText text={sizeText}/>
					</Column>
					<Column relativeWidth={columnWidths.DATE_ADDED}>
						<FileEntryColumnText text={dateAddedText}/>
					</Column>
				</div>
			);
		}

		return (
			<div style={`width: ${100}%`} class="flex flex-col min-w-[550px] h-[100%]"> {/* Style is used for width so it can be resized dynamically using JS */}
				<div class="flex flex-row px-2 items-center flex-shrink-0 w-[100%] h-12 bg-zinc-200"> {/* Search bar */}
					<div class="flex flex-row items-center justify-start w-[100%] h-[80%] bg-zinc-50 rounded-full border-2 border-zinc-300"> 
						<MagnifyingGlassIcon class="aspect-square w-5 h-5 invert-[20%] ml-3" />
						<input
							type="text"
							placeholder="Search"
							class="flex-grow ml-2 mr-6 outline-none bg-transparent font-SpaceGrotesk text-medium text-[0.95em]"
							onKeyPress={onSearchBarKeypress}
						/>
					</div>
					<button class="w-max h-6 px-2 mr-2 bg-white rounded-md select-none hover:bg-zinc-200 active:bg-zinc-300" onClick={() => {
						refreshFileList();
					}}>Populate</button>
				</div>
				<div class="flex flex-col w-[100%] overflow-auto bg-zinc-300">
					<div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"> {/* Column headers bar */}
						<div class={`flex items-center h-[100%] aspect-[1.95]`}>
							
						</div>
						<Column relativeWidth={columnWidths.NAME}>
							<ColumnHeaderText text="Name"/>
						</Column>
						<Column relativeWidth={columnWidths.TYPE}>
							<ColumnHeaderText text="Type"/>
						</Column>
						<Column relativeWidth={columnWidths.SIZE}>
							<ColumnHeaderText text="Size"/>
						</Column>
						<Column relativeWidth={columnWidths.DATE_ADDED}>
							<ColumnHeaderText text="Date added"/>
						</Column>
					</div>
					<For each={fileEntries()}>
						{(entryInfo, index) => (
							<FileEntry
								{...entryInfo}
							/>
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
		// Convenience function for automatically calling all setters added to 'setSelectedSetters'
		deselectAllMenus: () => {
			Object.entries(navbarStore.setSelectedSetters).forEach(([key, setSelectedFunc]) => {
				setSelectedFunc(false);
			});
		}
	};

	// TODO: retrieve these values from the server
	navbarStore.quotaUsedInBytes = 235346837;
	navbarStore.totalQuotaInBytes = 2000000000;

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
		<div class="flex flex-row min-w-max w-screen min-h-max h-screen bg-[#eeeeee]"> {/* Background */}
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
