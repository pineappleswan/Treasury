import { createSignal, For, onCleanup, Setter } from "solid-js";
import { getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp, getEncryptedFileSizeAndChunkCount, getOriginalFileSizeFromEncryptedFileSize } from "../common/commonUtils";
import { FILESYSTEM_COLUMN_WIDTHS } from "../client/columnWidths";
import { UploadFileEntry, UploadFilesPopup } from "./uploadFilesPopup";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { ContextMenu, ContextMenuFileEntry, ContextMenuSettings, Vector2D } from "./contextMenu";
import { getFileExtensionFromName, getFileIconFromExtension } from "../utility/fileTypes";
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";
import { DragContextTip, DragContextTipSettings } from "./dragContextTip";
import { SortButton, SortButtonOnClickCallbackData } from "./sortButton";
import { QRCodePopup, QRCodePopupSettings } from "./qrCodePopup";

// Icons
import FileFolderIcon from "../assets/icons/svg/files/file-folder.svg?component-solid";
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import SplitLayoutIcon from "../assets/icons/svg/split-layout.svg?component-solid";
import UploadIcon from "../assets/icons/svg/upload.svg?component-solid";
import { DownloadFileEntry, FileDownloadResolveInfo, FileUploadResolveInfo } from "../client/transfers";

// TODO: error popups! + disallow user from uploading a file to a target folder, then deleting that folder while in progress (moving or renaming destination shouldnt matter, as it has a handle)
// TODO: remove all the state crap
// TODO: empty directory message ("theres nothing here..." for example)
// TODO: sort by category, extension or true (changeable from settings menu or some other way)
// idea: different sorting mode nuance settings like name natural sorting vs standard a < b sorting

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
	encryptedFileSize: number,
	category: FileCategory,
	dateAdded: number,
	fileCryptKey: Uint8Array, // For decrypting the file
	isFolder: boolean
};

// Stores a list of functions that will communicate with an individual file entry in the file explorer
type FileEntryCommunicationData = {
	setSelected: (state: boolean) => void,
	isSelected: () => boolean
};

type FileEntryCommunicationMap = { [HTMLDialogElement: string]: FileEntryCommunicationData };

type FileExplorerEntryProps = {
	fileEntry: FilesystemEntry,

	// Maps file entry html element ids to data which allows for calling functions specific to one file entry in the file explorer list
	fileEntryCommunicationMap: FileEntryCommunicationMap,

	// Context data
	userSettings: UserSettings,
	contextMenuSettings: ContextMenuSettings,
	dragContextTipSettings: DragContextTipSettings,
};

