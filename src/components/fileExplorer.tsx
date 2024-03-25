import { createSignal, For, onCleanup } from "solid-js";
import { getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp, getOriginalFileSizeFromEncryptedFileSize } from "../common/commonUtils";
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";
import { FILESYSTEM_COLUMN_WIDTHS } from "../client/columnWidths";
import { UploadFileEntry, UploadFilesPopup } from "./uploadFilesPopup";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { ContextMenu, ContextMenuEntryMode, ContextMenuFileEntry, ContextMenuSettings, Vector2D } from "./contextMenu";
import { getFileExtensionFromName, getFileIconFromExtension } from "../utility/fileTypes";
import { DragContextTip, DragContextTipSettings } from "./dragContextTip";
import { SortButton, SortButtonOnClickCallbackData } from "./sortButton";
import { QRCodePopup, QRCodePopupSettings } from "./qrCodePopup";
import { DownloadFileEntry } from "../client/transfers";
import { FileCategory, FilesystemEntry, UserFilesystem } from "../client/userFilesystem";

// Icons
import FileFolderIcon from "../assets/icons/svg/files/file-folder.svg?component-solid";
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import SplitLayoutIcon from "../assets/icons/svg/split-layout.svg?component-solid";
import UploadIcon from "../assets/icons/svg/upload.svg?component-solid";
import CONSTANTS from "../common/constants";

// TODO: error popups! + disallow user from uploading a file to a target folder, then deleting that folder while in progress (moving or renaming destination shouldnt matter, as it has a handle)
// TODO: remove all the state crap
// TODO: empty directory message ("theres nothing here..." for example)
// TODO: sort by category, extension or true (changeable from settings menu or some other way)
// idea: different sorting mode nuance settings like name natural sorting vs standard a < b sorting

enum FileListSortMode {
	Name,
	Size,
	Type,
	DateAdded
};

// Stores a list of functions that will communicate with an individual file entry in the file explorer
type FileEntryCommunicationData = {
	setSelected: (state: boolean) => void,
	isSelected: () => boolean,
	getFileEntry: () => FilesystemEntry
};

// Maps file entry html element ids to data which allows for calling functions specific to one file entry in the file explorer list
type FileEntryCommunicationMap = { [htmlId: string]: FileEntryCommunicationData };

type FileExplorerState = {
	communicationMap: FileEntryCommunicationMap,
	hoveredFileEntryHtmlId: string | undefined,
	selectedFileEntryHtmlIds: Set<string>
};

type FileExplorerEntryProps = {
	fileEntry: FilesystemEntry,

	// The state of the parent file explorer
	fileExplorerState: FileExplorerState,

	// Context data
	userSettings: UserSettings,
	contextMenuSettings: ContextMenuSettings,
	dragContextTipSettings: DragContextTipSettings,
};

// Sorting functions for file lists
const localeCompareString = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const sortFilesystemEntryByName = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	if (a.isFolder != b.isFolder) {
		return a.isFolder ? -1 : 1;
	}

	if (a.name == b.name) {
		return b.dateAdded - a.dateAdded;
	} else {
		if (reversed) {
			return localeCompareString(b.name, a.name);
		} else {
			return localeCompareString(a.name, b.name);
		}
	}
}

const sortFilesystemEntryByType = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	const extA = getFileExtensionFromName(a.name);
	const extB = getFileExtensionFromName(b.name);

	if (extA == extB) {
		return localeCompareString(a.name, b.name);
	} else {
		if (reversed) {
			return localeCompareString(extB, extA);
		} else {
			return localeCompareString(extA, extB);
		}
	}
}

const sortFilesystemEntryBySize = (a: FilesystemEntry, b: FilesystemEntry, reversed: boolean) => {
	if (a.size == b.size) {
		return localeCompareString(a.name, b.name);
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
		return localeCompareString(a.name, b.name);
	} else {
		if (reversed) {
			return b.dateAdded - a.dateAdded;
		} else {
			return a.dateAdded - b.dateAdded;
		}
	}
}

const [ splitViewMode, setSplitViewMode ] = createSignal(false);

const EmptyDirectoryMessage = () => {
	return (
		<div class="flex justify-center w-[100%] py-10">
			<h1 class="font-SpaceGrotesk text-zinc-500 text-sm">This directory is empty.</h1>
		</div>
	)
};

