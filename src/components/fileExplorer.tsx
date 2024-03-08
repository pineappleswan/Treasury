import { createSignal, For } from "solid-js";
import { getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../common/common";
import { FILESYSTEM_COLUMN_WIDTHS } from "../client/enumsAndTypes";
import { UploadFileEntry, UploadFilesPopup } from "./uploadFilesPopup";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { ContextMenu, ContextMenuFunctions } from "./contextMenu";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import SplitLayoutIcon from "../assets/icons/svg/split-layout.svg?component-solid";
import RightAngleArrowIcon from "../assets/icons/svg/right-angle-arrow.svg?component-solid";
import UploadIcon from "../assets/icons/svg/upload.svg?component-solid";

// TODO: error popups! + disallow user from uploading a file to a target folder, then deleting that folder while in progress (moving or renaming destination shouldnt matter, as it has a handle)
// TODO: remove all the state crap
// TODO: empty directory message ("theres nothing here..." for example)

enum FileCategory { 
	Generic = "Generic",
	Folder = "Folder",
	Image = "Image",
	Video = "Video",
	Text = "Text",
	Document = "Document"
};

enum FileListSortMode {
	Name,
	Size,
	Type,
	DateAdded
};

type FilesystemEntry = {
	handle: string,
	name: string,
	size: number,
	category: FileCategory,
	typeInfoText: string, // This is what shows on the user's screen in the type column
	dateAdded: number,
	fileCryptKey: Uint8Array // For decrypting the file
};

type FileExplorerWindowProps = {
	userSettings: UserSettings,
	globalFileEntries: FilesystemEntry[],
	visible: boolean,
	uploadFilesCallback: Function,
	forceRefreshListFunctions: Function[] // Forces a call to refreshFileList() within the 
};

type FileExplorerProps = {
	parentWindowProps: FileExplorerWindowProps,
	uploadFilesCallback: Function
};

type ContextMenuContext = {
	fileHandle?: string
};

// The context menu component will automatically fill in the functions for the following object upon creation
let contextMenuFunctions: ContextMenuFunctions = {};
const contextMenuContext: ContextMenuContext = {};

function contextMenuActionCallback(action: string) {
	const fileHandle = contextMenuContext.fileHandle;

	if (!fileHandle)
		return;

	if (action == "download") {
		console.log(`Downloading handle: ${fileHandle}`);
	}
}

// Sorting functions for file lists
const textLocaleCompareString = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const sortFilesystemEntryByType = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	if (a.typeInfoText == b.typeInfoText) {
		return textLocaleCompareString(a.name, b.name);
	} else {
		if (reversed) {
			return textLocaleCompareString(b.typeInfoText, a.typeInfoText);
		} else {
			return textLocaleCompareString(a.typeInfoText, b.typeInfoText);
		}
	}
}

const sortFilesystemEntryBySize = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	if (a.size == b.size) {
		return textLocaleCompareString(a.name, b.name);
	} else {
		if (reversed) {
			return b.size - a.size;
		} else {
			return a.size - b.size;
		}
	}
}

const sortFilesystemEntryByDateAdded = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	if (a.dateAdded == b.dateAdded) {
		return textLocaleCompareString(a.name, b.name);
	} else {
		if (reversed) {
			return b.dateAdded - a.dateAdded;
		} else {
			return a.dateAdded - b.dateAdded;
		}
	}
}

const [ splitViewMode, setSplitViewMode ] = createSignal(false);

