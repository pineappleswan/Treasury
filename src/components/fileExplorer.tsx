import { createSignal, For, onCleanup } from "solid-js";
import { getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp, getEncryptedFileSizeAndChunkCount } from "../common/common";
import { FILESYSTEM_COLUMN_WIDTHS } from "../client/enumsAndTypes";
import { UploadFileEntry, UploadFilesPopup } from "./uploadFilesPopup";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { ContextMenu, ContextMenuSettings, Vector2D } from "./contextMenu";
import { showSaveFilePicker } from "native-file-system-adapter";
import { getFileExtensionFromName, getFileIconFromExtension } from "../utility/fileTypes";
import { decryptEncryptedFileCryptKey, getMasterKeyAsUint8ArrayFromLocalStorage } from "../common/clientCrypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";
import { DragContextTip, DragContextTipSettings } from "./dragContextTip";

// Icons
import FileFolderIcon from "../assets/icons/svg/files/file-folder.svg?component-solid";
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import SplitLayoutIcon from "../assets/icons/svg/split-layout.svg?component-solid";
import RightAngleArrowIcon from "../assets/icons/svg/right-angle-arrow.svg?component-solid";
import UploadIcon from "../assets/icons/svg/upload.svg?component-solid";

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
	category: FileCategory,
	dateAdded: number,
	fileCryptKey: Uint8Array, // For decrypting the file
	isFolder: boolean
};

type FileExplorerWindowProps = {
	userSettings: UserSettings,
	globalFileEntries: FilesystemEntry[],
	visible: boolean,
	uploadFilesCallback: Function,
	forceRefreshListFunctions: Function[], // Forces a call to refreshFileList() within the file explorer
	leftFileExplorerElementId: string, // The HTML id for the window
	rightFileExplorerElementId: string
};

