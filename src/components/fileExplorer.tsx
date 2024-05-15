import { Accessor, createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import { FILESYSTEM_COLUMN_WIDTHS } from "../client/columnWidths";
import { UploadFileEntry, UploadFilesPopup, UploadFilesPopupContext } from "./uploadFilesPopup";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { ContextMenu, ContextMenuWidgetMode, ContextMenuContext, Vector2D } from "./contextMenu";
import { deduplicateFileEntryName } from "../utility/fileNames";
import { DragContextTip, DragContextTipContext } from "./dragContextTip";
import { SortButton, SortButtonOnClickCallbackData } from "./sortButton";
import { QRCodePopup, QRCodePopupContext } from "./qrCodePopup";
import { FileCategory, FilesystemEntry, UserFilesystem } from "../client/userFilesystem";
import { MediaViewerPopup, MediaViewerPopupContext } from "./mediaViewerPopup";
import { PathRibbon, PathRibbonContext } from "./pathRibbon";
import { ThumbnailManager, Thumbnail } from "../client/thumbnails";
import { sortFilesystemEntryByDateAdded, sortFilesystemEntryByName, sortFilesystemEntryBySize, sortFilesystemEntryByType } from "../utility/sorting";
import { NavToolbar, NavToolbarContext, NavToolbarNavigateCallback } from "./navToolbar";
import { RenamePopup, RenamePopupContext } from "./renamePopup";
import { WindowType } from "../client/clientEnumsAndTypes";
import { UploadSettings } from "../client/transfers";
import { FileExplorerEntry } from "./fileExplorerEntry";
import { createVirtualizer, Virtualizer } from "@tanstack/solid-virtual";
import CONSTANTS from "../common/constants";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import UploadIcon from "../assets/icons/svg/upload.svg?component-solid";

enum FileListSortMode {
	Name,
	Size,
	Type,
	DateAdded
};

// Stores a list of functions that will communicate with an individual file entry in the file explorer
type FileEntryCommunicationData = {
	isSelected: boolean;
	setThumbnail?: (thumbnail: Thumbnail) => void;
	getFileEntry?: () => FilesystemEntry;

	// This function forces the file entry to react to a change in state such as when 'isSelected' changes.
	// WARNING: It may or may not be available so use optional chaining when calling it!
	react?: () => void;
};

type FileExplorerState = {
	// Maps file entry handles to data which allows for calling functions specific to one file entry in the file explorer list
	communicationMap: Map<string, FileEntryCommunicationData>;
	selectedFileEntries: Set<FilesystemEntry>;
	hoveredFileEntry: FilesystemEntry | null;
	lastTouchedFileEntry: FilesystemEntry | null;
};

type FileExplorerFilterSettings = {
	searchText: string;
	sortMode: FileListSortMode;
	sortAscending: boolean;
};

// The callbacks used to communicate with the main treasury page (TODO: move to treasury.tsx???)
type FileExplorerMainPageCallbacks = {
	uploadFiles: (entries: UploadFileEntry[]) => void;
	downloadFiles: (entries: FilesystemEntry[]) => void;
	downloadFilesAsZip: (entries: FilesystemEntry[]) => void;
};

type FileExplorerContext = {
	// Called externally to refresh the file list
	refreshFileExplorer?: () => void;
}

type FileExplorerWindowProps = {
	visible: boolean;
	userFilesystem: UserFilesystem;
	mainPageCallbacks: FileExplorerMainPageCallbacks;
	context: FileExplorerContext;
	leftSideNavBar?: HTMLDivElement;
	userSettings: Accessor<UserSettings>;
	uploadSettings: Accessor<UploadSettings>;
	currentWindowType: Accessor<WindowType>;
};

function FileExplorerWindow(props: FileExplorerWindowProps) {
	// Process props
	const {
		mainPageCallbacks,
		userFilesystem,
		leftSideNavBar,
		userSettings,
		uploadSettings,
		currentWindowType
	} = props;

	let fileExplorerDivRef: HTMLDivElement | undefined;
	let fileExplorerTopBarDivRef: HTMLDivElement | undefined;
	let fileExplorerColumnHeaderDivRef: HTMLDivElement | undefined;

	// Initialise the thumbnail manager
	const thumbnailManager = new ThumbnailManager();

	// Used for showing the accessibility outline
	const [ searchBarFocused, setSearchBarFocused ] = createSignal(false);
	
	// All the file entries of the current browsing directory
	const [ fileEntries, setFileEntries ] = createSignal<FilesystemEntry[]>([]);

	const [ filterSettings, setFilterSettings ] = createSignal<FileExplorerFilterSettings>({
		searchText: "",
		sortMode: FileListSortMode.Name,
		sortAscending: true
	});

	let currentBrowsingDirectoryHandle = CONSTANTS.ROOT_DIRECTORY_HANDLE;
	
	// Define the state
	const fileExplorerState: FileExplorerState = {
		communicationMap: new Map<string, FileEntryCommunicationData>,
		hoveredFileEntry: null,
		lastTouchedFileEntry: null,
		selectedFileEntries: new Set<FilesystemEntry>()
	};

	// Store contexts for some components
	const dragContextTipContext: DragContextTipContext = {};
	const qrCodePopupContext: QRCodePopupContext = {};
	const contextMenuContext: ContextMenuContext = {
		fileEntries: []
	};

	// Utility
	const updateContextMenuWidgets = (contextMenuContext: ContextMenuContext) => {
		const entries = contextMenuContext.fileEntries;

		// Clear entries
		contextMenuContext.clearMenuWidgets!();

		if (entries.length == 0) {
			contextMenuContext.appendMenuWidget!("newFolder", "New folder", "", ContextMenuWidgetMode.Normal);
			contextMenuContext.appendMenuWidget!("paste", "Paste", "Ctrl+V", ContextMenuWidgetMode.Disabled);
		} else if (entries.length == 1) {
			const entry = entries[0];

			if (mediaViewerPopupContext.canOpenFile!(entry)) {
				if (entry.category == FileCategory.Image) {
					contextMenuContext.appendMenuWidget!("viewImage", "View", "", ContextMenuWidgetMode.Bolded);
				} else if (entry.category == FileCategory.Audio) {
					contextMenuContext.appendMenuWidget!("playAudio", "Play", "", ContextMenuWidgetMode.Bolded);
				} else if (entry.category == FileCategory.Video) {
					contextMenuContext.appendMenuWidget!("playVideo", "Play", "", ContextMenuWidgetMode.Bolded);
				}
			}

			if (entry.isFolder) {
				contextMenuContext.appendMenuWidget!("openFolder", "Open folder", "", ContextMenuWidgetMode.Bolded);
			}

			contextMenuContext.appendMenuWidget!("download", "Download", "", ContextMenuWidgetMode.Bolded);
			contextMenuContext.appendMenuWidget!("rename", "Rename", "F2", ContextMenuWidgetMode.Normal);
			contextMenuContext.appendMenuWidget!("cut", "Cut", "Ctrl+X", ContextMenuWidgetMode.Normal);
			contextMenuContext.appendMenuWidget!("share", "Share", "", ContextMenuWidgetMode.Normal);
		} else {
			contextMenuContext.appendMenuWidget!("downloadAsZip", "Download as zip", "", ContextMenuWidgetMode.Bolded);
			contextMenuContext.appendMenuWidget!("rename", "Rename", "F2", ContextMenuWidgetMode.Normal);
			contextMenuContext.appendMenuWidget!("cut", "Cut", "Ctrl+X", ContextMenuWidgetMode.Normal);
			contextMenuContext.appendMenuWidget!("share", "Share", "", ContextMenuWidgetMode.Normal);
		}
	}

	// Path ribbon
	const pathRibbonContext: PathRibbonContext = {};
	
	const pathRibbonSetPathCallback = (newDirectoryHandle: string) => {
		if (newDirectoryHandle != currentBrowsingDirectoryHandle) { // Prevent redundant uploads
			openDirectory(newDirectoryHandle);
		}
	};

	// Handle upload window events
	const [ uploadWindowVisible, setUploadWindowVisible ] = createSignal(false);

	const uploadPopupUploadCallback = (files: UploadFileEntry[]) => {
		setUploadWindowVisible(false);
		mainPageCallbacks.uploadFiles(files);
	}
	
	// The function used to select or deselect a file entry
	const setFileEntrySelected = (fileEntry: FilesystemEntry, selected: boolean) => {
		const comms = fileExplorerState.communicationMap.get(fileEntry.handle);

		if (comms == undefined) {
			console.error("Tried to set file entry selection but the communication data wasn't found!");
			return;
		}
		
		if (selected) {
			fileExplorerState.selectedFileEntries.add(fileEntry);
		} else {
			fileExplorerState.selectedFileEntries.delete(fileEntry);
		}

		comms.isSelected = selected;
		comms.react?.();
	};

	const deselectAllFileEntries = () => {
		fileExplorerState.selectedFileEntries.forEach(entry => setFileEntrySelected(entry, false));
	};

	// Used in the UI to display an empty directory message or a loading message
	const [ isLoading, setIsLoading ] = createSignal(true);

	// The virtualiser for virtual scrolling
	const [ fileEntryVirtualiser, setFileEntryVirtualiser ] = createSignal<Virtualizer<any, any> | undefined>();
	
	// Refreshes the file entries array with the current filter settings
	const refreshFileExplorer = () => {
		// Apply filters
		const { searchText, sortMode, sortAscending } = filterSettings();
		let entries = userFilesystem.getFileEntriesUnderHandle(currentBrowsingDirectoryHandle);

		// Filter by search text if applicable
		if (searchText.length > 0) {
			entries = entries.filter(entry => {
				let findIndex = entry.name.toLowerCase().search(searchText.toLowerCase());
				return findIndex != -1;
			});
		}

		// Sort
		switch (sortMode) {
			case FileListSortMode.Name: entries.sort((a, b) => sortFilesystemEntryByName(a, b, !sortAscending)); break;
			case FileListSortMode.Type: entries.sort((a, b) => sortFilesystemEntryByType(a, b, !sortAscending)); break;
			case FileListSortMode.Size: entries.sort((a, b) => sortFilesystemEntryBySize(a, b, !sortAscending)); break;
			case FileListSortMode.DateAdded: entries.sort((a, b) => sortFilesystemEntryByDateAdded(a, b, !sortAscending)); break;
		}

		// Reset file explorer state
		fileExplorerState.communicationMap.clear();
		fileExplorerState.selectedFileEntries.clear();
		fileExplorerState.hoveredFileEntry = null;
		fileExplorerState.lastTouchedFileEntry = null;

		// Fill communication map data
		entries.forEach(entry => {
			fileExplorerState.communicationMap.set(entry.handle, {
				isSelected: false
			});
		});

		// Set the file entries
		setFileEntries(entries);
	};

	// Set callback
	props.context.refreshFileExplorer = refreshFileExplorer;

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
	}

	const openDirectory = (directoryHandle: string) => {
		// TODO: if user navigates while loading (via nav toolbar or path ribbon), then cancel request to prevent conflicts
		
		currentBrowsingDirectoryHandle = directoryHandle;
		lastSelectedFileEntryHandle = "";
		navToolbarContext.update!(directoryHandle);
		pathRibbonContext.setPath!(directoryHandle);
		
		// If there are children in the directory node then it means it has already been synced
		const directoryNode = userFilesystem.findNodeFromHandle(userFilesystem.getRootNode(), directoryHandle);
		
		if (directoryNode !== null && directoryNode.children.length > 0) {
			refreshFileExplorer();
			return;
		}

		setIsLoading(true);
		setFileEntries([]);
		
		// Sync from the server
		userFilesystem.syncFiles(directoryHandle)
		.then(() => {
			refreshFileExplorer();
		})
		.catch((error) => {
			console.error(error);
		})
		.finally(() => {
			setIsLoading(false);
		});
	}

	// Handle dragging (TODO: type for dragging context)
	const [ isDragging, setIsDragging ] = createSignal(false);
	let canDrag = false;
	let isMouseDown = false;
	let didMouseDrag = false;
	let lastSelectedFileEntryHandle: string = "";
	let pressedFileEntryHandle: string = "";
	let multiSelected = false;
	let mouseDownPos: Vector2D = { x: 0, y: 0 };
	let currentMousePos: Vector2D = { x: 0, y: 0 };

	// Variables for opening the upload popup when files are dragged over the file explorer
	let dragEnterEventCounter = 0;
	let openedUploadPopupWithDrag = false;

	const runDragLoop = () => {
		if (!isDragging())
			return;

		// Prevents obstruction from the mouse
		let dragOffset = 20;
		const bottomWrapPadding = 20;

		const targetPos: Vector2D = {
			x: currentMousePos.x - leftSideNavBar!.clientWidth,
			y: currentMousePos.y
		};

		const elementSize = dragContextTipContext.getSize!();
		const windowInnerSize = { x: window.innerWidth, y: window.innerHeight };

		// Wrap position
		if (targetPos.x > windowInnerSize.x - elementSize.x - dragOffset) {
			targetPos.x -= elementSize.x;
			dragOffset = -dragOffset;
		}

		if (targetPos.y > windowInnerSize.y - elementSize.y - bottomWrapPadding) {
			targetPos.y -= elementSize.y;
		}

		dragContextTipContext.setPosition!({
			x: targetPos.x + dragOffset,
			y: targetPos.y
		});

		requestAnimationFrame(runDragLoop);
	}
	
	// Mouse events/functions
	const allowHandleInputOnPage = () => {
		return !mediaViewerPopupContext.isOpen!() && !renamePopupContext.isOpen!() && !uploadFilesPopupContext.isOpen!();
	}

	const handleLeftClick = (event: MouseEvent) => {
		if (!didMouseClickInsideFileExplorer(event.clientX, event.clientY))
			return;

		const { hoveredFileEntry } = fileExplorerState;

		if (hoveredFileEntry == null)
			return;

		const hoveredFileEntryComms = fileExplorerState.communicationMap.get(hoveredFileEntry.handle);
		
		if (hoveredFileEntryComms == undefined)
			return;

		multiSelected = event.ctrlKey;
		isMouseDown = true;
		mouseDownPos = { x: event.clientX, y: event.clientY };
		pressedFileEntryHandle = hoveredFileEntry.handle;

		// Handle double clicks
		if (event.detail == 2) {
			if (hoveredFileEntry.isFolder) {
				// Clear hovered file entry because we just opened this folder (MUST BE DONE! or else the stupid folder path ribbon and escape bug comes back) TODO: explain this better by recreating the problem
				fileExplorerState.hoveredFileEntry = null;

				// Open folders
				openDirectory(hoveredFileEntry.handle);
			} else if (mediaViewerPopupContext.canOpenFile!(hoveredFileEntry)) {
				// Open images/videos in the media viewer
				mediaViewerPopupContext.showPopup!();
				mediaViewerPopupContext.openFile!(hoveredFileEntry);
				deselectAllFileEntries();
			}
		}
		
		// Handle selection logic
		if (hoveredFileEntryComms.isSelected) {
			canDrag = true;
		}
	};

	const handleRightClick = (event: MouseEvent) => {
		if (!allowHandleInputOnPage())
			return;

		if (!didMouseClickInsideFileExplorer(event.clientX, event.clientY)) {
			return;
		}

		// If the mouse clicks in the top bar (the bar with the search bar), then make context menu invisible
		if (didMouseClickInsideFileExplorerTopBar(event.clientX, event.clientY)) {
			contextMenuContext.hide!();
			return;
		}

		const screenSize: Vector2D = { x: window.screen.width, y: window.screen.height, };
		const clickPos: Vector2D = { x: event.clientX, y: event.clientY };
		const spawnMenuOffset: Vector2D = { x: 5, y: 5 }; // + 5 on each axis to apply a bit of an offset so the mouse doesn't always overlap with a button in the context menu

		// Subtract offset due to size of left side navigation menu
		spawnMenuOffset.x -= leftSideNavBar!.clientWidth;

		const hoveredFileEntry = fileExplorerState.hoveredFileEntry;
		const hoveredFileEntryComms = (hoveredFileEntry !== null) ? fileExplorerState.communicationMap.get(hoveredFileEntry.handle) : undefined;
		const shouldOpenFileContextMenu = (hoveredFileEntry !== null) && (hoveredFileEntryComms != undefined);

		// Decide which type of context menu to show
		if (shouldOpenFileContextMenu && hoveredFileEntryComms.isSelected) {
			// Refresh context menu file entries list
			const entries: FilesystemEntry[] = [];

			fileExplorerState.selectedFileEntries.forEach(selectedEntry => {
				const comms = fileExplorerState.communicationMap.get(selectedEntry.handle)!;
				const entry = comms.getFileEntry!();
				entries.push(entry);
			});

			contextMenuContext.fileEntries = entries;
			updateContextMenuWidgets(contextMenuContext);
		} else {
			// Deselect everything because no selected file entry was right clicked
			deselectAllFileEntries();

			// Update menu context
			contextMenuContext.fileEntries = [];
			updateContextMenuWidgets(contextMenuContext);
		}

		// Wrap position
		const menuSize = contextMenuContext.getSize!();
		const menuPos: Vector2D = { x: clickPos.x + spawnMenuOffset.x, y: clickPos.y + spawnMenuOffset.y };

		if (menuPos.x + menuSize.x > screenSize.x - 5) // Subtract to add some padding
			menuPos.x -= menuSize.x;

		if (menuPos.y + menuSize.y > screenSize.y - 5)
			menuPos.y -= menuSize.y;
		
		// Set position and make visible
		contextMenuContext.setPosition!({ x: menuPos.x, y: menuPos.y });
		contextMenuContext.show!(currentBrowsingDirectoryHandle);
	};

	const handleMouseDown = (event: MouseEvent) => {
		if (!allowHandleInputOnPage())
			return;

		if (event.button == 0) {
			handleLeftClick(event);
		} else if (event.button == 2) {
			handleRightClick(event);
		}
	}
	
	const handleMouseUp = (event: MouseEvent) => {
		dragEnterEventCounter = 0;
		openedUploadPopupWithDrag = false;

		if (!allowHandleInputOnPage())
			return;

		// Left mouse button up
		if (event.button == 0) {
			const resetState = () => {
				multiSelected = false;
				didMouseDrag = false;
				canDrag = false;
				isMouseDown = false;
				setIsDragging(false);
				dragContextTipContext.setVisible!(false);
			}

			const { hoveredFileEntry } = fileExplorerState;

			if (hoveredFileEntry == null) {
				deselectAllFileEntries();
				resetState();
				return;
			}

			const hoveredFileEntryComms = fileExplorerState.communicationMap.get(hoveredFileEntry.handle);

			if (!hoveredFileEntryComms) {
				resetState();
				return;
			}

			if (multiSelected) {
				// If mouse releases on the same file entry as it pressed, then flip the selection state
				if (hoveredFileEntry.handle == pressedFileEntryHandle) {
					setFileEntrySelected(hoveredFileEntry, !hoveredFileEntryComms.isSelected);

					if (hoveredFileEntryComms.isSelected) {
						lastSelectedFileEntryHandle = pressedFileEntryHandle;
					}
				}
			} else {
				if (!isDragging()) {
					deselectAllFileEntries();
				}

				if (hoveredFileEntry.handle == pressedFileEntryHandle) {
					// Handle shift selecting
					if (event.shiftKey) {
						// Ensure the last selected file entry is under the current browsing directory and is also selected 
						const lastSelectedFileEntry = userFilesystem.getFileEntryFromHandle(lastSelectedFileEntryHandle);
						const lastSelectedFileEntryComms = fileExplorerState.communicationMap.get(lastSelectedFileEntryHandle);

						if (lastSelectedFileEntry && lastSelectedFileEntryComms) {
							if (lastSelectedFileEntry.parentHandle == currentBrowsingDirectoryHandle) {
								const lastSelectedPos = fileEntries().findIndex(entry => entry.handle == lastSelectedFileEntryHandle);
								const newSelectedPos = fileEntries().findIndex(entry => entry.handle == pressedFileEntryHandle);

								const minIndex = Math.min(lastSelectedPos, newSelectedPos);
								const maxIndex = Math.max(lastSelectedPos, newSelectedPos);

								if (lastSelectedPos != undefined && newSelectedPos != undefined) {
									fileEntries().forEach((entry, index) => {
										const comms = fileExplorerState.communicationMap.get(entry.handle);
										
										if (!comms) {
											// This was commented because it seems to be normal behaviour now.
											//console.error(`Couldn't find comms for entry with handle: ${entry.handle}`);
											return;
										}

										setFileEntrySelected(entry, index >= minIndex && index <= maxIndex);
									});
								} else {
									console.error(`Couldn't find index during shift selecting! Last selected handle: ${lastSelectedFileEntryHandle}, new selected handle: ${pressedFileEntryHandle}`);
								}
							}
						}
					} else {
						setFileEntrySelected(hoveredFileEntry, true);
						lastSelectedFileEntryHandle = pressedFileEntryHandle;
					}
				}
			}

			resetState();
		}
	};
	
	const handleMouseMove = (event: MouseEvent) => {
		if (!isMouseDown || !allowHandleInputOnPage())
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
			const selectedCount = fileExplorerState.selectedFileEntries.size;

			if (selectedCount > 1) {
				// Determine drag tip text for multiple selections
				let fileCount = 0;
				let folderCount = 0;

				fileExplorerState.selectedFileEntries.forEach(selectedEntry => {
					const comms = fileExplorerState.communicationMap.get(selectedEntry.handle)!;

					if (comms.getFileEntry!().isFolder) {
						folderCount++;
					} else {
						fileCount++;
					}
				});

				const filePartText = `${fileCount} file${fileCount > 1 ? "s" : ""}`;
				const folderPartText = `${folderCount} folder${folderCount > 1 ? "s" : ""}`;

				if (folderCount == 0) {
					dragContextTipContext.setTipText!(filePartText);
				} else if (fileCount == 0) {
					dragContextTipContext.setTipText!(folderPartText);
				} else {
					dragContextTipContext.setTipText!(`${filePartText} and ${folderPartText}`);
				}
			} else if (selectedCount == 1) {
				const comms = fileExplorerState.communicationMap.get(pressedFileEntryHandle);

				if (comms) {
					const onlySelectedFileEntry = comms.getFileEntry!();
					dragContextTipContext.setTipText!(`${onlySelectedFileEntry.name}`);
				}
			}

			dragContextTipContext.setVisible!(true);
		}
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		// Prevent keybinds from working when a popup is open
		if (!allowHandleInputOnPage())
			return;

		if (event.key == "F2") { // Rename keybind
			const selectedFileEntries = fileExplorerState.selectedFileEntries;
			const selectedFileEntriesArray: FilesystemEntry[] = [];
			selectedFileEntries.forEach(entry => selectedFileEntriesArray.push(entry));

			if (selectedFileEntriesArray.length == 0)
				return;

			event.preventDefault();
			renamePopupContext.show!(selectedFileEntriesArray, currentBrowsingDirectoryHandle);
		} else if (event.ctrlKey && event.key == "a" && currentWindowType() == WindowType.Filesystem) {
			event.preventDefault();

			// Select all entries that are browseable in the current context
			fileEntries().forEach(entry => setFileEntrySelected(entry, true));
		}
	}

	const handleDragEnter = (event: DragEvent) => {
		event.preventDefault();
		const prevCounter = dragEnterEventCounter++;
		
		if (prevCounter !== 0)
			return;
		
		if (!allowHandleInputOnPage())
			return;

		openedUploadPopupWithDrag = true;
		uploadFilesPopupContext.open?.(currentBrowsingDirectoryHandle);
	};

	const handleDragLeave = (event: DragEvent) => {
		dragEnterEventCounter--;

		if (dragEnterEventCounter !== 0)
			return;

		if (!allowHandleInputOnPage() && !openedUploadPopupWithDrag)
			return;

		openedUploadPopupWithDrag = false;
		uploadFilesPopupContext.close?.();
	};

	// Touch controls
	let lastTouchTapPos: Vector2D = { x: 0, y: 0 };
	let lastTouchTapTime: number = 0;
	let lastTouchDidMove: boolean = false;

	const handleTouchStart = (event: TouchEvent) => {
		if (!allowHandleInputOnPage())
			return;
		
		const touch = event.touches[0];
		lastTouchTapTime = Date.now();
		lastTouchTapPos = { x: touch.clientX, y: touch.clientY };
		lastTouchDidMove = false;
	}

	const handleTouchMove = (event: TouchEvent) => {
		if (!allowHandleInputOnPage())
			return;

		lastTouchDidMove = true;
	}

	const handleTouchEnd = (event: TouchEvent) => {
		if (!allowHandleInputOnPage())
			return;

		// TODO: TESTING
		if (Date.now() - lastTouchTapTime < 800 && lastTouchDidMove == false) {
			const { lastTouchedFileEntry } = fileExplorerState;

			if (lastTouchedFileEntry !== null) {
				deselectAllFileEntries();

				// Update menu context
				contextMenuContext.fileEntries = [ lastTouchedFileEntry ];
				updateContextMenuWidgets(contextMenuContext);

				contextMenuContext.setPosition!({
					x: lastTouchTapPos.x - leftSideNavBar!.clientWidth,
					y: lastTouchTapPos.y
				});

				contextMenuContext.show!(currentBrowsingDirectoryHandle);
			}
		}
	}

	// Disable default context menu
	const handleContextMenu = (event: any) => {
		event.preventDefault();
	};

	// Utility (todo: move out of component probably and provide the element html ids as arguments instead)
	const didMouseClickInsideFileExplorerTopBar = (clickX: number, clickY: number) => {
		if (!fileExplorerTopBarDivRef) {
			console.error(`File explorer top bar html element not found!`);
			return false;
		}

		const clickPos: Vector2D = { x: clickX, y: clickY };
		const bounds = fileExplorerTopBarDivRef.getBoundingClientRect();
		
		if (clickPos.x > bounds.left && clickPos.x < bounds.right && clickPos.y > bounds.top && clickPos.y < bounds.bottom) {
			return true;
		} else {
			return false;
		}
	};

	const didMouseClickInsideFileExplorer = (clickX: number, clickY: number) => {
		if (!fileExplorerDivRef) {
			console.error(`File explorer html element not found!`);
			return false;
		}

		const clickPos: Vector2D = { x: clickX, y: clickY };
		const bounds = fileExplorerDivRef.getBoundingClientRect();
		
		if (clickPos.x > bounds.left && clickPos.x < bounds.right && clickPos.y > bounds.top && clickPos.y < bounds.bottom) {
			return true;
		} else {
			return false;
		}
	};

	const contextMenuActionCallback = async (action: string, directoryHandle: string) => {
		const fileEntries = contextMenuContext.fileEntries;

		if (action == "rename") {
			renamePopupContext.show!(fileEntries, currentBrowsingDirectoryHandle);
		} else if (action == "openFolder") {
			const entry = fileEntries[0];
			openDirectory(entry.handle);
		} else if (action == "newFolder") {
			try {
				const newFolderName = deduplicateFileEntryName("New folder", directoryHandle, userFilesystem);
				await userFilesystem.createNewFolderGlobally(newFolderName, directoryHandle);
				refreshFileExplorer(); // Refresh
			} catch (error) {
				console.error(`Failed to create new folder. Error: ${error}`);
			}
		} else if (action == "shareLinkAsQrCode") {
			// Initiate new popup
			// qrCodePopupContext.createPopup!("https://duckduckgo.com/?q=afg9ad8fg7ad98fgyh3948tyaiefhgkdfjbgakjyt3p8q756p893746qtdoc8hf6tog8g67");
		} else if (action == "download") {
			if (fileEntries.length == 0)
				return;

			mainPageCallbacks.downloadFiles(fileEntries);
		} else if (action == "downloadAsZip") {
			if (fileEntries.length == 0)
				return;

			// TODO: folder support, maybe by reducing a folder to a list of files in the fileEntries array? maybe not

			// Calculate total download size
			let totalDownloadSize = 0;
			fileEntries.forEach(entry => totalDownloadSize += entry.size);

			console.log(`total download size: ${totalDownloadSize}`);
			
			// Download
			mainPageCallbacks.downloadFilesAsZip(fileEntries);
		} else if (action == "playVideo" || action == "playAudio") {
			if (fileEntries.length != 1)
				return;

			const videoFileEntry = fileEntries[0];

			mediaViewerPopupContext.showPopup!();
			mediaViewerPopupContext.openFile!(videoFileEntry);
		} else if (action == "viewImage") {
			if (fileEntries.length != 1)
				return;

			const imageEntry = fileEntries[0];

			mediaViewerPopupContext.showPopup!();
			mediaViewerPopupContext.openFile!(imageEntry);
		}
	}

	// Handle global click event
	const handleGlobalClick = (event: MouseEvent) => {
		const menuElement = contextMenuContext.getHtmlElement!();
		
		if (!menuElement) {
			console.error(`Context menu context returned undefined html element!`);
			return;
		}
		
		const size: Vector2D = { x: menuElement.clientWidth, y: menuElement.clientHeight };
		const pos = contextMenuContext.getPosition!();
		
		// Check if mouse clicked outside of context menu. If so, make it invisible.
		if (event.clientX < pos.x || event.clientX > pos.x + size.x || event.clientY < pos.y || event.clientY > pos.y + size.y) {
			contextMenuContext.hide!();
		}
	}

	// Rename popup
	const renamePopupContext: RenamePopupContext = {};

	const renamePopupRefreshCallback = () => {
		refreshFileExplorer();
	};

	// Media viewer popup
	const mediaViewerPopupContext: MediaViewerPopupContext = {};

	// Navigation toolbar
	const navToolbarContext: NavToolbarContext = {};
	
	const navToolbarNavigateCallback: NavToolbarNavigateCallback = (newDirectoryHandle: string) => {
		openDirectory(newDirectoryHandle);

		return true;
	};

	// Upload files popup
	const uploadFilesPopupContext: UploadFilesPopupContext = {};

	// The content div is the div that holds all the file entries.
	// This code is used to detect when to update the right padding of the column headers bar due to
	// a scroll bar appearing when there is an overflow of file entries.
	const [ columnHeadersRightPadding, setColumnHeadersRightPadding ] = createSignal(0);
	let [ contentDivRef, setContentDivRef ] = createSignal<HTMLDivElement | null>();

	const resizeObserver = new ResizeObserver(entries => {
		for (const entry of entries) {
			if (entry.target == contentDivRef()) {
				// Update right padding to reflect the scrollbar width
				const scrollbarWidth = contentDivRef()!.offsetWidth - contentDivRef()!.clientWidth;
				setColumnHeadersRightPadding(scrollbarWidth);
				return;
			}
		}
	});

	// Get thumbnail callback for file entries
	const requestThumbnailCallback = (entry: FilesystemEntry) => {
		return new Promise<Thumbnail | null>(async resolve => {
			if (entry.category != FileCategory.Image) {
				resolve(null);
				return;
			}
			
			const comms = fileExplorerState.communicationMap.get(entry.handle);
	
			if (!comms) {
				console.warn(`No communication entry for file entry with handle: ${entry.handle}`);
				resolve(null);
				return;
			}
	
			try {
				const thumbnail = await thumbnailManager.getThumbnail(entry, true);
	
				if (thumbnail) {
					resolve(thumbnail);
				} else {
					resolve(null);
				}
			} catch (error) {
				console.error(error);
				resolve(null);
			}
		});
	};

	createEffect(() => {
		setFileEntryVirtualiser(createVirtualizer({
			count: fileEntries().length,
			getScrollElement: () => {
				if (contentDivRef() == null) {
					console.error("contentDivRef is null!");
				}

				return contentDivRef()!;
			},
			estimateSize: () => 32
		}));
	});

	onMount(() => {
		if (contentDivRef() == null) {
			console.error("onMount ran but contentDivRef is still null!");
			return;
		};

		resizeObserver.observe(contentDivRef()!);
	});

	// Add event listeners
	document.addEventListener("click", handleGlobalClick);
	document.addEventListener("mousemove", handleMouseMove);
	document.addEventListener("mousedown", handleMouseDown);
	document.addEventListener("mouseup", handleMouseUp);
	document.addEventListener("touchstart", handleTouchStart);
	document.addEventListener("touchmove", handleTouchMove);
	document.addEventListener("touchend", handleTouchEnd);
	document.addEventListener("keydown", handleKeyDown);

	// Cleanup
	onCleanup(() => {
		document.removeEventListener("click", handleGlobalClick);
		document.removeEventListener("mousemove", handleMouseMove);
		document.removeEventListener("mousedown", handleMouseDown);
		document.removeEventListener("mouseup", handleMouseUp);
		document.removeEventListener("touchstart", handleTouchStart);
		document.removeEventListener("touchmove", handleTouchMove);
		document.removeEventListener("touchend", handleTouchEnd);
		document.removeEventListener("keydown", handleKeyDown);
	});

	// Some constants for the JSX
	const CONTENT_BOTTOM_PADDING = 200; // In pixels

	return (
		<div
			class={`
				flex flex-row w-full h-full
				${(mediaViewerPopupContext.isOpen != undefined && !mediaViewerPopupContext.isOpen()) && "relative"}
			`}
			style={`${!props.visible && "display: none;"}`}
			onDragEnter={handleDragEnter}
			onDragLeave={handleDragLeave}
		>
			<MediaViewerPopup context={mediaViewerPopupContext} userFilesystem={userFilesystem} userSettings={userSettings} />
			<QRCodePopup context={qrCodePopupContext} />
			<DragContextTip context={dragContextTipContext} />
			<ContextMenu actionCallback={contextMenuActionCallback} context={contextMenuContext} />
			<RenamePopup 
				context={renamePopupContext}
				userFilesystem={userFilesystem}
				refreshCallback={renamePopupRefreshCallback}
			/>
			<UploadFilesPopup
				context={uploadFilesPopupContext}
				userFilesystem={userFilesystem}
				uploadCallback={uploadPopupUploadCallback}
				userSettings={userSettings}
				uploadSettings={uploadSettings}
			/>
			<div class="flex flex-row w-full">
				<div
					ref={fileExplorerDivRef}
					class="relative flex flex-col w-full h-full overflow-x-hidden"
					style={`${uploadWindowVisible() && "overflow: hidden !important;"}`}
					onContextMenu={handleContextMenu}
				>
					{/* Top bar */}
					<div class="flex flex-row px-2 items-center flex-shrink-0 w-full bg-zinc-200" ref={fileExplorerTopBarDivRef}>
						<NavToolbar context={navToolbarContext} userFilesystem={userFilesystem} navigateCallback={navToolbarNavigateCallback} />

						{/* Search bar */}
						<div
							class={`
								flex flex-row items-center justify-start w-full h-9 my-1.5 mr-1 bg-zinc-50 rounded-xl border-2 
								${searchBarFocused() ? "border-blue-600" : "border-zinc-300"}
							`}
						>
							<MagnifyingGlassIcon class="w-5 h-5 min-w-5 min-h-5 invert-[20%] ml-3" />
							<input
								type="text"
								placeholder="Search"
								class={`flex-grow ml-2 mr-6 bg-transparent font-SpaceGrotesk text-medium text-[0.9em] outline-none`}
								onKeyPress={onSearchBarKeypress}
								onFocus={() => setSearchBarFocused(true)}
								onBlur={() => setSearchBarFocused(false)}
							/>
							<div class="shrink-0 w-[1px] h-[60%] bg-zinc-300"></div>
							<div class="flex items-center w-[60%] h-full">
								<PathRibbon
									context={pathRibbonContext}
									userFilesystem={userFilesystem}
									setPathCallback={pathRibbonSetPathCallback}
								/>
							</div>
						</div>
						<div class={`aspect-square shrink-0 ml-2 mr-2 p-[3px] rounded-md
											 hover:bg-zinc-300 hover:cursor-pointer active:bg-zinc-400`}>
							<UploadIcon
								class="invert-[20%] w-5 h-5"
								onClick={() => uploadFilesPopupContext.open!(currentBrowsingDirectoryHandle)}
							/>
						</div>
					</div>
					<div
						// Column headers bar
						class="flex flex-row flex-nowrap flex-shrink-0 w-full h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"
						style={`padding-right: ${columnHeadersRightPadding()}px;`}
						ref={fileExplorerColumnHeaderDivRef}
					>
						<div class={`h-full aspect-[1.95]`}></div> {/* Icon column (empty) */}
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
					<div
						ref={setContentDivRef}
						class="w-full h-full overflow-y-auto"
					>
						<div
							class="relative flex flex-col w-full"
							style={`${fileEntryVirtualiser() != undefined && `height: ${fileEntryVirtualiser()!.getTotalSize() + CONTENT_BOTTOM_PADDING}px;`}`}
						>
							{
								fileEntryVirtualiser() != undefined &&
								<For each={fileEntryVirtualiser()!.getVirtualItems()}>
									{(virtualItem) => (
										<div
											class="absolute w-full top-0 left-0"
											style={`transform: translateY(${virtualItem.start}px);`}
										>
											<FileExplorerEntry
												fileEntry={fileEntries()[virtualItem.index]}
												fileExplorerState={fileExplorerState}
												userSettings={userSettings()}
												requestThumbnailCallback={requestThumbnailCallback}
											/>
										</div>
									)}
								</For>
							}
							<div class="flex justify-center w-full py-10">
								<span class="font-SpaceGrotesk text-zinc-500 text-sm">{`
									${isLoading() ? "Loading..." : (fileEntries().length == 0 ? "This directory is empty." : "")}
								`}</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export type {
	FileExplorerFilterSettings,
	FilesystemEntry,
	FileEntryCommunicationData,
	FileExplorerMainPageCallbacks,
	FileExplorerContext,
	FileExplorerState
};

export {
	FileExplorerWindow,
	FileCategory
};