// The file entry component
const FileExplorerEntry = (props: FileExplorerEntryProps) => {
	const { fileEntry, fileExplorerState, userSettings, contextMenuSettings, dragContextTipSettings } = props; // TODO: deprecate unused props?
	const [ isSelected, setSelected ] = createSignal(false);

	let sizeText = getFormattedBytesSizeText(fileEntry.size);
	let dateAddedText = getDateAddedTextFromUnixTimestamp(fileEntry.dateAdded, userSettings.useAmericanDateFormat);
	const thisEntryHtmlId = `file-entry-${generateSecureRandomAlphaNumericString(16)}`;

	// Add to communication map
	fileExplorerState.communicationMap[thisEntryHtmlId] = {
		setSelected: (state: boolean) => {
			if (state) {
				fileExplorerState.selectedFileEntryHtmlIds.add(thisEntryHtmlId);
			} else {
				fileExplorerState.selectedFileEntryHtmlIds.delete(thisEntryHtmlId);
			}

			setSelected(state);
		},
		isSelected: () => {
			return isSelected();
		},
		getFileEntry: () => {
			return fileEntry;
		}
	};

	const handleContextMenu = (event: any) => {
		// The context menu is not handled here
		event.preventDefault();
	};

	// Get file extension
	const fileExtension = getFileExtensionFromName(fileEntry.name);

	// Determine type text
	const fileTypeText = (fileEntry.isFolder ? "Folder" : (fileExtension.toUpperCase() + " file"));

	// Hide size text if it's a folder
	if (fileEntry.isFolder) {
		sizeText = "";
	}

	const handleMouseEnter = (event: MouseEvent) => {
		fileExplorerState.hoveredFileEntryHtmlId = thisEntryHtmlId;
	};
	
	const handleMouseLeave = (event: MouseEvent) => {
		fileExplorerState.hoveredFileEntryHtmlId = undefined;
	};

	// Delete communication map entry when the component is destroyed
	onCleanup(() => {
		delete fileExplorerState.communicationMap[thisEntryHtmlId];
	});

	return (
		<div 
			class={`flex flex-row flex-nowrap shrink-0 items-center h-8 border-b-[1px]
							${isSelected() ? "bg-blue-100 active:bg-blue-200" : "bg-zinc-100 hover:bg-zinc-200"}
					 		hover:cursor-pointer`}
			id={thisEntryHtmlId}
			onContextMenu={handleContextMenu}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
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
			<Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
				<ColumnText text={dateAddedText} matchParentWidth/>
			</Column>
			<Column width={FILESYSTEM_COLUMN_WIDTHS.SIZE} noShrink>
				<ColumnText text={sizeText} matchParentWidth/>
			</Column>
		</div>
	);
}

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

enum FileExplorerType {
	Left,
	Right
};

type FileExplorerProps = {
	htmlId: string,
	type: FileExplorerType,
	parentWindowProps: FileExplorerWindowProps,
	contextMenuSettings: ContextMenuSettings,
	dragContextTipSettings: DragContextTipSettings,

	// Callbacks
	mainPageCallbacks: FileExplorerMainPageCallbacks
};