// The actual file explorer component
const FileExplorer = (props: FileExplorerProps) => {
	const { parentWindowProps, uploadFilesCallback } = props;
	const userSettings: UserSettings = parentWindowProps.userSettings;

	// This stores all the file entries in the user's current filepath.
	// When setFileEntries() is called, the DOM will update with the new entries.
	const [ fileEntries, setFileEntries ] = createSignal<FilesystemEntry[]>([]);

	let searchText: string = "";
	let [ sortMode, setSortMode ] = createSignal<FileListSortMode>(FileListSortMode.Name);
	let [ sortAscending, setSortAscending ] = createSignal<boolean>(true);
	
	// This function populates the file list with file entries defined in the 'fileEntries' signal.
	const refreshFileList = () => {
		// TODO: only use the entries in the current browsing directory, not globalFileEntries BUT do reprocess globalFileEntries in case new ones have been added!
		let entries: FilesystemEntry[] = [...parentWindowProps.globalFileEntries];

		// Filter by search text if applicable
		if (searchText.length > 0) {
			entries = entries.filter(entry => {
				let findIndex = entry.name.toLowerCase().search(searchText.toLowerCase());
				return findIndex != -1;
			});
		}

		// Sort
		if (sortMode() == FileListSortMode.Name) {
			if (sortAscending()) {
				entries.sort((a, b) => textLocaleCompareString(a.name, b.name));
			} else {
				entries.sort((a, b) => textLocaleCompareString(b.name, a.name));
			}
		} else if (sortMode() == FileListSortMode.Type) {
			if (sortAscending()) {
				entries.sort((a, b) => sortFilesystemEntryByType(a, b, false));
			} else {
				entries.sort((a, b) => sortFilesystemEntryByType(a, b, true));
			}
		} else if (sortMode() == FileListSortMode.Size) {
			if (sortAscending()) {
				entries.sort((a, b) => sortFilesystemEntryBySize(a, b, false));
			} else {
				entries.sort((a, b) => sortFilesystemEntryBySize(a, b, true));
			}
		} else if (sortMode() == FileListSortMode.DateAdded) {
			if (sortAscending()) {
				entries.sort((a, b) => sortFilesystemEntryByDateAdded(a, b, false));
			} else {
				entries.sort((a, b) => sortFilesystemEntryByDateAdded(a, b, true));
			}
		} else {
			throw new Error(`Invalid sort mode!`);
		}

		setFileEntries(entries);
	};

	// Handles search bar functionality
	const onSearchBarKeypress = (event: any) => {
		if (event.keyCode != 13)
			return;

		searchText = event.target.value;
		event.target.blur(); // Unfocus the search bar
		refreshFileList();
	}

	// TODO: put sort button in its own component and supply a callback function to set states and getter to get states
	type SortButtonProps = {
		sortAscending: boolean,
		sortMode: any
	};

	const SortButton = (props: SortButtonProps) => {
		const [ rotation, setRotation ] = createSignal(sortAscending() ? 0 : 180);
		const [ forceVisible, setForceVisible ] = createSignal(false);

		return (
			<RightAngleArrowIcon
				style={`opacity: ${(forceVisible() || sortMode() == props.sortMode) ? 100 : 0}%`}
				class={`aspect-square w-5 h-5 ml-1 rounded-full hover:cursor-pointer hover:bg-zinc-300 rotate-${rotation()}`}
				onClick={() => {
					if (sortMode() != props.sortMode) {
						setSortMode(props.sortMode);
						setSortAscending(props.sortAscending);
					} else {
						// Flip sort ascending only when the current global sort mode is the same as the button's sort mode
						setSortAscending(!sortAscending());
						props.sortAscending = sortAscending();
					}
					
					setRotation(props.sortAscending ? 0 : 180);
					refreshFileList();
				}}
				// Make button visible when hovering over it while it's invisible by default (if its not of the current sort type)
				onmouseenter={() => setForceVisible(true) }
				onmouseleave={() => setForceVisible(false) }
			/>
		);
	};
	
	const FileEntryColumnText = (props: any) => {
		return (
			<h1 class="flex flex-none ml-2 font-SpaceGrotesk text-zinc-900 text-[0.825em] font-normal select-none w-0 min-w-[100%]">{props.text}</h1>
		);
	};

	// The file entry component
	const FileEntry = (entry: FilesystemEntry) => {
		let sizeText = getFormattedBytesSizeText(entry.size);
		let dateAddedText = getDateAddedTextFromUnixTimestamp(entry.dateAdded, userSettings.useAmericanDateFormat);

		// Context menu
		const handleContextMenu = (event: any) => {
			event.preventDefault();

			// Update menu context
			contextMenuContext.fileHandle = entry.handle;

			contextMenuFunctions.setVisible!(true);
			contextMenuFunctions.setPosition!({ x: event.clientX, y: event.clientY });
		};

		return (
			<div 
				class="flex flex-row flex-nowrap items-center h-8 border-b-[1px] bg-zinc-100
						 hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300"
				onContextMenu={handleContextMenu}
			>
				<div class={`flex justify-center items-center h-[100%] aspect-[1.2]`}>
					<div class="aspect-square ml-2 h-[80%] bg-indigo-500">

					</div>
				</div>
				<Column width={FILESYSTEM_COLUMN_WIDTHS.NAME} noShrink>
					<FileEntryColumnText text={entry.name}/>
				</Column>
				<Column width={FILESYSTEM_COLUMN_WIDTHS.TYPE} noShrink>
					<FileEntryColumnText text={entry.typeInfoText}/>
				</Column>
				<Column width={FILESYSTEM_COLUMN_WIDTHS.SIZE} noShrink>
					<FileEntryColumnText text={sizeText}/>
				</Column>
				<Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
					<FileEntryColumnText text={dateAddedText}/>
				</Column>
			</div>
		);
	}

	// Add refreshFileList function to parent window props so that external calls can be made
	parentWindowProps.forceRefreshListFunctions.push(refreshFileList);

	// Handle upload window drag events
	const [ uploadWindowVisible, setUploadWindowVisible ] = createSignal(false);

	return (
		<div
			class="relative flex flex-col w-[100%] h-[100%] min-w-[550px]"
			style={`${uploadWindowVisible() && "overflow: hidden;"}`}
		>
			<UploadFilesPopup
				visibilityGetter={uploadWindowVisible}
				uploadCallback={(files: UploadFileEntry[]) => {
					setUploadWindowVisible(false);
					uploadFilesCallback(files);
				}}
				closeCallback={() => setUploadWindowVisible(false)}
			/>
			<div class="flex flex-row px-2 items-center flex-shrink-0 w-[100%] bg-zinc-200"> {/* Search bar */}
				<div class="flex flex-row items-center justify-start w-[100%] h-10 my-1.5 bg-zinc-50 rounded-full border-2 border-zinc-300"> 
					<MagnifyingGlassIcon class="aspect-square w-5 h-5 invert-[20%] ml-3" />
					<input
						type="text"
						placeholder="Search"
						class="flex-grow ml-2 mr-6 outline-none bg-transparent font-SpaceGrotesk text-medium text-[0.95em]"
						onKeyPress={onSearchBarKeypress}
					/>
				</div>
				<UploadIcon
					class={`aspect-square w-[27px] h-[27px] ml-3 p-[3px] rounded-md invert-[20%]
									hover:cursor-pointer hover:bg-zinc-100 active:bg-zinc-300 ${uploadWindowVisible() ? "bg-zinc-100" : ""}`}
					onClick={() => {
						setUploadWindowVisible(!uploadWindowVisible());
					}}
				/>
				<SplitLayoutIcon
					class={`aspect-square w-[27px] h-[27px] ml-2 mr-4 p-[3px] rounded-md invert-[20%]
									hover:cursor-pointer hover:bg-zinc-100 active:bg-zinc-300 ${splitViewMode() ? "bg-zinc-100" : ""}`}
					onClick={() => {
						let newState = !splitViewMode();
						setSplitViewMode(newState);
					}}
				/>
			</div>
			<div class="flex flex-col w-[100%] bg-zinc-300">
				<div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"> {/* Column headers bar */}
					<div class={`h-[100%] aspect-[1.95]`}></div> {/* Icon column (empty) */}
					<Column width={FILESYSTEM_COLUMN_WIDTHS.NAME} noShrink>
						<ColumnText text="Name" semibold/>
						<SortButton sortAscending={true} sortMode={FileListSortMode.Name}/>
					</Column>
					<Column width={FILESYSTEM_COLUMN_WIDTHS.TYPE} noShrink>
						<ColumnText text="Type" semibold/>
						<SortButton sortAscending={true} sortMode={FileListSortMode.Type}/>
					</Column>
					<Column width={FILESYSTEM_COLUMN_WIDTHS.SIZE} noShrink>
						<ColumnText text="Size" semibold/>
						<SortButton sortAscending={true} sortMode={FileListSortMode.Size}/>
					</Column>
					<Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
						<ColumnText text="Date added" semibold/>
						<SortButton sortAscending={true} sortMode={FileListSortMode.DateAdded}/>
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

// 'FileExplorerWindow' can hold one or multiple 'FileExplorer' components
function FileExplorerWindow(props: FileExplorerWindowProps) {
	const { userSettings, globalFileEntries, uploadFilesCallback } = props;
	let splitViewLeftWidth = 50;

	// Split view mode dragging resize functionality
	const [ leftWidth, setLeftWidth ] = createSignal(splitViewLeftWidth);
	const [ rightWidth, setRightWidth ] = createSignal(100 - splitViewLeftWidth);
	const [ dragging, setDragging ] = createSignal(false);
	let startDraggingX = 0;
	let startDraggingLeftWidth = 0;

	const handleMouseDown = (event: any) => {
		startDraggingX = event.clientX;
		startDraggingLeftWidth = leftWidth();
		setDragging(true);
	}

	const handleMouseUp = () => {
		setDragging(false);
	}

	const handleMouseMove = (event: any) => {
		if (!dragging())
			return;
		
		const fileExplorerWindow = document.getElementById("file-explorer-window");

		if (fileExplorerWindow == null) {
			console.error("'file-explorer-window' is null!");
			return;
		}

		const masterContainerWidth = fileExplorerWindow.offsetWidth;
		const mouseX = event.clientX;
		const mouseXDelta = mouseX - startDraggingX;
		const mouseXDeltaPercentage = (mouseXDelta / masterContainerWidth) * 100;

		let newLeftWidth = startDraggingLeftWidth + mouseXDeltaPercentage;

		// Clamp how much the user can resize the relative width of the two explorers
		if (newLeftWidth < 20) newLeftWidth = 20;
		if (newLeftWidth > 80) newLeftWidth = 80;

		setLeftWidth(newLeftWidth);
		splitViewLeftWidth = newLeftWidth;
		setRightWidth(100 - newLeftWidth);
	};

	document.addEventListener("mousemove", handleMouseMove);
	document.addEventListener("mouseup", handleMouseUp);

	let jsx = (
		<div
			id="file-explorer-window"
			class={`flex flex-row h-[100%]`}
			style={`${props.visible ? "width: 100%;" : "width: 0;"}`}
		>
			<ContextMenu actionCallback={contextMenuActionCallback} settings={contextMenuFunctions} />
			<div class="flex flex-row overflow-auto" style={`width: ${splitViewMode() ? leftWidth() : 100}%`}>
				<FileExplorer parentWindowProps={props} uploadFilesCallback={uploadFilesCallback} />
			</div>
			<div
				class={`flex flex-row h-[100%]`}
				style={`
					width: ${rightWidth()}%;
					visibility: ${!splitViewMode() && "hidden"};
					${!splitViewMode() && "position: absolute;"}
				`}
			>
				<div class={`bg-zinc-300 w-[3px] h-[100%] hover:cursor-ew-resize`} onMouseDown={handleMouseDown}> {/* Draggable separator for the two windows */}

				</div>
				<div class="flex flex-row overflow-auto w-[100%]" style={`width: 100%`}>
					<FileExplorer parentWindowProps={props} uploadFilesCallback={uploadFilesCallback} />
				</div>
			</div>
		</div>
	);

	// TODO: temporary debug stuff
	/*
	contextMenuFunctions.setVisible!(true);
	contextMenuFunctions.setPosition!({ x: 100, y: 100 });

	console.log(contextMenuFunctions);
	*/

	return jsx;
}

export type { FilesystemEntry };

export {
	FileExplorerWindow,
	FileCategory
};
