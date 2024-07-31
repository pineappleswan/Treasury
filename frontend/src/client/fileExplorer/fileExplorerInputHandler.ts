import { Accessor } from "solid-js";
import { FileExplorerState, FilesystemEntry } from "../../components/fileExplorer";
import { isVec2Equal, isPointInsideDOMRect, Vector2D } from "../enumsAndTypes";
import CONSTANTS from "../constants";

type DoubleClickContext = {
  lastLeftClickEventTime: number;
  lastPressedFileHandle: string;
  isDoubleClick: boolean;
};

type FileExplorerInputHandlerContext = {
  state: FileExplorerState,
  fileEntries: Accessor<FilesystemEntry[]>,
  // contextMenuContext: ContextMenuContext,

  /** The content div in the file explorer component. */
  contentDivRef: HTMLDivElement,

  // Callbacks
  openDirectoryCallback: (directoryHandle: string) => void,
  clearSelectionCallback: () => void,

  /** This is called when the user double clicks on a file entry using the left mouse button. */
  doubleClickOnFileCallback: (fileEntry: FilesystemEntry) => void,

  openContextMenuCallback: (mousePos: Vector2D) => void,

  /** Used for closing the context menu if the mouse was pressed down outside its bounds. */
  processLeftMouseDownPosCallback: (mousePos: Vector2D) => void,
  
  getCurrentOpenDirectoryHandle: () => string
};

class FileExplorerInputHandler {
  context: FileExplorerInputHandlerContext;
  doubleClickContext: DoubleClickContext;

  // Mouse state
  isLeftMouseButtonDown: boolean;
  lastLeftMouseClickTime: number;
  lastLeftMouseDownPos: Vector2D;
  lastLeftMousePressedFileEntry: FilesystemEntry | null;

  /** The handle of the file entry that was last selected individually and not through a range selection. */
  lastLeftMouseSelectedFileEntry: FilesystemEntry | null;

  // Touch state

  /** Whether or not to ignore input events and not process them. */
  ignoreInputEvents: boolean;
  
  constructor(context: FileExplorerInputHandlerContext) {
    this.context = context;
    this.ignoreInputEvents = false;
    this.isLeftMouseButtonDown = false;
    this.lastLeftMouseClickTime = 0;
    this.lastLeftMousePressedFileEntry = null;
    this.lastLeftMouseSelectedFileEntry = null;
    this.lastLeftMouseDownPos = { x: 0, y: 0 };

    // Initialise double click context
    this.doubleClickContext = {
      lastLeftClickEventTime: 0,
      lastPressedFileHandle: "",
      isDoubleClick: false
    };
    
    // Add event listeners
    document.addEventListener("pointerdown", this.onPointerDown);
    document.addEventListener("pointerup", this.onPointerUp)
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
    document.removeEventListener("pointerdown", this.onPointerDown);
    document.removeEventListener("pointerup", this.onPointerUp)
  }

  // Utility functions

