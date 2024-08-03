import { Accessor } from "solid-js";
import { FileExplorerState, FilesystemEntry } from "../../components/fileExplorer";
import { isVec2Equal, isPointInsideDOMRect, Vector2D, getVec2Distance } from "../vector";
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

  currentOpenDirectoryHandle: () => string
};

type FileExplorerInputHandlerCallbacks = {
  openDirectory: (directoryHandle: string) => void,
  openContextMenu: (mousePos: Vector2D) => void,
  clearSelection: () => void,

  /** This is called when the user double clicks on a file entry using the left mouse button. */
  doubleClickedOnFile: (fileEntry: FilesystemEntry) => void,

  /** Used for closing the context menu if the mouse was pressed down outside its bounds. */
  processLeftMouseDownPos: (mousePos: Vector2D) => void,

  /** Called whenever the mouse moves while held down and is dragging file entries. */
  processDrag: (
    draggedEntries: FilesystemEntry[],
    hoveredFileEntry: FilesystemEntry | null,
    startDragMousePos: Vector2D,
    mousePos: Vector2D
  ) => void,

  /** Called whenever the drag stops */
  endDrag: (
    draggedEntries: FilesystemEntry[],
    hoveredFileEntry: FilesystemEntry | null,
    mousePos: Vector2D
  ) => void
};

class FileExplorerInputHandler {
  context: FileExplorerInputHandlerContext;
  callbacks: FileExplorerInputHandlerCallbacks;
  doubleClickContext: DoubleClickContext;

  // Mouse state
  isLeftMouseButtonDown: boolean;
  lastLeftMouseClickTime: number;
  lastLeftMouseDownPos: Vector2D;
  lastLeftMousePressedFileEntry: FilesystemEntry | null;
  isDragging: boolean;

  /** 
   * An array of file entries that are being dragged with the left mouse button.
   * It will be cleared when the mouse button releases.
   */
  heldEntities: FilesystemEntry[];

  /** The handle of the file entry that was last selected individually and not through a range selection. */
  lastLeftMouseSelectedFileEntry: FilesystemEntry | null;

  // Touch state

  /** Whether or not to ignore input events and not process them. */
  ignoreInputEvents: boolean;
  
  constructor(
    context: FileExplorerInputHandlerContext,
    callbacks: FileExplorerInputHandlerCallbacks
  ) {
    this.context = context;
    this.callbacks = callbacks;

    this.ignoreInputEvents = false;
    this.isLeftMouseButtonDown = false;
    this.lastLeftMouseClickTime = 0;
    this.lastLeftMousePressedFileEntry = null;
    this.lastLeftMouseSelectedFileEntry = null;
    this.lastLeftMouseDownPos = Vector2D.zero;
    this.isDragging = false;
    this.heldEntities = [];

    // Initialise double click context
    this.doubleClickContext = {
      lastLeftClickEventTime: 0,
      lastPressedFileHandle: "",
      isDoubleClick: false
    };
    
    // Add event listeners
    document.addEventListener("pointerdown", this.onPointerDown);
    document.addEventListener("pointerup", this.onPointerUp);
    document.addEventListener("pointermove", this.onPointerMove);
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
    document.removeEventListener("pointerup", this.onPointerUp);
    document.removeEventListener("pointermove", this.onPointerMove);
  }

  // Utility functions