// Sorting functions for file lists
const textLocaleCompareString = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const sortFilesystemEntryByType = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	const extA = getFileExtensionFromName(a.name);
	const extB = getFileExtensionFromName(b.name);

	if (extA == extB) {
		return textLocaleCompareString(a.name, b.name);
	} else {
		if (reversed) {
			return textLocaleCompareString(extB, extA);
		} else {
			return textLocaleCompareString(extA, extB);
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

// The file entry component
const FileExplorerEntry = (props: FileExplorerEntryProps) => {
	const { fileEntry, fileEntryCommunicationMap, userSettings, contextMenuSettings, dragContextTipSettings } = props;
	const [ isSelected, setSelected ] = createSignal(false);

	let sizeText = getFormattedBytesSizeText(fileEntry.size);
	let dateAddedText = getDateAddedTextFromUnixTimestamp(fileEntry.dateAdded, userSettings.useAmericanDateFormat);
	const thisElementId = `file-entry-${generateSecureRandomAlphaNumericString(16)}`;

	// Add to communication map
	fileEntryCommunicationMap[thisElementId] = {
		setSelected: (state: boolean) => {
			setSelected(state);
		},
		isSelected: () => {
			return isSelected();
		}
	};

	const handleContextMenu = (event: any) => {
		event.preventDefault();

		let clickPos: Vector2D = { x: event.clientX, y: event.clientY };
		const screenSize: Vector2D = { x: window.screen.width, y: window.screen.height, };
		const menuSize = contextMenuSettings.getSize!();

		// Wrap position
		if (clickPos.x + menuSize.x > screenSize.x)
			clickPos.x -= menuSize.x;

		if (clickPos.y + menuSize.y > screenSize.y)
			clickPos.y -= menuSize.y;

		// Set position
		const thisElement = document.getElementById(thisElementId)!;
		const scrollingFrameElement = thisElement.parentElement!.parentElement!;
		const scrollOffset = scrollingFrameElement.scrollTop;
		const offsetTop = scrollingFrameElement.offsetTop;
		const offsetLeft = scrollingFrameElement.offsetLeft;

		// + 5 on each axis to apply a bit of an offset so the mouse doesn't always overlap with a button
		contextMenuSettings.setPosition!({ x: clickPos.x + 5, y: clickPos.y + 5 });

		// Update menu context
		const sizeAndChunkCountInfo = getEncryptedFileSizeAndChunkCount(fileEntry.size); // TODO: not needed?

		contextMenuSettings.fileEntries = [{
			fileEntry: fileEntry,
		}];
		
		contextMenuSettings.setVisible!(true);

		// Handle selection logic
		if (!isSelected()) {
			Object.values(fileEntryCommunicationMap).forEach((comm) => {
				if (comm.isSelected()) {
					comm.setSelected(false);
				}
			})

			fileEntryCommunicationMap[thisElementId].setSelected(true);
		}
	};

	// Get file extension
	const fileExtension = getFileExtensionFromName(fileEntry.name);

	// Determine type text
	const fileTypeText = (fileEntry.isFolder ? "Folder" : (fileExtension.toUpperCase() + " file"));

	// Drag events
	const [ isDragging, setIsDragging ] = createSignal(false);
	let isMouseDown = false;
	let startDragPos: Vector2D = { x: 0, y: 0 };
	let currentMousePos: Vector2D = { x: 0, y: 0 };

	const runDragLoop = () => {
		if (!isDragging())
			return;

		// Prevents obstruction from the mouse
		let dragOffset = 20;
		const bottomWrapPadding = 20;

		const targetPos: Vector2D = {
			x: currentMousePos.x,
			y: currentMousePos.y
		};

		const elementSize = dragContextTipSettings.getSize!();
		const windowInnerSize = { x: window.innerWidth, y: window.innerHeight };

		// Wrap position
		if (targetPos.x > windowInnerSize.x - elementSize.x - dragOffset) {
			targetPos.x -= elementSize.x;
			dragOffset = -dragOffset;
		}

		if (targetPos.y > windowInnerSize.y - elementSize.y - bottomWrapPadding) {
			targetPos.y -= elementSize.y;
		}

		dragContextTipSettings.setPosition!({
			x: targetPos.x + dragOffset,
			y: targetPos.y
		});

		requestAnimationFrame(runDragLoop);
	}
	
	const handleMouseDown = (event: MouseEvent) => {
		if (event.button != 0) // Must be left click to drag
			return;

		isMouseDown = true;
		startDragPos = { x: event.clientX, y: event.clientY };
		dragContextTipSettings.setTipText!(fileEntry.name);
	};
	
	const handleMouseUp = (event: MouseEvent) => {
		isMouseDown = false;
		setIsDragging(false);
		dragContextTipSettings.setVisible!(false);
	};
	
	const handleMouseMove = (event: MouseEvent) => {
		if (!isMouseDown)
			return;

		const mousePos: Vector2D = { x: event.clientX, y: event.clientY };
		const moveOffset: Vector2D = { x: mousePos.x - startDragPos.x, y: mousePos.y - startDragPos.y };
		currentMousePos = mousePos;

		// Only start dragging when the mouse has moved
		if (moveOffset.x != 0 && moveOffset.y != 0 && isDragging() == false) {
			dragContextTipSettings.setVisible!(true);
			setIsDragging(true);
			runDragLoop();
		}
	};

	// These events must be global or else they won't register when the mouse leaves the div.
	document.addEventListener("mouseup", handleMouseUp);
	document.addEventListener("mousemove", handleMouseMove);

	onCleanup(() => {
		document.removeEventListener("mouseup", handleMouseUp);
		document.removeEventListener("mousemove", handleMouseMove);

		delete fileEntryCommunicationMap[thisElementId];
	});

	return (
		<div 
			class={`flex flex-row flex-nowrap shrink-0 items-center h-8 border-b-[1px]
							${isSelected() ? "bg-blue-100" : "bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300"}
					 		hover:cursor-pointer`}
			id={thisElementId}
			onContextMenu={handleContextMenu}
			onMouseDown={handleMouseDown}
		>
			<div class={`flex justify-center items-center h-[100%] aspect-[1.2]`}>
				{
					fileEntry.isFolder ? (
						<FileFolderIcon class="ml-2 w-6 h-6" />
					) : (
						getFileIconFromExtension(fileExtension)
					)
				}
			</div>
			<Column width={FILESYSTEM_COLUMN_WIDTHS.NAME} noShrink>
				<ColumnText text={fileEntry.name} matchParentWidth ellipsis/>
			</Column>
			<Column width={FILESYSTEM_COLUMN_WIDTHS.TYPE} noShrink>
				<ColumnText text={fileTypeText} matchParentWidth/>
			</Column>
			<Column width={FILESYSTEM_COLUMN_WIDTHS.SIZE} noShrink>
				<ColumnText text={sizeText} matchParentWidth/>
			</Column>
			<Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
				<ColumnText text={dateAddedText} matchParentWidth/>
			</Column>
		</div>
	);
}

// This function ... TODO: DOCUMENTATION
const refreshFileEntriesArray = (globalFileEntries: FilesystemEntry[], fileEntriesSetter: Setter<FilesystemEntry[]>, filterSettings: FileExplorerFilterSettings) => {
	// TODO: only use the entries in the current browsing directory, not globalFileEntries BUT do reprocess globalFileEntries in case new ones have been added!
	const { searchText, sortMode, sortAscending } = filterSettings;
	let entries: FilesystemEntry[] = [...globalFileEntries];

	// Filter by search text if applicable
	if (searchText.length > 0) {
		entries = entries.filter(entry => {
			let findIndex = entry.name.toLowerCase().search(searchText.toLowerCase());
			return findIndex != -1;
		});
	}

	// Sort
	if (sortMode == FileListSortMode.Name) {
		if (sortAscending) {
			entries.sort((a, b) => textLocaleCompareString(a.name, b.name));
		} else {
			entries.sort((a, b) => textLocaleCompareString(b.name, a.name));
		}
	} else if (sortMode == FileListSortMode.Type) {
		entries.sort((a, b) => sortFilesystemEntryByType(a, b, !sortAscending));
	} else if (sortMode == FileListSortMode.Size) {
		entries.sort((a, b) => sortFilesystemEntryBySize(a, b, !sortAscending));
	} else if (sortMode == FileListSortMode.DateAdded) {
		entries.sort((a, b) => sortFilesystemEntryByDateAdded(a, b, !sortAscending));
	} else {
		throw new Error(`Invalid sort mode!`);
	}

	fileEntriesSetter(entries);
};

type FileExplorerFilterSettings = {
	searchText: string,
	sortMode: FileListSortMode,
	sortAscending: boolean
};

// The callbacks used to communicate with the main treasury page (TODO: move to treasury.tsx???)
type FileExplorerMainPageCallbacks = {
	uploadFiles: (entries: UploadFileEntry[]) => void,
	downloadFiles: (entries: DownloadFileEntry[]) => void
};

type FileExplorerProps = {
	htmlId: string,
	parentWindowProps: FileExplorerWindowProps,
	contextMenuSettings: ContextMenuSettings,
	fileEntryCommunicationMap: FileEntryCommunicationMap,
	dragContextTipSettings: DragContextTipSettings,

	// Callbacks
	mainPageCallbacks: FileExplorerMainPageCallbacks
};

// The actual file explorer component
const FileExplorer = (props: FileExplorerProps) => {
	const { parentWindowProps, contextMenuSettings, fileEntryCommunicationMap, dragContextTipSettings, mainPageCallbacks } = props;
	const fileExplorerId = props.htmlId;
	const userSettings: UserSettings = parentWindowProps.userSettings;
	const globalFileEntries = parentWindowProps.globalFileEntries;

	// This stores all the file entries in the user's current filepath.
	// When setFileEntries() is called, the DOM will update with the new entries.
	const [ fileEntries, setFileEntries ] = createSignal<FilesystemEntry[]>([]);

	//let [ sortMode, setSortMode ] = createSignal<FileListSortMode>(FileListSortMode.Name);
	//let [ sortAscending, setSortAscending ] = createSignal<boolean>(true);
	//let searchText: string = "";

	const [ filterSettings, setFilterSettings ] = createSignal<FileExplorerFilterSettings>({
		searchText: "",
		sortMode: FileListSortMode.Name,
		sortAscending: true
	});

	// Refreshes the file entries array with the current settings
	const refreshFileExplorer = () => {
		refreshFileEntriesArray(globalFileEntries, setFileEntries, filterSettings());
	};

	// Add refresh function to parent window props so that external calls can be made to refresh this file list
	parentWindowProps.forceRefreshListFunctions.push(refreshFileExplorer);

	// Handles search bar functionality
	const onSearchBarKeypress = (event: any) => {
		if (event.keyCode != 13)
			return;

		// Set search text
		setFilterSettings({ ...filterSettings(), searchText: event.target.value });

		event.target.blur(); // Unfocus the search bar

		// Refresh entries
		refreshFileExplorer();
	}

	// This function is called when a sort button is clicked
	const sortButtonOnClickCallback = (data: SortButtonOnClickCallbackData) => {
		// Update filter settings
		setFilterSettings({
			...filterSettings(),
			sortMode: data.sortMode,
			sortAscending: data.sortAscending
		});

		// Refresh file list
		refreshFileExplorer();
	};

	// Handle upload window events
	const [ uploadWindowVisible, setUploadWindowVisible ] = createSignal(false);

	const uploadPopupUploadCallback = (files: UploadFileEntry[]) => {
		setUploadWindowVisible(false);
		mainPageCallbacks.uploadFiles(files);
	};

	return (
		<div
			class="relative flex flex-col w-[100%] h-[100%] min-w-[550px] overflow-x-hidden"
			id={fileExplorerId}
			style={`${uploadWindowVisible() && "overflow: hidden !important;"}`}
		>
			<UploadFilesPopup
				isVisibleGetter={uploadWindowVisible}
				uploadCallback={uploadPopupUploadCallback}
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
					class={`aspect-square shrink-0 w-[26px] h-[26px] ml-2 p-[3px] rounded-md invert-[20%]
					hover:cursor-pointer hover:bg-zinc-100 active:bg-zinc-300 ${uploadWindowVisible() ? "bg-zinc-100" : ""}`}
					onClick={() => {
						setUploadWindowVisible(!uploadWindowVisible());
					}}
				/>
				<SplitLayoutIcon
					class={`aspect-square shrink-0 w-[25px] h-[25px] ml-2 mr-3 p-[3px] rounded-md invert-[20%]
					hover:cursor-pointer hover:bg-zinc-100 active:bg-zinc-300 ${splitViewMode() ? "bg-zinc-100" : ""}`}
					onClick={() => {
						let newState = !splitViewMode();
						setSplitViewMode(newState);
					}}
				/>
				<div
					class="flex flex-row shrink-0 items-center justify-center px-2 py-0.5 mr-2 rounded-lg select-none
									font-SpaceGrotesk text-sm font-medium text-zinc-900 whitespace-nowrap bg-zinc-100 border-zinc-300 border-[2px]
									hover:bg-zinc-200 active:bg-zinc-300 hover:cursor-pointer"
				>
					New folder
				</div>
			</div>
			<div class="flex flex-col w-[100%]">
				<div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"> {/* Column headers bar */}
					<div class={`h-[100%] aspect-[1.95]`}></div> {/* Icon column (empty) */}
					<Column width={FILESYSTEM_COLUMN_WIDTHS.NAME} noShrink>
						<ColumnText text="Name" semibold/>
						<SortButton
							sortAscending={true}
							sortMode={FileListSortMode.Name}
							globalFilterSettingsGetter={filterSettings}
							onClick={sortButtonOnClickCallback}
						/>
					</Column>
					<Column width={FILESYSTEM_COLUMN_WIDTHS.TYPE} noShrink>
						<ColumnText text="Type" semibold/>
						<SortButton
							sortAscending={true}
							sortMode={FileListSortMode.Type}
							globalFilterSettingsGetter={filterSettings}
							onClick={sortButtonOnClickCallback}
						/>
					</Column>
					<Column width={FILESYSTEM_COLUMN_WIDTHS.SIZE} noShrink>
						<ColumnText text="Size" semibold/>
						<SortButton
							sortAscending={true}
							sortMode={FileListSortMode.Size}
							globalFilterSettingsGetter={filterSettings}
							onClick={sortButtonOnClickCallback}
						/>
					</Column>
					<Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
						<ColumnText text="Date added" semibold/>
						<SortButton
							sortAscending={true}
							sortMode={FileListSortMode.DateAdded}
							globalFilterSettingsGetter={filterSettings}
							onClick={sortButtonOnClickCallback}
						/>
					</Column>
				</div>
				<For each={fileEntries()}>
					{(entryInfo) => (
						<FileExplorerEntry
							fileEntry={entryInfo}
							fileEntryCommunicationMap={fileEntryCommunicationMap}
							userSettings={userSettings}
							contextMenuSettings={contextMenuSettings}
							dragContextTipSettings={dragContextTipSettings}
						/>
					)}
				</For>
				<div class="shrink-0 w-[100%] h-[200px]"></div> {/* Padding at the bottom of the file list */}
			</div>
		</div>
	);
}

type FileExplorerWindowProps = {
	visible: boolean,
	userSettings: UserSettings,
	globalFileEntries: FilesystemEntry[], // Data of all the entries in the user's filesystem
	forceRefreshListFunctions: Function[], // Forces a call to refreshFileList() within the file explorer
	leftFileExplorerElementId: string, // The HTML id for the window
	rightFileExplorerElementId: string
	mainPageCallbacks: FileExplorerMainPageCallbacks,
};

// 'FileExplorerWindow' holds two FileExplorer components
function FileExplorerWindow(props: FileExplorerWindowProps) {
	const { mainPageCallbacks } = props;
	const contextMenuHtmlId = `context-menu-${generateSecureRandomAlphaNumericString(8)}`;
	const fileEntryCommunicationMap: FileEntryCommunicationMap = {};
	const dragContextTipSettings: DragContextTipSettings = {};
	const qrCodePopupSettings: QRCodePopupSettings = {};

	// The context menu component will automatically fill in the setters/getters for the following settings object upon creation
	const contextMenuSettings: ContextMenuSettings = {
		fileEntries: []
	};

	async function fileContextMenuActionCallback(action: string, fileEntries: ContextMenuFileEntry[]) {
		if (fileEntries.length == 0)
			return;
	
		if (action == "shareLinkAsQrCode") {
			// Initiate new popup
			// qrCodePopupSettings.createPopup!("https://duckduckgo.com/?q=afg9ad8fg7ad98fgyh3948tyaiefhgkdfjbgakjyt3p8q756p893746qtdoc8hf6tog8g67");
		} else if (action == "download") {
			const downloadEntries: DownloadFileEntry[] = [];

			fileEntries.forEach((entry) => {
				const realFileSize = getOriginalFileSizeFromEncryptedFileSize(entry.fileEntry.encryptedFileSize);

				downloadEntries.push({
					handle: entry.fileEntry.handle,
					fileName: entry.fileEntry.name,
					encryptedFileSize: entry.fileEntry.size,
					realFileSize: realFileSize
				})
			});

			mainPageCallbacks.downloadFiles(downloadEntries);
		}
	}

	// Split view mode dragging resize functionality
	const [ leftWidth, setLeftWidth ] = createSignal(50);
	const [ rightWidth, setRightWidth ] = createSignal(50);
	const [ dragging, setDragging ] = createSignal(false);
	let startDraggingX = 0;
	let startDraggingLeftWidth = 0;
	
	const handleMouseDown = (event: MouseEvent) => {
		startDraggingX = event.clientX;
		startDraggingLeftWidth = leftWidth();
		setDragging(true);
	}

	const handleMouseUp = () => {
		setDragging(false);
	}

	const handleMouseMove = (event: MouseEvent) => {
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
		setRightWidth(100 - newLeftWidth);
	};

	// Handle global click event
	const handleGlobalClick = (event: MouseEvent) => {
		// Check if mouse clicked outside of context menu
		const menuElement = document.getElementById(contextMenuHtmlId);

		if (!menuElement) {
			console.error(`Couldn't find context menu element with id: ${contextMenuHtmlId}`);
			return;
		}

		const size: Vector2D = { x: menuElement.clientWidth, y: menuElement.clientHeight };
		const pos = contextMenuSettings.getPosition!();

		if (event.clientX < pos.x || event.clientX > pos.x + size.x || event.clientY < pos.y || event.clientY > pos.y + size.y) {
			contextMenuSettings.setVisible!(false);

			// Deselect all entries
			Object.values(fileEntryCommunicationMap).forEach((comm) => {
				comm.setSelected(false);
			})
		}
	}

	// Add event listener
	document.addEventListener("click", handleGlobalClick);	
	document.addEventListener("mousemove", handleMouseMove);
	document.addEventListener("mouseup", handleMouseUp);

	// Cleanup
	onCleanup(() => {
		document.removeEventListener("click", handleGlobalClick);
		document.removeEventListener("mousemove", handleMouseMove);
		document.removeEventListener("mouseup", handleMouseUp);
	});

	return (
		<div
			id="file-explorer-window"
			class={`flex flex-row h-[100%]`}
			style={`${props.visible ? "width: 100%;" : "width: 0;"}`}
		>
			<QRCodePopup settings={qrCodePopupSettings} />
			<DragContextTip settings={dragContextTipSettings} />
			<ContextMenu actionCallback={fileContextMenuActionCallback} htmlId={contextMenuHtmlId} settings={contextMenuSettings} />
			<div class="flex flex-row overflow-y-auto" style={`width: ${splitViewMode() ? leftWidth() : 100}%`}>
				<FileExplorer
					parentWindowProps={props}
					mainPageCallbacks={mainPageCallbacks}
					htmlId={props.leftFileExplorerElementId}
					fileEntryCommunicationMap={fileEntryCommunicationMap}
					contextMenuSettings={contextMenuSettings}
					dragContextTipSettings={dragContextTipSettings}
				/>
			</div>
			<div
				class={`flex flex-row h-[100%]`}
				style={`
					width: ${rightWidth()}%;
					visibility: ${!splitViewMode() && "hidden"};
					${!splitViewMode() && "position: absolute;"}
				`}
			>
				<div class={`bg-zinc-300 w-[3px] h-[100%] hover:cursor-ew-resize`} onMouseDown={handleMouseDown}></div> {/* Draggable separator for the two windows */}
				<div class="flex flex-row overflow-auto w-[100%]" style={`width: 100%`}>
					<FileExplorer
						parentWindowProps={props}
						mainPageCallbacks={mainPageCallbacks}
						htmlId={props.rightFileExplorerElementId}
						fileEntryCommunicationMap={fileEntryCommunicationMap}
						contextMenuSettings={contextMenuSettings}
						dragContextTipSettings={dragContextTipSettings}
					/>
				</div>
			</div>
		</div>
	);
}

export type {
	FileExplorerFilterSettings,
	FilesystemEntry,
	FileExplorerMainPageCallbacks
};

export {
	FileExplorerWindow,
	FileCategory
};
