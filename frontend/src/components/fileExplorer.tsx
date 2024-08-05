import { Accessor, createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import { FILESYSTEM_COLUMN_WIDTHS } from "../client/columnWidths";
import { UploadFileRequest, UploadFilesPopup, UploadFilesPopupContext } from "./popups/uploadFilesPopup";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { ContextMenu, ContextMenuContext, ContextMenuAction } from "./contextMenu";
import { Vector2D } from "../client/vector";
import { deduplicateFileEntryName } from "../utility/fileNames";
import { DragToolTip, DragToolTipContext } from "./dragToolTip";
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
import { isPointInsideBounds, keepRectInBounds, vec2Subtract } from "../client/vector";
import { WebSocketSyncManager } from "../client/websocketSync";
import { AlertText } from "./settingsWidgets";
import { FileEntryCommunicationData, FileExplorerState } from "../client/fileExplorer/fileExplorerState";
import { FileExplorerInputHandler, FileExplorerInputHandlerCallbacks, FileExplorerInputHandlerContext } from "../client/fileExplorer/fileExplorerInputHandler";
import { createDragToolTipText, getHandlesFromFilesystemEntryArray } from "../client/fileExplorer/fileExplorerUtils";
import { getWindowSize } from "../client/utils";
import WindowType from "../client/windowType";
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

  // Used to reset file entry hover outlines
  let prevHoveredFileEntry: FilesystemEntry | null = null;

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
  
  // Create the state
  const fileExplorerState = new FileExplorerState();

  // Store contexts for some components
  const dragContextTipContext: DragToolTipContext = {};
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
    fileExplorerState.selectedFileEntryMap.forEach(entry => fileExplorerState.setSelected(entry, false));
  };

  // Used in the UI to display an empty directory message or a loading message
  const [ isLoading, setIsLoading ] = createSignal(false);

  // Used in the UI to display an error message (assumes the file explorer is empty)
  // It will only show if the message is not empty.
  const [ loadErrorMessage, setLoadErrorMessage ] = createSignal<string>("");

  // The virtualiser for virtual scrolling
  const [ fileEntryVirtualiser, setFileEntryVirtualiser ] = createSignal<Virtualizer<any, any> | undefined>();
  
  /** Refreshes the file entries array with the current filter settings. */ 
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

    // Reset some file explorer state
    fileExplorerState.communicationMap.clear();
    fileExplorerState.selectedFileEntryMap.clear();
    fileExplorerState.hoveredFileEntry = null;
    fileExplorerState.touchedFileEntry = null;

    // Fill communication map data
    entries.forEach(entry => {
      fileExplorerState.communicationMap.set(entry.handle, {
        isSelected: false,
        isBeingCut: fileExplorerState.cutFileEntriesMap.has(entry.handle),
        showHoverOutline: false
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

  const resetPrevHoverFileEntryOutline = () => {
    // Reset previous entry first
    if (prevHoveredFileEntry) {
      const comms = fileExplorerState.communicationMap.get(prevHoveredFileEntry.handle);
      
      if (comms) {
        comms.showHoverOutline = false;
        comms.react!();
      }

      prevHoveredFileEntry = null;
    }
  };

  // Variables for opening the upload popup when files are dragged over the file explorer
  let dragEnterEventCounter = 0;
  let openedUploadPopupWithDrag = false;

  const isAnyPopupOpen = () => {
    return mediaViewerPopupContext.isOpen!() || renamePopupContext.isOpen!() || uploadFilesPopupContext.isOpen!();
  }

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    const prevCounter = dragEnterEventCounter++;
    
    if (prevCounter !== 0)
      return;
    
    if (isAnyPopupOpen())
      return;

    openedUploadPopupWithDrag = true;
    uploadFilesPopupContext.open?.(currentBrowsingDirectoryHandle);
  };

  const handleDragLeave = (event: DragEvent) => {
    dragEnterEventCounter--;

    if (dragEnterEventCounter !== 0)
      return;

    if (isAnyPopupOpen() && !openedUploadPopupWithDrag)
      return;

    openedUploadPopupWithDrag = false;
    uploadFilesPopupContext.close?.();
  };

  // Disable default context menu
  const handleOnContextMenuEvent = (event: any) => {
    event.preventDefault();
  };

  const contextMenuActionCallback = async (action: ContextMenuAction, directoryHandle: string) => {
    const fileEntries = contextMenuContext.fileEntries;

    if (action == ContextMenuAction.Rename) {
      renamePopupContext.open!(fileEntries, currentBrowsingDirectoryHandle);
    } else if (action == ContextMenuAction.OpenFolder) {
      const entry = fileEntries[0];
      openDirectory(entry.handle);
    } else if (action == ContextMenuAction.NewFolder) {
      try {
        const newFolderName = deduplicateFileEntryName("New folder", directoryHandle, userFilesystem);
        await userFilesystem.createNewFolderGlobally(newFolderName, directoryHandle);
      } catch (error) {
        console.error(`Failed to create new folder. Error: ${error}`);
      }
    } else if (action == ContextMenuAction.Download) {
      if (fileEntries.length == 0)
        return;

      appServices.downloadFiles(fileEntries);
    } else if (action == ContextMenuAction.DownloadAsZip) {
      if (fileEntries.length == 0)
        return;

      // TODO: folder support, maybe by reducing a folder to a list of files in the fileEntries array? maybe not

      // Calculate total download size
      let totalDownloadSize = 0;
      fileEntries.forEach(entry => totalDownloadSize += entry.size);
      console.log(`total download size: ${totalDownloadSize}`);
      
      // Download
      appServices.downloadFilesAsZip(fileEntries);
    } else if (action == ContextMenuAction.PlayVideo || action == ContextMenuAction.PlayAudio) {
      if (fileEntries.length != 1)
        return;

      const videoFileEntry = fileEntries[0];

      mediaViewerPopupContext.showPopup!();
      mediaViewerPopupContext.openFile!(videoFileEntry);
    } else if (action == ContextMenuAction.ViewImage) {
      if (fileEntries.length != 1)
        return;

      const imageEntry = fileEntries[0];

      mediaViewerPopupContext.showPopup!();
      mediaViewerPopupContext.openFile!(imageEntry);
    } else if (action == ContextMenuAction.Cut) {
      console.log(`Cutting ${fileEntries.length} files.`);
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

  const checkWindowSize = () => {
    const windowSize = getWindowSize();

    setSmallScreen(windowSize.x < CONSTANTS.SMALL_SCREEN_WIDTH_THRESHOLD);
    setPathRibbonVisible(!smallScreen());

    if (windowSize.x < CONSTANTS.SMALL_SCREEN_WIDTH_THRESHOLD) {
      // change upload icon to a plus instead (maybe only for mobile? nah, just easy, only two clicks to upload)
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
    // Apply a bit of an offset so the mouse doesn't initally overlap the context menu
    const spawnMenuOffset: Vector2D = { x: 5, y: 5 };

    // TODO: convenience function for getting selected file entries as an array!
    const selectedEntries: FilesystemEntry[] = [];
    fileExplorerState.selectedFileEntryMap.forEach(entry => selectedEntries.push(entry));

    contextMenuContext.fileEntries = selectedEntries;
    contextMenuContext.react?.();

    // Create menu position
    const menuSize = contextMenuContext.getSize!();
    const windowSize = getWindowSize();
    let menuPos: Vector2D = { x: mousePos.x + spawnMenuOffset.x, y: mousePos.y + spawnMenuOffset.y };

    menuPos = keepRectInBounds(
      menuPos,
      menuSize,
      Vector2D.zero,

      // Have a padding of 5 pixels on the right and bottom side of the screen
      vec2Subtract(windowSize, { x: 5, y: 5 })
    );
    
    // Set position and make visible
    contextMenuContext.setPosition!({ x: menuPos.x, y: menuPos.y });
    contextMenuContext.show!(currentBrowsingDirectoryHandle);
  };

  onMount(() => {
    if (contentDivRef() == null) {
      console.error("onMount ran but contentDivRef is still null!");
      return;
    };

    checkWindowSize();
    resizeObserver.observe(contentDivRef()!);

    // Input handler
    const inputHandlerContext: FileExplorerInputHandlerContext = {
      state: fileExplorerState,
      userFilesystem: userFilesystem,
      renamePopupContext: renamePopupContext,
      fileEntries: fileEntries,
      // contextMenuContext: contextMenuContext,
      contentDivRef: contentDivRef()!,
      
      currentOpenDirectoryHandle: () => {
        return currentBrowsingDirectoryHandle;
      },

      currentWindowType: currentWindowType,

      shouldIgnoreInput: () => {
        return isAnyPopupOpen();
      }
    };

    const inputHandlerCallbacks: FileExplorerInputHandlerCallbacks = {
      openDirectory: openDirectory,
      clearSelection: clearSelection,
      openContextMenu: openContextMenuCallback,
      closeContextMenu: () => {
        contextMenuContext.hide?.();
      },
      doubleClickedOnFile: (fileEntry: FilesystemEntry) => {
        if (canMediaViewerOpenFile(fileEntry)) {
          mediaViewerPopupContext.showPopup!();
          mediaViewerPopupContext.openFile!(fileEntry);
        }
      },
      processLeftMouseDownPos: (mousePos: Vector2D) => {
        // Hide the context menu if the mouse clicked outside of its bounds.
        const mouseIsInsideContextMenu = isPointInsideBounds(
          mousePos,
          contextMenuContext.getPosition!(),
          contextMenuContext.getSize!()
        );

        if (!mouseIsInsideContextMenu) {
          contextMenuContext.hide?.();
        }
      },
      processDrag(
        draggedEntries: FilesystemEntry[],
        hoveredFileEntry: FilesystemEntry | null,
        startDragMousePos: Vector2D,
        mousePos: Vector2D
      ) {
        if (draggedEntries.length == 0)
          return;

        if (!hoveredFileEntry)
          return;

        const comms = fileExplorerState.communicationMap.get(hoveredFileEntry.handle);

        if (!comms)
          return;

        // Reset previous hover entry
        resetPrevHoverFileEntryOutline();

        // Show hover outline
        if (hoveredFileEntry.isFolder && !comms.isSelected) {
          comms.showHoverOutline = true;
          comms.react!();
        }

        // Update drag tooltip
        const dragTipText = createDragToolTipText(draggedEntries);
        dragContextTipContext.setVisible?.(true);
        dragContextTipContext.setTipText?.(dragTipText);
        dragContextTipContext.setDropIconEnabled?.(hoveredFileEntry.isFolder && !comms.isSelected);
        dragContextTipContext.setPosition?.(mousePos);

        // Update state
        prevHoveredFileEntry = hoveredFileEntry;
      },
      endDrag(draggedEntries: FilesystemEntry[], hoveredFileEntry: FilesystemEntry | null, mousePos: Vector2D) {
        if (hoveredFileEntry && draggedEntries.length > 0) {
          const comms = fileExplorerState.communicationMap.get(hoveredFileEntry.handle);

          if (comms && !comms.isSelected && hoveredFileEntry.isFolder) {
            const draggedFilesHandles = getHandlesFromFilesystemEntryArray(draggedEntries);

            userFilesystem.moveFilesGlobally(draggedFilesHandles, hoveredFileEntry.handle)
            .catch(error => {
              console.error(`Failed to move files globally. Error: ${error}`);
            });
          }
        }

        resetPrevHoverFileEntryOutline();
        dragContextTipContext.setVisible?.(false);
        dragContextTipContext.setDropIconEnabled?.(false);
      }
    };
  
    const inputHandler = new FileExplorerInputHandler(inputHandlerContext, inputHandlerCallbacks);
  });

  // Set context
  props.context.openDirectory = openDirectory;
  props.context.reactAndUpdate = reactAndUpdate;
  props.context.reactAndUpdatePathRibbon = reactAndUpdatePathRibbon;

  // Add event listeners
  window.addEventListener("resize", checkWindowSize);

  // Cleanup
  onCleanup(() => {
    window.removeEventListener("resize", checkWindowSize);
  });

  // Some constants for the JSX
  const CONTENT_BOTTOM_PADDING = 200; // In pixels

  return (
    <>
      <ContextMenu actionCallback={contextMenuActionCallback} context={contextMenuContext} />
      <DragToolTip context={dragContextTipContext} />
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