  /** Checks that two filesystem entries have handles that match. If either entry is null, then false is always returned. */
  private fileEntryHandlesMatch(lhs: FilesystemEntry | null, rhs: FilesystemEntry | null) {
    if (lhs == null || rhs == null)
      return false;

    if (lhs.handle == rhs.handle)
      return true;

    return false;
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
    } else {
      this.context.doubleClickOnFileCallback(fileEntry);
      this.context.clearSelectionCallback();
    }
  }

  /** Only to be called when the left mouse button has been pressed */
  checkForDoubleClick(pressedFileEntry: FilesystemEntry, mousePos: Vector2D) {
    // It's only a valid double click if the user clicked twice on the same handle in a short time.
    if (Date.now() - this.lastLeftMouseClickTime < CONSTANTS.DOUBLE_CLICK_TIME_THRESHOLD_MS) {
      const mouseDidntMove = isVec2Equal(this.lastLeftMouseDownPos, mousePos);
      const samePressedEntry = this.fileEntryHandlesMatch(this.lastLeftMousePressedFileEntry, pressedFileEntry);
      
      if (mouseDidntMove && samePressedEntry) {
        this.handleMouseDoubleClickOnFileEntry(pressedFileEntry);
      }
    }
  }

  handleLeftMouseButtonDown(event: PointerEvent) {
    const mousePos: Vector2D = { x: event.clientX, y: event.clientY };

    /* FIXME:
    // Hide the context menu if outside of bounds but only if its a mouse event (not touch!)
    if (event.pointerType == "mouse")
      hideContextMenuIfOutside({ x: event.clientX, y: event.clientY });
    */

    // Return if mouse did not click in the content div as 
    // if (!isPointInsideDOMRect(mousePos, this.context.contentDivRef.getBoundingClientRect()))
    //   return;

    // Note that in this context, 'hoveredFileEntry' could also be called `pressedFileEntry`
    const { hoveredFileEntry } = this.context.state;

    if (hoveredFileEntry) {
      // Check for double clicks
      this.checkForDoubleClick(hoveredFileEntry, mousePos);

      // Update state
      this.lastLeftMousePressedFileEntry = hoveredFileEntry;
    } else {
      // TODO: check if clicked on context menu, or maybe propagation stop is enough, or maybe need to add 1ms timeout for this handler.
      if (!event.ctrlKey) {
        this.context.clearSelectionCallback();
      }
    }

    // Handle double clicks
    if (this.doubleClickContext.isDoubleClick && isVec2Equal(this.lastLeftMouseDownPos, mousePos)) {
      
    }

    this.context.processLeftMouseDownPosCallback(mousePos);

    // Update state
    this.lastLeftMouseClickTime = Date.now();
    this.lastLeftMouseDownPos = mousePos;
  }

  handleLeftMouseButtonUp(event: MouseEvent) {
    const { hoveredFileEntry } = this.context.state;

    if (hoveredFileEntry) {
      const hoveredFileEntryComms = this.context.state.communicationMap.get(hoveredFileEntry.handle)!;
      
      // If left mouse button releases on the same file entry as it was down on, then flip the selection state.
      if (this.fileEntryHandlesMatch(hoveredFileEntry, this.lastLeftMousePressedFileEntry)) {
        const lastSelectedFileEntry = this.lastLeftMouseSelectedFileEntry;

        // Handle range selections
        if (event.shiftKey && lastSelectedFileEntry) {
          // Ensure the last selected file entry is under the current browsing directory and is also selected 
          const lastSelectedFileEntryComms = this.context.state.communicationMap.get(lastSelectedFileEntry.handle);

          if (lastSelectedFileEntry && lastSelectedFileEntryComms) {
            if (lastSelectedFileEntry.parentHandle == this.context.getCurrentOpenDirectoryHandle()) {
              const lastSelectedPos = this.context.fileEntries().findIndex(entry => entry.handle == lastSelectedFileEntry.handle);
              const newSelectedPos = this.context.fileEntries().findIndex(entry => entry.handle == hoveredFileEntry.handle);

              const minIndex = Math.min(lastSelectedPos, newSelectedPos);
              const maxIndex = Math.max(lastSelectedPos, newSelectedPos);

              if (lastSelectedPos != undefined && newSelectedPos != undefined) {
                this.context.fileEntries().forEach((entry, index) => {
                  const comms = this.context.state.communicationMap.get(entry.handle);
                  
                  if (!comms) {
                    // This was commented because it seems to be normal behaviour now.
                    //console.error(`Couldn't find comms for entry with handle: ${entry.handle}`);
                    return;
                  }

                  // If in range, it should be selected
                  const shouldBeSelected = index >= minIndex && index <= maxIndex;

                  this.context.state.setSelected(entry, shouldBeSelected);
                });
              } else {
                console.error(`Couldn't find index during shift selecting! Last selected handle: ${lastSelectedFileEntry.handle}, new selected handle: ${hoveredFileEntry.handle}`);
              }
            }
          }
        } else if (!event.shiftKey) { // Handle individual selections
          // If multiple selection isn't enabled. Clear the selection first before flipping the state.
          if (!event.ctrlKey) {
            this.context.clearSelectionCallback();
          }
  
          this.lastLeftMouseSelectedFileEntry = hoveredFileEntry;
          this.context.state.setSelected(hoveredFileEntry, !hoveredFileEntryComms.isSelected);
        }
      }
    } else {
      if (!event.ctrlKey) {
        this.context.clearSelectionCallback();
      }
    }
  };

  handleRightClick(event: MouseEvent) {
    const mousePos: Vector2D = { x: event.clientX, y: event.clientY };
    
    // Past this point, only process right clicks that happened inside the content div's bounds.
    if (!isPointInsideDOMRect(mousePos, this.context.contentDivRef.getBoundingClientRect()))
      return;

    // Open the context menu since the mouse right clicked inside the content div's bounds
    this.context.openContextMenuCallback(mousePos);
  }

  // Event listeners
  onPointerDown = (event: PointerEvent) => {
    if (this.ignoreInputEvents)
      return;

    if (event.button == 0) {
      this.isLeftMouseButtonDown = true;

      if (event.pointerType == "mouse") {
        this.handleLeftMouseButtonDown(event);
      }
    } else if (event.button == 2) {
      this.handleRightClick(event);
    }
  }

  onPointerUp = (event: PointerEvent) => {
    if (this.ignoreInputEvents)
      return;

    if (event.button == 0) {
      this.isLeftMouseButtonDown = false;
      
      if (event.pointerType == "mouse") {
        this.handleLeftMouseButtonUp(event);
      }
    } else if (event.button == 2) {
      
    }
  }
};

export type {
  FileExplorerInputHandlerContext
}

export {
  FileExplorerInputHandler
}