type FileExplorerProps = {
	parentWindowProps: FileExplorerWindowProps,
	uploadFilesCallback: Function,
	htmlId: string
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

// Stores a list of functions that will communicate with an individual file entry in the file explorer
type FileEntryCommunicationData = {
	setSelected: (state: boolean) => void
};

type FileEntryCommunicationMap = { [key: string]: FileEntryCommunicationData };

type FileExplorerEntryProps = {
	fileEntry: FilesystemEntry,

	// Maps file entry html element ids to data which allows for calling functions specific to one file entry in the file explorer list
	communicationMap: FileEntryCommunicationMap,

	// Context data
	userSettings: UserSettings,
	contextMenuSettings: ContextMenuSettings,
	dragContextTipSettings: DragContextTipSettings,
};

// The file entry component
const FileExplorerEntry = (props: FileExplorerEntryProps) => {
	const { fileEntry, communicationMap, userSettings, contextMenuSettings, dragContextTipSettings } = props;
	const [ isSelected, setSelected ] = createSignal(false);

	let sizeText = getFormattedBytesSizeText(fileEntry.size);
	let dateAddedText = getDateAddedTextFromUnixTimestamp(fileEntry.dateAdded, userSettings.useAmericanDateFormat);
	const thisElementId = `file-entry-${generateSecureRandomAlphaNumericString(16)}`;

	// Add to communication map
	communicationMap[thisElementId] = {
		setSelected: (state: boolean) => {
			setSelected(state);
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

		contextMenuSettings.setPosition!({ x: clickPos.x - offsetLeft, y: clickPos.y + scrollOffset });

		// Update menu context
		const sizeAndChunkCountInfo = getEncryptedFileSizeAndChunkCount(fileEntry.size);

		contextMenuSettings.fileHandle = fileEntry.handle;
		contextMenuSettings.fileName = fileEntry.name;
		contextMenuSettings.fileChunkCount = sizeAndChunkCountInfo.chunkCount;
		contextMenuSettings.fileEntryHtmlId = thisElementId;
		contextMenuSettings.setVisible!(true);

		// Set to selected
		communicationMap[thisElementId].setSelected(true);
	};

	// On disable callback
	contextMenuSettings.onDisableCallbacks[thisElementId] = () => {
		communicationMap[thisElementId].setSelected(false); // Deselect
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

		const thisElement = document.getElementById(thisElementId)!;
		const scrollingFrameElement = thisElement.parentElement!.parentElement!;
		const scrollOffset = scrollingFrameElement.scrollTop;
		const offsetTop = scrollingFrameElement.offsetTop;
		const offsetLeft = scrollingFrameElement.offsetLeft;

		dragContextTipSettings.setPosition!({
			x: currentMousePos.x - offsetLeft,
			y: currentMousePos.y + scrollOffset - offsetTop
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

		delete communicationMap[thisElementId];
		delete contextMenuSettings.onDisableCallbacks[thisElementId];
	});

	return (
		<div 
			class={`flex flex-row flex-nowrap items-center h-8 border-b-[1px]
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

// The actual file explorer component
const FileExplorer = (props: FileExplorerProps) => {
	const { parentWindowProps, uploadFilesCallback } = props;
	const userSettings: UserSettings = parentWindowProps.userSettings;
	const fileExplorerId = props.htmlId;

	const entriesCommunicationMap: FileEntryCommunicationMap = {};

	// This stores all the file entries in the user's current filepath.
	// When setFileEntries() is called, the DOM will update with the new entries.
	const [ fileEntries, setFileEntries ] = createSignal<FilesystemEntry[]>([]);

	let [ sortMode, setSortMode ] = createSignal<FileListSortMode>(FileListSortMode.Name);
	let [ sortAscending, setSortAscending ] = createSignal<boolean>(true);
	let searchText: string = "";

	// Drag context tip
	const dragContextTipSettings: DragContextTipSettings = {};

	// The context menu component will automatically fill in the functions for the following settings object upon creation
	const contextMenuSettings: ContextMenuSettings = {
		onDisableCallbacks: {}
	};

	async function contextMenuActionCallback(action: string) {
		const fileHandle = contextMenuSettings.fileHandle;
		const fileName = contextMenuSettings.fileName;
		const fileChunkCount = contextMenuSettings.fileChunkCount;

		if (!fileHandle)
			return;

		if (action == "download") {
			console.log(`Downloading handle: ${fileHandle}`);

			const response = await fetch("/api/transfer/startdownload", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					handle: fileHandle
				})
			});

			if (!response.ok) {
				console.error(`Server responded with ${response.status} when starting download!`);
			} else {
				const encryptedFileCryptKey = await response.arrayBuffer();

				// TODO: THIS IS A TEST BELOW
				// Open output
				const outputHandle = await showSaveFilePicker({
					suggestedName: fileName
				});

				const writableStream = await outputHandle.createWritable();

				// Download chunks
				for (let i = 0; i < fileChunkCount!; i++) {
					const response = await fetch("/api/transfer/downloadchunk", {
						method: "POST",
						headers: {
							"Content-Type": "application/json"
						},
						body: JSON.stringify({
							handle: fileHandle,
							chunkId: i
						})
					});
		
					const buffer = await response.arrayBuffer();
		
					// Extract nonce
					const nonce = new Uint8Array(buffer.slice(0, 24));
					const cipherText = new Uint8Array(buffer.slice(24, buffer.byteLength));
		
					// Decrypt
					try {
						const masterKey = getMasterKeyAsUint8ArrayFromLocalStorage();
		
						const encFileCryptKeyArray = new Uint8Array(encryptedFileCryptKey);
						const fileCryptKey = decryptEncryptedFileCryptKey(encFileCryptKeyArray, masterKey!);
		
						const chacha = xchacha20poly1305(fileCryptKey, nonce);
						const plainText = chacha.decrypt(cipherText);
		
						console.log(`plainText len: ${plainText.byteLength}`);
						await writableStream.write(plainText);
					} catch (error) {
						console.error(error);
					}
				}

				await writableStream.close();
				
				// Tell server download is done
				const finishResponse = await fetch("/api/transfer/enddownload", {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify({
						handle: fileHandle
					})
				});

				if (finishResponse.ok) {
					console.log(`download finished successfully`);
				} else {
					console.log(`download failed to end! status: ${finishResponse.status}`);
				}
			}
		}
	}
	
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

	// Add refreshFileList function to parent window props so that external calls can be made
	parentWindowProps.forceRefreshListFunctions.push(refreshFileList);

	// Handle upload window drag events
	const [ uploadWindowVisible, setUploadWindowVisible ] = createSignal(false);

	return (
		<div
			class="relative flex flex-col w-[100%] h-[100%] min-w-[550px] overflow-x-hidden"
			id={fileExplorerId}
			style={`${uploadWindowVisible() && "overflow: hidden !important;"}`}
		>
			<DragContextTip settings={dragContextTipSettings} />
			<ContextMenu actionCallback={contextMenuActionCallback} settings={contextMenuSettings} />
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
					{(entryInfo) => (
						<FileExplorerEntry
							fileEntry={entryInfo}
							communicationMap={entriesCommunicationMap}
							userSettings={userSettings}
							contextMenuSettings={contextMenuSettings}
							dragContextTipSettings={dragContextTipSettings}
						/>
					)}
				</For>
			</div>
		</div>
	);
}

// 'FileExplorerWindow' holds two FileExplorer components
function FileExplorerWindow(props: FileExplorerWindowProps) {
	const { userSettings, globalFileEntries, uploadFilesCallback } = props;

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

	document.addEventListener("mousemove", handleMouseMove);
	document.addEventListener("mouseup", handleMouseUp);

	let jsx = (
		<div
			id="file-explorer-window"
			class={`flex flex-row h-[100%]`}
			style={`${props.visible ? "width: 100%;" : "width: 0;"}`}
		>
			<div class="flex flex-row overflow-y-auto" style={`width: ${splitViewMode() ? leftWidth() : 100}%`}>
				<FileExplorer parentWindowProps={props} uploadFilesCallback={uploadFilesCallback} htmlId={props.leftFileExplorerElementId} />
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
					<FileExplorer parentWindowProps={props} uploadFilesCallback={uploadFilesCallback} htmlId={props.rightFileExplorerElementId} />
				</div>
			</div>
		</div>
	);

	return jsx;
}

export type { FilesystemEntry };

export {
	FileExplorerWindow,
	FileCategory
};
