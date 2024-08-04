import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { getFormattedByteSizeText, getTimestampFromUTCSeconds } from "../utility/commonUtils";
import { FILESYSTEM_COLUMN_WIDTHS } from "../client/columnWidths";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { getFileIconFromExtension } from "../client/fileTypes";
import { getFileExtensionFromName } from "../utility/fileNames";
import { FilesystemEntry } from "../client/userFilesystem";
import { Thumbnail } from "../client/thumbnails";
import { calculateImageConstrainedSize } from "../utility/imageSize";
import { FileExplorerState } from "./fileExplorer";
import { Vector2D } from "../client/vector";

// Icons
import FileFolderIcon from "../assets/icons/svg/files/file-folder.svg?component-solid";

type FileExplorerEntryProps = {
  fileExplorerState: FileExplorerState;
  fileEntry: FilesystemEntry;
  userSettings: UserSettings;

  // This is immediately called after
  requestThumbnailCallback: (fileEntry: FilesystemEntry) => Promise<Thumbnail | null>;
};

const FileExplorerEntry = (props: FileExplorerEntryProps) => {
  const { fileEntry, fileExplorerState, userSettings, requestThumbnailCallback } = props;
  const [ isSelected, setSelected ] = createSignal<boolean>(false);
  const [ thumbnail, setThumbnail ] = createSignal<Thumbnail | null>(null);
  const [ imgSize, setImgSize ] = createSignal<Vector2D>({ x: 1, y: 1 });
  const [ hoverOutlineVisible, setHoverOutlineVisible ] = createSignal<boolean>(false);

  createEffect(() => {
    // TODO: (different view modes = different file explorer entries)

    // If a thumbnail exists, calculate it's scaled size for the <img> component
    const thumb = thumbnail();

    if (thumb) {
      const scaledDimensions = calculateImageConstrainedSize({ x: thumb.width, y: thumb.height }, { x: 29, y: 25 });
      setImgSize(scaledDimensions);
    }
  });

  // Get file extension and determine type text
  const fileExtension = getFileExtensionFromName(fileEntry.name);
  const fileTypeText = (fileEntry.isFolder ? "Folder" : (fileExtension.toUpperCase() + " file"));	

  // Only show size text when file entry is not a folder
  const sizeText = fileEntry.isFolder ? "" : getFormattedByteSizeText(fileEntry.size, userSettings.dataSizeUnit);

  const dateAddedText = getTimestampFromUTCSeconds(
    fileEntry.dateAdded + userSettings.timezoneOffsetInMinutes * 60, // Apply user's timezone offset
    userSettings.useAmericanDateFormat
  );

  const comms = fileExplorerState.communicationMap.get(fileEntry.handle);
  
  if (comms === undefined) {
    console.error(`Communication for ${fileEntry.handle} is undefined!`);
    return;
  }

  // Communication map
  comms.setThumbnail = (thumbnail: Thumbnail) => setThumbnail(thumbnail);
  comms.getFileEntry = () => fileEntry;

  comms.react = () => {
    setSelected(comms.isSelected);
    setHoverOutlineVisible(comms.showHoverOutline);
  };

  // Immediately react due to virtual scrolling which means entries are created and destroyed.
  comms.react();

  // Event handlers
  const handlePointerEnter = (event: PointerEvent) => {
    if (event.pointerType == "mouse") {
      fileExplorerState.hoveredFileEntry = fileEntry;
    }
  };
  
  const handlePointerLeave = (event: PointerEvent) => {
    if (event.pointerType == "mouse") {
      fileExplorerState.hoveredFileEntry = null;
    }
  };

  const handleTouchStart = (event: TouchEvent) => {
    fileExplorerState.touchedFileEntry = fileEntry;
  };

  const handleContextMenu = (event: any) => {
    // The context menu is not handled here
    event.preventDefault();
  };

  onMount(async () => {
    // Request thumbnail
    const thumbnail = await requestThumbnailCallback(fileEntry);

    if (thumbnail !== null) {
      setThumbnail(thumbnail);
    }
  });

  onCleanup(() => {
    comms.setThumbnail = undefined;
    comms.getFileEntry = undefined;
    comms.react = undefined;
  });

  return (
    <div
      class={`
        flex flex-row flex-nowrap shrink-0 items-center h-8 border-b-[1px] hover:cursor-pointer
        ${isSelected() ? "bg-blue-200 active:bg-blue-300" : "bg-zinc-100 hover:bg-zinc-200"}
      `}
      onContextMenu={handleContextMenu}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onTouchStart={handleTouchStart}
    >
      {
        hoverOutlineVisible() &&
        <div class="absolute w-full h-full border-[1px] border-blue-500 bg-opacity-5 bg-blue-700 pointer-events-none" />
      }
      <div class={`flex justify-center items-center h-full aspect-[1.2]`}>
        {
          thumbnail() ? (
            <img
              class="ml-2 select-none"
              src={thumbnail()!.blobUrl}
              width={imgSize().x}
              height={imgSize().y}
            />
          ) : (
            fileEntry.isFolder ? (
              <FileFolderIcon class="ml-2 w-6 h-6" />
            ) : (
              getFileIconFromExtension(fileExtension)
            )
          )
        }
      </div>
      <Column width={FILESYSTEM_COLUMN_WIDTHS.NAME} noShrink>
        <ColumnText text={fileEntry.name} matchParentWidth ellipsis/>
      </Column>
      <Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
        <ColumnText text={dateAddedText} matchParentWidth ellipsis/>
      </Column>
      <Column width={FILESYSTEM_COLUMN_WIDTHS.TYPE} noShrink>
        <ColumnText text={fileTypeText} matchParentWidth ellipsis/>
      </Column>
      <Column width={FILESYSTEM_COLUMN_WIDTHS.SIZE} noShrink>
        <ColumnText text={sizeText} matchParentWidth ellipsis/>
      </Column>
    </div>
  );
}

export type {
  FileExplorerEntryProps
}

export {
  FileExplorerEntry
}