  /** Selects all the file entries between two file entries in the file explorer (inclusive). */
  private selectAllFileEntriesBetween(entryA: FilesystemEntry, entryB: FilesystemEntry) {
    const lastSelectedPos = this.context.fileEntries().findIndex(entry => entry.handle == entryA.handle);
    const newSelectedPos = this.context.fileEntries().findIndex(entry => entry.handle == entryB.handle);

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
      console.error(`Couldn't find index during shift selecting! Entry A: ${entryA.handle}, entry B: ${entryB.handle}`);
    }
  }

  /** Checks that two filesystem entries have handles that match. If either entry is null, then false is always returned. */
  private fileEntryHandlesMatch(lhs: FilesystemEntry | null, rhs: FilesystemEntry | null) {
    if (lhs == null || rhs == null)
      return false;

    if (lhs.handle == rhs.handle)
      return true;

    return false;
  }

  // Functions for mouse events
  private handleMouseDoubleClickOnFileEntry(fileEntry: FilesystemEntry) {
    if (fileEntry.isFolder) {
      // Clear hovered file entry because we just opened this folder (MUST BE DONE! or else the stupid folder path ribbon and escape bug comes back)
      // TODO: explain this better by recreating the problem
      // EDIT: idk what the issue even was now that i look back... welp!
      this.context.state.hoveredFileEntry = null;

      // Open folder
      this.callbacks.openDirectory(fileEntry.handle);
    } else {
      this.callbacks.doubleClickedOnFile(fileEntry);
      this.callbacks.clearSelection();
    }
  }

  /** Only to be called when the left mouse button has been pressed */
  private checkForDoubleClick(pressedFileEntry: FilesystemEntry, mousePos: Vector2D) {
    // It's only a valid double click if the user clicked twice on the same handle in a short time.
    if (Date.now() - this.lastLeftMouseClickTime < CONSTANTS.DOUBLE_CLICK_TIME_THRESHOLD_MS) {
      const mouseDidntMove = isVec2Equal(this.lastLeftMouseDownPos, mousePos);
      const samePressedEntry = this.fileEntryHandlesMatch(this.lastLeftMousePressedFileEntry, pressedFileEntry);
      
      if (mouseDidntMove && samePressedEntry) {
        this.handleMouseDoubleClickOnFileEntry(pressedFileEntry);
      }
    }
  }

  private handleLeftMouseButtonDown(event: PointerEvent) {
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
        this.callbacks.clearSelection();
      }
    }
    
    this.callbacks.processLeftMouseDownPos(mousePos);
    
    // Update state
    this.lastLeftMouseClickTime = Date.now();
    this.lastLeftMouseDownPos = mousePos;
  }

  handleLeftMouseButtonUp(event: MouseEvent) {
    const currentOpenDirectoryHandle = this.context.currentOpenDirectoryHandle();
    const mousePos: Vector2D = { x: event.clientX, y: event.clientY };
    const { hoveredFileEntry } = this.context.state;

    if (this.isDragging) {
      // End dragging
      this.isDragging = false;
      this.callbacks.endDrag(this.heldEntities, hoveredFileEntry, mousePos);
      this.heldEntities = [];
    } else {
      if (hoveredFileEntry) {
        const hoveredFileEntryComms = this.context.state.communicationMap.get(hoveredFileEntry.handle)!;
        
        // If left mouse button releases on the same file entry as it was down on, then flip the selection state.
        if (this.fileEntryHandlesMatch(hoveredFileEntry, this.lastLeftMousePressedFileEntry)) {
          const lastSelectedFileEntry = this.lastLeftMouseSelectedFileEntry;
  
          // Handle range selections
          if (event.shiftKey && lastSelectedFileEntry) {
            // Ensure the last selected file entry is under the current browsing directory
            if (lastSelectedFileEntry && lastSelectedFileEntry.parentHandle == currentOpenDirectoryHandle) {
              this.selectAllFileEntriesBetween(lastSelectedFileEntry, hoveredFileEntry);  
            }
          } else if (!event.shiftKey) { // Handle individual selections
            // If multiple selection isn't enabled. Clear the selection first before flipping the state.
            if (!event.ctrlKey) {
              this.callbacks.clearSelection();
            }
    
            this.lastLeftMouseSelectedFileEntry = hoveredFileEntry;
            this.context.state.setSelected(hoveredFileEntry, !hoveredFileEntryComms.isSelected);
          }
        }
      } else {
        if (!event.ctrlKey) {
          this.callbacks.clearSelection();
        }
      }
    }
  };

  handleRightClick(event: MouseEvent) {
    const mousePos: Vector2D = { x: event.clientX, y: event.clientY };
    
    // Past this point, only process right clicks that happened inside the content div's bounds.
    if (!isPointInsideDOMRect(mousePos, this.context.contentDivRef.getBoundingClientRect()))
      return;

    // Open the context menu since the mouse right clicked inside the content div's bounds
    this.callbacks.openContextMenu(mousePos);
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

  onPointerMove = (event: PointerEvent) => {
    if (this.ignoreInputEvents)
      return;

    const mousePos: Vector2D = { x: event.clientX, y: event.clientY };
    const distanceAboveThreshold = getVec2Distance(mousePos, this.lastLeftMouseDownPos) > CONSTANTS.START_DRAG_DISTANCE_THRESHOLD;
    const { hoveredFileEntry } = this.context.state;

    console.log(hoveredFileEntry?.handle);

    if (this.lastLeftMousePressedFileEntry) {
      const lastPressedEntryIsSelected = this.context.state.isSelected(this.lastLeftMousePressedFileEntry.handle);

      if (lastPressedEntryIsSelected && distanceAboveThreshold && this.isLeftMouseButtonDown && !this.isDragging) {
        this.isDragging = true;
  
        if (hoveredFileEntry) {
          const mouseHoveringSelectedEntry = this.context.state.isSelected(hoveredFileEntry.handle);
  
          if (mouseHoveringSelectedEntry) {
            // Set held entities
            this.heldEntities = [];
            this.context.state.selectedFileEntrySet.forEach(entry => this.heldEntities.push(entry));
          }
        }
      }
    }

    if (this.isDragging) {
      this.callbacks.processDrag(this.heldEntities, hoveredFileEntry, this.lastLeftMouseDownPos, mousePos);
    }
  }
};

export type {
  FileExplorerInputHandlerContext,
  FileExplorerInputHandlerCallbacks
}

export {
  FileExplorerInputHandler
}
