import { Accessor, createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import { FILESYSTEM_COLUMN_WIDTHS } from "../client/columnWidths";
import { UploadFileRequest, UploadFilesPopup, UploadFilesPopupContext } from "./popups/uploadFilesPopup";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { ContextMenu, ContextMenuContext, Vector2D, ContextMenuAction } from "./contextMenu";
import { deduplicateFileEntryName } from "../utility/fileNames";
import { DragContextTip, DragContextTipContext } from "./dragContextTip";
import { SortButton, SortButtonOnClickCallbackData } from "./sortButton";
import { QRCodePopup, QRCodePopupContext } from "./popups/qrCodePopup";
import { FileCategory, FilesystemEntry, UserFilesystem } from "../client/userFilesystem";
import { canMediaViewerOpenFile, MediaViewerPopup, MediaViewerPopupContext } from "./popups/mediaViewerPopup";
import { PathRibbon, PathRibbonContext } from "./pathRibbon";
import { ThumbnailManager, Thumbnail } from "../client/thumbnails";
import { sortFilesystemEntryByDateAdded, sortFilesystemEntryByName, sortFilesystemEntryBySize, sortFilesystemEntryByType } from "../utility/sorting";
import { NavToolbar, NavToolbarContext, NavToolbarNavigateCallback } from "./navToolbar";
import { RenamePopup, RenamePopupContext } from "./popups/renamePopup";
import { UploadSettings } from "../client/transfers";
import { FileExplorerEntry } from "./fileExplorerEntry";
import { createVirtualizer, Virtualizer } from "@tanstack/solid-virtual";
import { AppServices } from "../client/appServices";
import { isVec2Equal, isVec2InsideDOMRect, WindowType } from "../client/enumsAndTypes";
import { WebSocketSyncManager } from "../client/websocketSync";
import { AlertText } from "./settingsWidgets";
import CONSTANTS from "../client/constants";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import UploadIcon from "../assets/icons/svg/upload.svg?component-solid";

enum FileListSortMode {
  Name,
  Size,
  Type,
  DateAdded
};

type DoubleClickContext = {
  lastLeftClickEventTime: number;
  lastPressedFileHandle: string;
  lastLeftClickPos: Vector2D;
  isDoubleClick: boolean;
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

// Maps file entry handles to data which allows for calling functions specific to one file entry in the file explorer list
type FileExplorerCommunicationMap = Map<string, FileEntryCommunicationData>;

class FileExplorerState {
  communicationMap: FileExplorerCommunicationMap;
  selectedFileEntrySet: Set<FilesystemEntry>;
  hoveredFileEntry: FilesystemEntry | null;
  lastTouchedFileEntry: FilesystemEntry | null;

  constructor(
    communicationMap: FileExplorerCommunicationMap,
    selectedFileEntrySet: Set<FilesystemEntry>
  ) {
    this.communicationMap = communicationMap;
    this.selectedFileEntrySet = selectedFileEntrySet;
    this.hoveredFileEntry = null;
    this.lastTouchedFileEntry = null;
  }
};

type FileExplorerInputHandlerContext = {
  state: FileExplorerState,
  // contextMenuContext: ContextMenuContext,

  /** The content div in the file explorer component. */
  contentDivRef: HTMLDivElement,

  // Callbacks
  openDirectoryCallback: (directoryHandle: string) => void,
  clearSelectionCallback: () => void,

  /** This is called when the user double clicks on a file entry using the left mouse button. */
  doubleClickOnFileCallback: (fileEntry: FilesystemEntry) => void,

  openContextMenuCallback: (mousePos: Vector2D) => void,
  
  getCurrentOpenDirectoryHandle: () => string
};

class FileExplorerInputHandler {
  context: FileExplorerInputHandlerContext;
  doubleClickContext: DoubleClickContext;

  // Other state
  isLeftMouseButtonDown: boolean;
  lastLeftMouseClickTime: number;
  lastLeftMousePressedFileEntryHandle: string;

  /** Whether or not to ignore input events and not process them. */
  ignoreInputEvents: boolean;
  
  constructor(context: FileExplorerInputHandlerContext) {
    this.context = context;
    this.ignoreInputEvents = false;
    this.isLeftMouseButtonDown = false;
    this.lastLeftMouseClickTime = 0;
    this.lastLeftMousePressedFileEntryHandle = "";

    // Initialise double click context
    this.doubleClickContext = {
      lastLeftClickEventTime: 0,
      lastPressedFileHandle: "",
      lastLeftClickPos: { x: 0, y: 0 },
      isDoubleClick: false
    };
    
    // Add event listeners
    document.addEventListener("pointerdown", this.handlePointerDown);
    document.addEventListener("pointerup", this.handlePointerUp)
  }
  
  /**
   * If true, the input handler will ignore input events.
   * This can be useful for ignoring inputs when a popup is on the screen.
   */
  setIgnoreInputEvents(ignore: boolean) {
    this.ignoreInputEvents = ignore;
  }
  
  /** Removes all event listeners. */
  close() {
    document.removeEventListener("pointerdown", this.handlePointerDown);
    document.removeEventListener("pointerup", this.handlePointerUp)
  }

  // Functions for mouse events
  handleMouseDoubleClickOnFileEntry(fileEntry: FilesystemEntry) {
    if (fileEntry.isFolder) {
      // Clear hovered file entry because we just opened this folder (MUST BE DONE! or else the stupid folder path ribbon and escape bug comes back)
      // TODO: explain this better by recreating the problem
      // EDIT: idk what the issue even was now that i look back... welp!
      this.context.state.hoveredFileEntry = null;

      // Open folder
      this.context.openDirectoryCallback(fileEntry.handle);
    } else if (canMediaViewerOpenFile!(fileEntry)) {
      this.context.doubleClickOnFileCallback(fileEntry);
      this.context.clearSelectionCallback();
    }
  }

  /** Only to be called when the left mouse button has been pressed */
  checkForDoubleClick(pressedFileEntry: FilesystemEntry, mousePos: Vector2D) {
    // It's only a valid double click if the user clicked twice on the same handle in a short time.
    if (Date.now() - this.lastLeftMouseClickTime < CONSTANTS.DOUBLE_CLICK_TIME_THRESHOLD_MS) {
      const mouseDidntMove = isVec2Equal(this.doubleClickContext.lastLeftClickPos, mousePos);
      const samePressedEntry = this.lastLeftMousePressedFileEntryHandle == pressedFileEntry.handle;

      if (mouseDidntMove && samePressedEntry) {
        this.handleMouseDoubleClickOnFileEntry(pressedFileEntry);
      }
    }
  }

  handleLeftMouseClick(event: PointerEvent) {
    const mousePos: Vector2D = { x: event.clientX, y: event.clientY };

    /* FIXME:
    // Hide the context menu if outside of bounds but only if its a mouse event (not touch!)
    if (event.pointerType == "mouse")
      hideContextMenuIfOutside({ x: event.clientX, y: event.clientY });
    */

    // Return if mouse did not click in the content div as 
    // if (!isVec2InsideDOMRect(mousePos, this.context.contentDivRef.getBoundingClientRect()))
    //   return;

    // Note that in this context, 'hoveredFileEntry' could also be called `pressedFileEntry`
    const { hoveredFileEntry } = this.context.state;

    if (hoveredFileEntry) {
      // Check for double clicks
      this.checkForDoubleClick(hoveredFileEntry, mousePos);

      // Update state
      this.lastLeftMousePressedFileEntryHandle = hoveredFileEntry.handle;
    }

    // Handle double clicks
    if (this.doubleClickContext.isDoubleClick && isVec2Equal(this.doubleClickContext.lastLeftClickPos, mousePos)) {
      
    }
    
    // Update state
    this.lastLeftMouseClickTime = Date.now();
  }

  handleRightClick(event: MouseEvent) {
    const mousePos: Vector2D = { x: event.clientX, y: event.clientY };
    
    // Past this point, only process right clicks that happened inside the content div's bounds.
    if (!isVec2InsideDOMRect(mousePos, this.context.contentDivRef.getBoundingClientRect()))
      return;

    // Open the context menu since the mouse right clicked inside the content div's bounds
    this.context.openContextMenuCallback(mousePos);
  }

  // Event listeners
  handlePointerDown = (event: PointerEvent) => {
    if (this.ignoreInputEvents)
      return;

    if (event.button == 0) {
      this.isLeftMouseButtonDown = true;

      if (event.pointerType == "mouse") {
        this.handleLeftMouseClick(event);
      }
    } else if (event.button == 2) {
      this.handleRightClick(event);
    }
  }

  handlePointerUp = (event: PointerEvent) => {
    if (this.ignoreInputEvents)
      return;

    if (event.button == 0) {
      this.isLeftMouseButtonDown = false;
    } else if (event.button == 2) {
      
    }
  }
};

type FileExplorerFilterSettings = {
  searchText: string;
  sortMode: FileListSortMode;
  sortAscending: boolean;
};

type FileExplorerContext = {
  openDirectory?: (directoryHandle: string) => void;

  // Forces the file explorer to react to state changes (e.g search bar)
  reactAndUpdate?: () => void;

  // Forces the path ribbon to react to changes in the user filesystem.
  reactAndUpdatePathRibbon?: () => void;
}

type FileExplorerWindowProps = {
  visible: boolean;
  userFilesystem: UserFilesystem;
  appServices: AppServices;
  context: FileExplorerContext;
  webSocketSyncManager: WebSocketSyncManager;
  leftSideNavBarRef?: HTMLDivElement;
  userSettings: Accessor<UserSettings>;
  uploadSettings: UploadSettings;
  currentWindowType: Accessor<WindowType>;
};

/** The function used to select or deselect a file entry. */
function setFileEntrySelected(fileExplorerState: FileExplorerState, fileEntry: FilesystemEntry, selected: boolean) {
  const comms = fileExplorerState.communicationMap.get(fileEntry.handle);

  if (comms == undefined) {
    console.error("Tried to set file entry selection but the communication data wasn't found!");
    return;
  }
  
  if (selected) {
    fileExplorerState.selectedFileEntrySet.add(fileEntry);
  } else {
    fileExplorerState.selectedFileEntrySet.delete(fileEntry);
  }

  comms.isSelected = selected;
  comms.react?.();
};

function FileExplorerWindow(props: FileExplorerWindowProps) {
  // Process props
  const {
    appServices,
    userFilesystem,
    webSocketSyncManager,
    leftSideNavBarRef,
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
    selectedFileEntrySet: new Set<FilesystemEntry>()
  };

  // Store contexts for some components
  const dragContextTipContext: DragContextTipContext = {};
  const qrCodePopupContext: QRCodePopupContext = {};
  const contextMenuContext: ContextMenuContext = {
    fileEntries: []
  };

  // Path ribbon
  const pathRibbonContext: PathRibbonContext = {};
  
  const pathRibbonSetPathCallback = (newDirectoryHandle: string) => {
    if (newDirectoryHandle != currentBrowsingDirectoryHandle) { // Prevent redundant uploads
      openDirectory(newDirectoryHandle);
    }
  };

  // Handle upload window events
  const uploadPopupUploadCallback = (files: UploadFileRequest[]) => {
    appServices.uploadFiles(files);
  }

  const clearSelection = () => {
    fileExplorerState.selectedFileEntrySet.forEach(entry => setFileEntrySelected(fileExplorerState, entry, false));
  };

  // Used in the UI to display an empty directory message or a loading message
  const [ isLoading, setIsLoading ] = createSignal(false);

  // Used in the UI to display an error message (assumes the file explorer is empty)
  // It will only show if the message is not empty.
  const [ loadErrorMessage, setLoadErrorMessage ] = createSignal<string>("");

  // The virtualiser for virtual scrolling
  const [ fileEntryVirtualiser, setFileEntryVirtualiser ] = createSignal<Virtualizer<any, any> | undefined>();
  
  // Refreshes the file entries array with the current filter settings
  const reactAndUpdate = () => {
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
    fileExplorerState.selectedFileEntrySet.clear();
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

  // Forces the path ribbon to react and update to user filesystem changes.
  const reactAndUpdatePathRibbon = () => {
    pathRibbonContext.setPath!(currentBrowsingDirectoryHandle);
  };

  // Handles search bar functionality
  const onSearchBarKeypress = (event: any) => {
    if (event.keyCode != 13)
      return;

    // Set search text
    setFilterSettings({ ...filterSettings(), searchText: event.target.value });

    event.target.blur(); // Unfocus the search bar

    // Refresh entries
    reactAndUpdate();
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
    reactAndUpdate();
  }

  const openDirectory = (directoryHandle: string) => {
    // TODO: if user navigates while loading (via nav toolbar or path ribbon), then cancel request to prevent conflicts
    
    currentBrowsingDirectoryHandle = directoryHandle;
    lastSelectedFileEntryHandle = "";
    navToolbarContext.update!(directoryHandle);
    pathRibbonContext.setPath!(directoryHandle);

    setLoadErrorMessage("");
    
    // If there are children in the directory node then it means it has already been synced
    const directoryNode = userFilesystem.findNodeFromHandle(userFilesystem.getRootNode(), directoryHandle);

    if (directoryNode !== null && directoryNode.children.length > 0) {
      reactAndUpdate();
      setIsLoading(false);
      return;
    }
    
    // Sync from the server
    setIsLoading(true);
    setFileEntries([]);

    userFilesystem.syncFiles(directoryHandle)
    .then(() => {
      reactAndUpdate();
    })
    .catch((error) => {
      setLoadErrorMessage(error);
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

  /** The latest pressed file entry handle. It can be null if the last click did not click on any file entry. */
  let pressedFileEntryHandle: string | null = "";
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
      x: currentMousePos.x - leftSideNavBarRef!.clientWidth,
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

  // For double click checking
  

  const isAnyPopupOpen = () => {
    return !mediaViewerPopupContext.isOpen!() && !renamePopupContext.isOpen!() && !uploadFilesPopupContext.isOpen!();
  }
  
  const handleMouseUp = (event: MouseEvent) => {
    dragEnterEventCounter = 0;
    openedUploadPopupWithDrag = false;

    if (!isAnyPopupOpen())
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
        clearSelection();
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
          setFileEntrySelected(fileExplorerState, hoveredFileEntry, !hoveredFileEntryComms.isSelected);

          if (hoveredFileEntryComms.isSelected) {
            lastSelectedFileEntryHandle = pressedFileEntryHandle;
          }
        }
      } else {
        if (!isDragging()) {
          clearSelection();
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

                    setFileEntrySelected(fileExplorerState, entry, index >= minIndex && index <= maxIndex);
                  });
                } else {
                  console.error(`Couldn't find index during shift selecting! Last selected handle: ${lastSelectedFileEntryHandle}, new selected handle: ${pressedFileEntryHandle}`);
                }
              }
            }
          } else {
            setFileEntrySelected(fileExplorerState, hoveredFileEntry, true);
            lastSelectedFileEntryHandle = pressedFileEntryHandle;
          }
        }
      }

      resetState();
    }
  };
  
  const handleMouseMove = (event: MouseEvent) => {
    if (!isMouseDown || !isAnyPopupOpen())
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
      const selectedCount = fileExplorerState.selectedFileEntrySet.size;

      if (selectedCount > 1) {
        // Determine drag tip text for multiple selections
        let fileCount = 0;
        let folderCount = 0;

        fileExplorerState.selectedFileEntrySet.forEach(selectedEntry => {
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
      } else if (selectedCount == 1 && pressedFileEntryHandle) {
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
    if (!isAnyPopupOpen())
      return;

    if (event.key == "F2") { // Rename keybind
      const selectedFileEntries = fileExplorerState.selectedFileEntrySet;
      const selectedFileEntriesArray: FilesystemEntry[] = [];
      selectedFileEntries.forEach(entry => selectedFileEntriesArray.push(entry));

      if (selectedFileEntriesArray.length == 0)
        return;

      event.preventDefault();
      renamePopupContext.open!(selectedFileEntriesArray, currentBrowsingDirectoryHandle);
    } else if (event.ctrlKey && event.key == "a" && currentWindowType() == WindowType.Filesystem) {
      event.preventDefault();

      // Select all entries that are browseable in the current context
      fileEntries().forEach(entry => setFileEntrySelected(fileExplorerState, entry, true));
    }
  }

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    const prevCounter = dragEnterEventCounter++;
    
    if (prevCounter !== 0)
      return;
    
    if (!isAnyPopupOpen())
      return;

    openedUploadPopupWithDrag = true;
    uploadFilesPopupContext.open?.(currentBrowsingDirectoryHandle);
  };

  const handleDragLeave = (event: DragEvent) => {
    dragEnterEventCounter--;

    if (dragEnterEventCounter !== 0)
      return;

    if (!isAnyPopupOpen() && !openedUploadPopupWithDrag)
      return;

    openedUploadPopupWithDrag = false;
    uploadFilesPopupContext.close?.();
  };

  // Touch controls
  let lastTouchTapPos: Vector2D = { x: 0, y: 0 };
  let lastTouchTapTime: number = 0;
  let lastTouchDidMove: boolean = false;

  const handleTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    const touchPos: Vector2D = { x: touch.clientX, y: touch.clientY };

    fileExplorerState.lastTouchedFileEntry = null;

    if (!isAnyPopupOpen())
      return;

    lastTouchTapTime = Date.now();
    lastTouchTapPos = touchPos;
    lastTouchDidMove = false;
  }

  const handleTouchMove = (event: TouchEvent) => {
    if (!isAnyPopupOpen())
      return;

    lastTouchDidMove = true;
  }

  const handleTouchEnd = (event: TouchEvent) => {
    //if (fileExplorerState.lastTouchedFileEntry === null)
    //  hideContextMenuIfOutside(touchPos);

    hideContextMenuIfOutside(lastTouchTapPos);

    if (!isAnyPopupOpen())
      return;

    // TODO: TESTING
    if (Date.now() - lastTouchTapTime < 800 && lastTouchDidMove == false) {
      const { lastTouchedFileEntry } = fileExplorerState;

      if (lastTouchedFileEntry !== null) {
        clearSelection();

        // Update menu context
        contextMenuContext.fileEntries = [ lastTouchedFileEntry ];
        contextMenuContext.react?.();

        contextMenuContext.setPosition!({
          x: lastTouchTapPos.x - leftSideNavBarRef!.clientWidth,
          y: lastTouchTapPos.y
        });

        contextMenuContext.show!(currentBrowsingDirectoryHandle);
      }
    }
  }

  // Disable default context menu
  const handleOnContextMenuEvent = (event: any) => {
    event.preventDefault();
  };

  /**
   * Checks if a mouse position is inside the content div in the file explorer.
   */
  const didMouseClickInsideFileExplorer = (clickX: number, clickY: number) => {
    if (!contentDivRef()) {
      console.error(`Content div ref not found!`);
      return false;
    }

    const clickPos: Vector2D = { x: clickX, y: clickY };
    const bounds = contentDivRef()!.getBoundingClientRect();
    
    if (clickPos.x >= bounds.left && clickPos.x <= bounds.right && clickPos.y >= bounds.top && clickPos.y <= bounds.bottom) {
      return true;
    } else {
      return false;
    }
  };

  const contextMenuActionCallback = async (actionId: number, directoryHandle: string) => {
    const fileEntries = contextMenuContext.fileEntries;

    if (actionId == ContextMenuAction.Rename) {
      renamePopupContext.open!(fileEntries, currentBrowsingDirectoryHandle);
    } else if (actionId == ContextMenuAction.OpenFolder) {
      const entry = fileEntries[0];
      openDirectory(entry.handle);
    } else if (actionId == ContextMenuAction.NewFolder) {
      try {
        const newFolderName = deduplicateFileEntryName("New folder", directoryHandle, userFilesystem);
        await userFilesystem.createNewFolderGlobally(newFolderName, directoryHandle);
      } catch (error) {
        console.error(`Failed to create new folder. Error: ${error}`);
      }
    } else if (actionId == ContextMenuAction.Download) {
      if (fileEntries.length == 0)
        return;

      appServices.downloadFiles(fileEntries);
    } else if (actionId == ContextMenuAction.DownloadAsZip) {
      if (fileEntries.length == 0)
        return;

      // TODO: folder support, maybe by reducing a folder to a list of files in the fileEntries array? maybe not

      // Calculate total download size
      let totalDownloadSize = 0;
      fileEntries.forEach(entry => totalDownloadSize += entry.size);
      console.log(`total download size: ${totalDownloadSize}`);
      
      // Download
      appServices.downloadFilesAsZip(fileEntries);
    } else if (actionId == ContextMenuAction.PlayVideo || actionId == ContextMenuAction.PlayAudio) {
      if (fileEntries.length != 1)
        return;

      const videoFileEntry = fileEntries[0];

      mediaViewerPopupContext.showPopup!();
      mediaViewerPopupContext.openFile!(videoFileEntry);
    } else if (actionId == ContextMenuAction.ViewImage) {
      if (fileEntries.length != 1)
        return;

      const imageEntry = fileEntries[0];

      mediaViewerPopupContext.showPopup!();
      mediaViewerPopupContext.openFile!(imageEntry);
    }
  };

  /**
   * Convenience function for checking if a given position is outside the bounds of the context menu
   * and if so, then it will hide the context menu.
   */
  const hideContextMenuIfOutside = (position: Vector2D) => {
    const menuElement = contextMenuContext.getHtmlElement!();
    
    if (!menuElement) {
      console.error(`Context menu context getHtmlElement() returned undefined html element!`);
      return;
    }
    
    const size: Vector2D = { x: menuElement.clientWidth, y: menuElement.clientHeight };
    const pos = contextMenuContext.getPosition!();

    // Offset by left side nav bar width so the bound checking is correct
    pos.x += leftSideNavBarRef!.clientWidth;

    // Check if mouse clicked outside of context menu. If so, make it invisible.
    if (position.x < pos.x || position.x > pos.x + size.x || position.y < pos.y || position.y > pos.y + size.y) {
      contextMenuContext.hide!();
    }
  };

  // Rename popup
  const renamePopupContext: RenamePopupContext = {};

  const renamePopupOnRenameCallback = (renamedHandles: string[]) => {
    // unused
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
  
  // Resize event
  const [ smallScreen, setSmallScreen ] = createSignal(false);
  const [ pathRibbonVisible, setPathRibbonVisible ] = createSignal(true);

  const checkScreenSize = () => {
    const newSize: Vector2D = { x: window.innerWidth, y: window.innerHeight };

    setSmallScreen(newSize.x < CONSTANTS.SMALL_SCREEN_WIDTH_THRESHOLD);
    setPathRibbonVisible(!smallScreen());

    if (newSize.x < CONSTANTS.SMALL_SCREEN_WIDTH_THRESHOLD) {
      // fix weird clicking on upload icon issue + change it to a plus instead (maybe only for mobile? nah, just easy, only two clicks to upload)
    }
  };

  createEffect(() => {
    // Initialise virtual scrolling for file explorer
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

  const openContextMenuCallback = (mousePos: Vector2D) => {
    console.log(`Open context menu at: ${mousePos.x}, ${mousePos.y}`);

    // + 5 on each axis to apply a bit of an offset so the mouse doesn't always overlap with a button in the context menu
    const spawnMenuOffset: Vector2D = { x: 5, y: 5 };

    // Subtract offset due to size of left side navigation menu
    // spawnMenuOffset.x -= leftSideNavBarRef!.clientWidth;

    // TODO: convenience function for getting selected file entries as an array!
    const selectedEntries: FilesystemEntry[] = [];

    fileExplorerState.selectedFileEntrySet.forEach(selectedEntry => {
      const comms = fileExplorerState.communicationMap.get(selectedEntry.handle)!;
      const entry = comms.getFileEntry!();
      selectedEntries.push(entry);
    });

    contextMenuContext.fileEntries = selectedEntries;
    contextMenuContext.react?.();

    // Wrap position
    const menuSize = contextMenuContext.getSize!();
    const menuPos: Vector2D = { x: mousePos.x + spawnMenuOffset.x, y: mousePos.y + spawnMenuOffset.y };
    const screenSize: Vector2D = { x: window.screen.width, y: window.screen.height, };
    
    if (menuPos.x + menuSize.x > screenSize.x - 5) // Subtract to add some padding
      menuPos.x -= menuSize.x;

    if (menuPos.y + menuSize.y > screenSize.y - 5)
      menuPos.y -= menuSize.y;
    
    // Set position and make visible
    contextMenuContext.setPosition!({ x: menuPos.x, y: menuPos.y });
    contextMenuContext.show!(currentBrowsingDirectoryHandle);
  };

  onMount(() => {
    if (contentDivRef() == null) {
      console.error("onMount ran but contentDivRef is still null!");
      return;
    };

    checkScreenSize();
    resizeObserver.observe(contentDivRef()!);

    // Input handler
    const inputHandlerContext: FileExplorerInputHandlerContext = {
      state: fileExplorerState,
      // contextMenuContext: contextMenuContext,
      contentDivRef: contentDivRef()!,
      openDirectoryCallback: openDirectory,
      clearSelectionCallback: clearSelection,
      doubleClickOnFileCallback: (fileEntry: FilesystemEntry) => {
        mediaViewerPopupContext.openFile!(fileEntry);
        mediaViewerPopupContext.showPopup!();
      },
      openContextMenuCallback: openContextMenuCallback,
      getCurrentOpenDirectoryHandle: () => {
        return currentBrowsingDirectoryHandle;
      }
    };
  
    const inputHandler = new FileExplorerInputHandler(inputHandlerContext);
  });


  // Set context
  props.context.openDirectory = openDirectory;
  props.context.reactAndUpdate = reactAndUpdate;
  props.context.reactAndUpdatePathRibbon = reactAndUpdatePathRibbon;

  // Add event listeners
  document.addEventListener("mousemove", handleMouseMove);
  // document.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("touchstart", handleTouchStart);
  document.addEventListener("touchmove", handleTouchMove);
  document.addEventListener("touchend", handleTouchEnd);
  document.addEventListener("keydown", handleKeyDown);
  window.addEventListener("resize", checkScreenSize);

  // Cleanup
  onCleanup(() => {
    document.removeEventListener("mousemove", handleMouseMove);
    // document.removeEventListener("pointerdown", handlePointerDown);
    document.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("touchstart", handleTouchStart);
    document.removeEventListener("touchmove", handleTouchMove);
    document.removeEventListener("touchend", handleTouchEnd);
    document.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("resize", checkScreenSize);
  });

  // Some constants for the JSX
  const CONTENT_BOTTOM_PADDING = 200; // In pixels

  return (
    <>
      <ContextMenu actionCallback={contextMenuActionCallback} context={contextMenuContext} />
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
        <RenamePopup 
          context={renamePopupContext}
          userFilesystem={userFilesystem}
          onRenameCallback={renamePopupOnRenameCallback}
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
            class="relative flex flex-col w-full h-full"
            onContextMenu={handleOnContextMenuEvent}
          >
            {/* Top bar */}
            <div
              class="flex flex-row px-2 items-center bg-zinc-200"
              ref={fileExplorerTopBarDivRef}
            >
              <NavToolbar context={navToolbarContext} userFilesystem={userFilesystem} navigateCallback={navToolbarNavigateCallback} />

              {/* Search bar */}
              <div
                class={`
                  flex flex-row w-full items-center justify-start h-9 my-1.5 mr-1 bg-zinc-50 rounded-xl border-2
                  ${searchBarFocused() ? "border-blue-600" : "border-zinc-300"}
                `}
              >
                <MagnifyingGlassIcon class="w-5 h-5 min-w-5 min-h-5 text-zinc-700 ml-3" />
                <input
                  class={`w-[45%] ml-2 mr-6 bg-transparent font-SpaceGrotesk text-medium text-[0.9em] outline-none`}
                  type="text"
                  placeholder="Search"
                  onKeyPress={onSearchBarKeypress}
                  onFocus={() => setSearchBarFocused(true)}
                  onBlur={() => setSearchBarFocused(false)}
                />
                <div class={`shrink-0 w-[1px] h-[60%] bg-zinc-300 ${!pathRibbonVisible() ? "hidden" : ""}`} />
                <div
                  class={`
                    flex items-center w-[55%] h-full
                    ${!pathRibbonVisible() ? "hidden" : ""}
                  `}
                >
                  <PathRibbon
                    context={pathRibbonContext}
                    userFilesystem={userFilesystem}
                    setPathCallback={pathRibbonSetPathCallback}
                  />
                </div>
              </div>

              {/* Upload button */}
              <div
                class={`
                  aspect-square shrink-0 ml-2 mr-2 p-[3px] rounded-md
                  hover:bg-zinc-300 hover:cursor-pointer active:bg-zinc-400
                `}
                onClick={() => uploadFilesPopupContext.open!(currentBrowsingDirectoryHandle)}
              >
                <UploadIcon class="invert-[20%] w-5 h-5" />
              </div>
            </div>

            {/* Column headers bar */}
            <div
              class="flex flex-row flex-nowrap w-full h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"
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
              <Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
                <ColumnText text="Date added" semibold/>
                <SortButton
                  sortAscending={true}
                  sortMode={FileListSortMode.DateAdded}
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
                  {
                    loadErrorMessage().length > 0 ? 
                    <div class="flex justify-center">
                      <AlertText text={loadErrorMessage()} />
                    </div> : 
                    <span class="font-SpaceGrotesk text-zinc-500 text-sm">{`
                      ${isLoading() ? "Loading..." : (fileEntries().length == 0 ? "This directory is empty." : "")}
                    `}</span>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export type {
  FileExplorerFilterSettings,
  FilesystemEntry,
  FileEntryCommunicationData,
  FileExplorerContext,
  FileExplorerState
};

export {
  FileExplorerWindow,
  FileCategory
};