// The actual file explorer component
const FileExplorer = (props: FileExplorerProps) => {
	const { parentWindowProps, contextMenuSettings, dragContextTipSettings, mainPageCallbacks } = props;
	const userSettings: UserSettings = parentWindowProps.userSettings;
	const userFilesystem = parentWindowProps.userFilesystem;
	const fileExplorerId = props.htmlId;
	const fileExplorerTopBarId = `${fileExplorerId}-top-bar`;
	const fileExplorerColumnHeaderBarId = `${fileExplorerId}-column-header`;
	let currentBrowsingDirectoryHandle = CONSTANTS.ROOT_DIRECTORY_HANDLE;

	// This stores all the file entries in the user's current filepath.
	// When setFileEntries() is called, the DOM will update with the new entries.
	const [ fileEntries, setFileEntries ] = createSignal<FilesystemEntry[]>([]);

	const [ filterSettings, setFilterSettings ] = createSignal<FileExplorerFilterSettings>({
		searchText: "",
		sortMode: FileListSortMode.Name,
		sortAscending: true
	});
	
	// Define the state
	const fileExplorerState: FileExplorerState = {
		communicationMap: {},
		hoveredFileEntryHtmlId: undefined,
		selectedFileEntryHtmlIds: new Set<string>(),
	};
	
	// Utility
	const isFileExplorerVisible = () => {
		return props.type == FileExplorerType.Left ? true : splitViewMode();
	};

	const didMouseClickInsideFileExplorerTopBar = (mouseEvent: MouseEvent) => {
		const topBarElement = document.getElementById(fileExplorerTopBarId);

		if (!topBarElement) {
			console.error(`File explorer top bar not found with html id of: ${fileExplorerTopBarId}`);
			return false;
		}

		const clickPos: Vector2D = { x: mouseEvent.clientX, y: mouseEvent.clientY };
		const bounds = topBarElement.getBoundingClientRect();
		
		if (clickPos.x > bounds.left && clickPos.x < bounds.right && clickPos.y > bounds.top && clickPos.y < bounds.bottom) {
			return true;
		} else {
			return false;
		}
	};

	const didMouseClickInsideFileExplorer = (mouseEvent: MouseEvent) => {
		if (!isFileExplorerVisible())
			return;

		const fileExplorerElement = document.getElementById(fileExplorerId);

		if (!fileExplorerElement) {
			console.error(`File explorer not found with html id of: ${fileExplorerId}`);
			return false;
		}

		const clickPos: Vector2D = { x: mouseEvent.clientX, y: mouseEvent.clientY };
		const bounds = fileExplorerElement.getBoundingClientRect();
		
		if (clickPos.x > bounds.left && clickPos.x < bounds.right && clickPos.y > bounds.top && clickPos.y < bounds.bottom) {
			return true;
		} else {
			return false;
		}
	};

	const deselectAllFileEntries = () => {
		Object.values(fileExplorerState.communicationMap).forEach((comm) =>	comm.setSelected(false));
		fileExplorerState.selectedFileEntryHtmlIds.clear();
	};

	// Refreshes the file entries array with the current filter settings
	const refreshFileExplorer = () => {
		// Apply filters
		const { searchText, sortMode, sortAscending } = filterSettings();
		let entries = userFilesystem.getFileEntriesUnderHandlePath(currentBrowsingDirectoryHandle);

		// Filter by search text if applicable
		if (searchText.length > 0) {
			entries = entries.filter(entry => {
				let findIndex = entry.name.toLowerCase().search(searchText.toLowerCase());
				return findIndex != -1;
			});
		}

		// Sort
		if (sortMode == FileListSortMode.Name) {
			entries.sort((a, b) => sortFilesystemEntryByName(a, b, !sortAscending));
		} else if (sortMode == FileListSortMode.Type) {
			entries.sort((a, b) => sortFilesystemEntryByType(a, b, !sortAscending));
		} else if (sortMode == FileListSortMode.Size) {
			entries.sort((a, b) => sortFilesystemEntryBySize(a, b, !sortAscending));
		} else if (sortMode == FileListSortMode.DateAdded) {
			entries.sort((a, b) => sortFilesystemEntryByDateAdded(a, b, !sortAscending));
		} else {
			throw new Error(`Invalid sort mode!`);
		}

		setFileEntries(entries);
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

	// Drag events
	const [ isDragging, setIsDragging ] = createSignal(false);
	let canDrag = false;
	let isMouseDown = false;
	let didMouseDrag = false;
	let pressedFileEntryHtmlId: string = "";
	let multiSelected = false;
	let mouseDownPos: Vector2D = { x: 0, y: 0 };
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
	
	const handleLeftClick = (event: MouseEvent) => {
		if (!didMouseClickInsideFileExplorer(event))
			return;

		const hoveredFileEntryHtmlId = fileExplorerState.hoveredFileEntryHtmlId;
			
		if (hoveredFileEntryHtmlId == undefined)
			return;
		
		const hoveredFileEntryComms = fileExplorerState.communicationMap[hoveredFileEntryHtmlId];

		if (hoveredFileEntryComms == undefined)
			return;

		const hoveredFileEntry = hoveredFileEntryComms.getFileEntry();
		const isHoveredFileEntrySelected = hoveredFileEntryComms.isSelected();
	
		multiSelected = event.shiftKey || event.ctrlKey;
		isMouseDown = true;
		mouseDownPos = { x: event.clientX, y: event.clientY };
		pressedFileEntryHtmlId = hoveredFileEntryHtmlId;

		// Check for double click to open folders
		if (hoveredFileEntry.isFolder && event.detail == 2) {
			currentBrowsingDirectoryHandle = hoveredFileEntry.handle;
			refreshFileExplorer();

			console.log(`Browsed into folder with handle: ${currentBrowsingDirectoryHandle}`);
		}
		
		// Handle selection logic
		if (hoveredFileEntryComms.isSelected()) {
			canDrag = true;
		}
	};

	const handleRightClick = (event: MouseEvent) => {
		if (!didMouseClickInsideFileExplorer(event)) {
			return;
		}

		// If the mouse clicks in the top bar (the bar with the search bar), then make context menu invisible
		if (didMouseClickInsideFileExplorerTopBar(event)) {
			contextMenuSettings.setVisible!(false);
			return;
		}

		// TODO: check if many selected entries, then initialise context menu accordingly

		const screenSize: Vector2D = { x: window.screen.width, y: window.screen.height, };
		const clickPos: Vector2D = { x: event.clientX, y: event.clientY };
		const spawnMenuOffset: Vector2D = { x: 5, y: 5 }; // + 5 on each axis to apply a bit of an offset so the mouse doesn't always overlap with a button in the context menu

		const hoveredFileEntryHtmlId = fileExplorerState.hoveredFileEntryHtmlId;
		const hoveredFileEntryComms = (hoveredFileEntryHtmlId != undefined) ? fileExplorerState.communicationMap[hoveredFileEntryHtmlId] : undefined;
		const shouldOpenFileContextMenu = (hoveredFileEntryHtmlId != undefined) && (hoveredFileEntryComms != undefined);

		// Decide which type of context menu to show
		if (shouldOpenFileContextMenu && hoveredFileEntryComms.isSelected()) {
			// Refresh context menu file entries list
			const entries: ContextMenuFileEntry[] = [];

			fileExplorerState.selectedFileEntryHtmlIds.forEach(id => {
				const comms = fileExplorerState.communicationMap[id];
				const entry = comms.getFileEntry();
				
				entries.push({
					fileEntry: entry
				})
			});

			contextMenuSettings.fileEntries = entries;

			// Update menu context
			contextMenuSettings.clearMenuEntries!();
			
			if (entries.length == 1) {
				const onlyEntry = entries[0].fileEntry;

				if (onlyEntry.category == FileCategory.Image) {
					contextMenuSettings.appendMenuEntry!("viewImage", "View", ContextMenuEntryMode.Bolded);
				} else if (onlyEntry.category == FileCategory.Audio) {
					contextMenuSettings.appendMenuEntry!("playAudio", "Play", ContextMenuEntryMode.Bolded);
				} else if (onlyEntry.category == FileCategory.Video) {
					contextMenuSettings.appendMenuEntry!("playVideo", "Play", ContextMenuEntryMode.Bolded);
				}

				contextMenuSettings.appendMenuEntry!("download", "Download", ContextMenuEntryMode.Bolded);
				contextMenuSettings.appendMenuEntry!("rename", "Rename", ContextMenuEntryMode.Normal);
				contextMenuSettings.appendMenuEntry!("copy", "Copy", ContextMenuEntryMode.Normal);
				contextMenuSettings.appendMenuEntry!("share", "Share", ContextMenuEntryMode.Normal);
			} else {
				contextMenuSettings.appendMenuEntry!("downloadAsZip", "Download as zip", ContextMenuEntryMode.Bolded);
				contextMenuSettings.appendMenuEntry!("copy", "Copy", ContextMenuEntryMode.Normal);
				contextMenuSettings.appendMenuEntry!("share", "Share", ContextMenuEntryMode.Normal);
			}
		} else {
			// Deselect everything because no selected file entry was right clicked
			deselectAllFileEntries();

			// Update menu context
			contextMenuSettings.fileEntries = [];
			contextMenuSettings.clearMenuEntries!();
			contextMenuSettings.appendMenuEntry!("newFolder", "New folder", ContextMenuEntryMode.Normal);
			contextMenuSettings.appendMenuEntry!("paste", "Paste", ContextMenuEntryMode.Disabled);
		}

		// Wrap position
		const menuSize = contextMenuSettings.getSize!();
		const menuPos: Vector2D = { x: clickPos.x + spawnMenuOffset.x, y: clickPos.y + spawnMenuOffset.y };

		if (menuPos.x + menuSize.x > screenSize.x - 5) // Subtract to add some padding
			menuPos.x -= menuSize.x;

		if (menuPos.y + menuSize.y > screenSize.y - 5)
			menuPos.y -= menuSize.y;
		
		// Set position and make visible
		contextMenuSettings.setPosition!({ x: menuPos.x, y: menuPos.y });
		contextMenuSettings.setVisible!(true);
	};

	const handleMouseDown = (event: MouseEvent) => {
		if (event.button == 0) {
			handleLeftClick(event);
		} else if (event.button == 2) {
			handleRightClick(event);
		}
	};
	
	const handleMouseUp = (event: MouseEvent) => {
		if (event.button != 0) {
			return;
		}

		const resetState = () => {
			multiSelected = false;
			didMouseDrag = false;
			canDrag = false;
			isMouseDown = false;
			setIsDragging(false);
			dragContextTipSettings.setVisible!(false);
		}

		const { hoveredFileEntryHtmlId } = fileExplorerState;

		if (!hoveredFileEntryHtmlId) {
			resetState();
			return;
		}

		const hoveredFileEntryComms = fileExplorerState.communicationMap[hoveredFileEntryHtmlId];

		if (!hoveredFileEntryComms) {
			resetState();
			return;
		}

		if (multiSelected) {
			if (hoveredFileEntryHtmlId == pressedFileEntryHtmlId) { // If mouse releases on the same file entry as it pressed, then flip the selection state
				hoveredFileEntryComms.setSelected(!hoveredFileEntryComms.isSelected());
			}
		} else {
			if (!isDragging()) {
				deselectAllFileEntries();
			}

			if (hoveredFileEntryHtmlId == undefined)
				return;

			if (hoveredFileEntryHtmlId == pressedFileEntryHtmlId) {
				hoveredFileEntryComms.setSelected(true);
			}
		}

		resetState();
	};
	
	const handleMouseMove = (event: MouseEvent) => {
		if (!isMouseDown)
			return;

		const mousePos: Vector2D = { x: event.clientX, y: event.clientY };
		const moveOffset: Vector2D = { x: mousePos.x - mouseDownPos.x, y: mousePos.y - mouseDownPos.y };
		currentMousePos = mousePos;

		// Only start dragging when the mouse has moved
		if (moveOffset.x != 0 && moveOffset.y != 0 && isDragging() == false && canDrag) {
			didMouseDrag = true;
			setIsDragging(true);
			runDragLoop();

			// Update the dragging context
			const selectedCount = fileExplorerState.selectedFileEntryHtmlIds.size;

			if (selectedCount > 1) {
				// Determine drag tip text for multiple selections
				let fileCount = 0;
				let folderCount = 0;

				fileExplorerState.selectedFileEntryHtmlIds.forEach(htmlId => {
					const comms = fileExplorerState.communicationMap[htmlId];

					if (comms.getFileEntry().isFolder) {
						folderCount++;
					} else {
						fileCount++;
					}
				});

				const filePartText = `${fileCount} file${fileCount > 1 ? "s" : ""}`;
				const folderPartText = `${folderCount} folder${folderCount > 1 ? "s" : ""}`;

				if (folderCount == 0) {
					dragContextTipSettings.setTipText!(filePartText);
				} else if (fileCount == 0) {
					dragContextTipSettings.setTipText!(folderPartText);
				} else {
					dragContextTipSettings.setTipText!(`${filePartText} and ${folderPartText}`);
				}
			} else if (selectedCount == 1) {
				const comms = fileExplorerState.communicationMap[pressedFileEntryHtmlId];

				if (comms) {
					const onlySelectedFileEntry = comms.getFileEntry();
					dragContextTipSettings.setTipText!(`${onlySelectedFileEntry.name}`);
				}
			}

			dragContextTipSettings.setVisible!(true);
		}
	};

	const handleContextMenu = (event: any) => {
		event.preventDefault();
	};

	document.addEventListener("mousemove", handleMouseMove);
	document.addEventListener("mousedown", handleMouseDown);
	document.addEventListener("mouseup", handleMouseUp);

	onCleanup(() => {
		document.removeEventListener("mousemove", handleMouseMove);
		document.removeEventListener("mousedown", handleMouseDown);
		document.removeEventListener("mouseup", handleMouseUp);
	});

	return (
		<div
			class="relative flex flex-col w-[100%] h-[100%] min-w-[550px] overflow-x-hidden"
			id={fileExplorerId}
			style={`${uploadWindowVisible() && "overflow: hidden !important;"}`}
			onContextMenu={handleContextMenu}
		>
			<UploadFilesPopup
				isVisibleGetter={uploadWindowVisible}
				uploadCallback={uploadPopupUploadCallback}
				closeCallback={() => setUploadWindowVisible(false)}
			/>
			<div class="flex flex-row px-2 items-center flex-shrink-0 w-[100%] bg-zinc-200" id={fileExplorerTopBarId}> {/* Top bar */}
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
				<div
					// Column headers bar
					class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"
					id={fileExplorerColumnHeaderBarId}
				>
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
					<Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
						<ColumnText text="Date added" semibold/>
						<SortButton
							sortAscending={true}
							sortMode={FileListSortMode.DateAdded}
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
				</div>
				<For each={fileEntries()}>
					{(entryInfo) => (
						<FileExplorerEntry
							fileEntry={entryInfo}
							fileExplorerState={fileExplorerState}
							userSettings={userSettings}
							contextMenuSettings={contextMenuSettings}
							dragContextTipSettings={dragContextTipSettings}
						/>
					)}
				</For>
				{fileEntries().length == 0 && <EmptyDirectoryMessage/>}
				<div class="shrink-0 w-[100%] h-[200px]"></div> {/* Padding at the bottom of the file list */}
			</div>
		</div>
	);
}

type FileExplorerWindowProps = {
	visible: boolean,
	userSettings: UserSettings,
	userFilesystem: UserFilesystem,
	forceRefreshListFunctions: Function[], // Forces a call to refreshFileList() within the file explorer
	leftFileExplorerElementId: string, // The HTML id for the window
	rightFileExplorerElementId: string
	mainPageCallbacks: FileExplorerMainPageCallbacks,
};

// 'FileExplorerWindow' holds two FileExplorer components
function FileExplorerWindow(props: FileExplorerWindowProps) {
	const { mainPageCallbacks, userFilesystem } = props;
	const contextMenuHtmlId = `context-menu-${generateSecureRandomAlphaNumericString(8)}`;
	//const fileEntryCommunicationMap: FileEntryCommunicationMap = {};
	const dragContextTipSettings: DragContextTipSettings = {};
	const qrCodePopupSettings: QRCodePopupSettings = {};

	// The context menu component will automatically fill in the setters/getters for the following settings object upon creation
	const contextMenuSettings: ContextMenuSettings = {
		fileEntries: []
	};

	async function contextMenuActionCallback(action: string) {
		const fileEntries = contextMenuSettings.fileEntries;

		if (action == "newFolder") {
			// TODO: needs to spawn new folder on the current browsing directory (context menu settings needs to get current context directory handle)
			console.log("Creating new folder...");

			try {
				await userFilesystem.createNewFolderGlobally("New folder", CONSTANTS.ROOT_DIRECTORY_HANDLE);
				props.forceRefreshListFunctions.forEach(func => func()); // Refresh both file explorers
				console.log("Created new folder!");
			} catch (error) {
				console.error(`Failed to create new folder. Error: ${error}`);
			}
		} else if (action == "shareLinkAsQrCode") {
			// Initiate new popup
			// qrCodePopupSettings.createPopup!("https://duckduckgo.com/?q=afg9ad8fg7ad98fgyh3948tyaiefhgkdfjbgakjyt3p8q756p893746qtdoc8hf6tog8g67");
		} else if (action == "download") {
			if (fileEntries.length == 0)
				return;
			
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
		} else if (action == "downloadAsZip") {
			if (fileEntries.length == 0)
				return;
			
			// TODO: folder support, maybe by reducing a folder to a list of files in the fileEntries array? maybe not

			// Calculate total download size
			let totalDownloadSize = 0;
			fileEntries.forEach(e => totalDownloadSize += e.fileEntry.size);

			console.log(`total download size: ${totalDownloadSize}`);
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

			// TODO: only check if selected outside the file explorer window, not the context menu

			/*
			// Deselect all entries
			Object.values(fileEntryCommunicationMap).forEach((comm) => {
				comm.setSelected(false);
			})
			*/
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
			<ContextMenu actionCallback={contextMenuActionCallback} htmlId={contextMenuHtmlId} settings={contextMenuSettings} />
			<div class="flex flex-row overflow-y-auto" style={`width: ${splitViewMode() ? leftWidth() : 100}%`}>
				<FileExplorer
					parentWindowProps={props}
					type={FileExplorerType.Left}
					mainPageCallbacks={mainPageCallbacks}
					htmlId={props.leftFileExplorerElementId}
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
						type={FileExplorerType.Right}
						mainPageCallbacks={mainPageCallbacks}
						htmlId={props.rightFileExplorerElementId}
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
