import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../common/commonUtils";
import { FILESYSTEM_COLUMN_WIDTHS } from "../client/columnWidths";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { getFileIconFromExtension } from "../client/fileTypes";
import { getFileExtensionFromName } from "../utility/fileNames";
import { FilesystemEntry } from "../client/userFilesystem";
import { Thumbnail } from "../client/thumbnails";
import { calculateImageConstrainedSize } from "../utility/imageSize";
import { FileExplorerState } from "./fileExplorer";
import { Vector2D } from "./contextMenu";

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
	const [ isSelected, setSelected ] = createSignal(false);
	const [ thumbnail, setThumbnail ] = createSignal<Thumbnail | null>(null);
	const [ imgSize, setImgSize ] = createSignal<Vector2D>({ x: 1, y: 1 });

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
	const sizeText = fileEntry.isFolder ? "" : getFormattedBytesSizeText(fileEntry.size, userSettings.dataSizeUnit);

	const dateAddedText = getDateAddedTextFromUnixTimestamp(
		fileEntry.dateAdded + userSettings.timezoneOffsetInMinutes * 60, // Apply user's timezone offset
		userSettings.useAmericanDateFormat
	);

	const comms = fileExplorerState.communicationMap.get(fileEntry.handle);
	
	if (comms === undefined) {
		console.error(`Communication for ${fileEntry.handle} is undefined!`);
		return;
	}

	// Edit communication map entry
	comms.setThumbnail = (thumbnail: Thumbnail) => {
		setThumbnail(thumbnail);
	};

	comms.getFileEntry = () => {
		return fileEntry;
	};

	comms.react = () => {
		setSelected(comms.isSelected);
	};

	// Update based on previous state due to virtual scrolling
	comms.react();

	// Event handlers
	const handleMouseEnter = (event: MouseEvent) => {
		fileExplorerState.hoveredFileEntry = fileEntry;
	}
	
	const handleMouseLeave = (event: MouseEvent) => {
		fileExplorerState.hoveredFileEntry = null;
	}

	const handleTouchStart = (event: TouchEvent) => {
		fileExplorerState.lastTouchedFileEntry = fileEntry;
	}

	const handleContextMenu = (event: any) => {
		// The context menu is not handled here
		event.preventDefault();
	}

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
			class={`flex flex-row flex-nowrap shrink-0 items-center h-8 border-b-[1px]
							${isSelected() ? "bg-blue-100 active:bg-blue-200" : "bg-zinc-100 hover:bg-zinc-200"}
					 		hover:cursor-pointer`}
			onContextMenu={handleContextMenu}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			onTouchStart={handleTouchStart}
		>
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
			<Column width={FILESYSTEM_COLUMN_WIDTHS.TYPE} noShrink>
				<ColumnText text={fileTypeText} matchParentWidth ellipsis/>
			</Column>
			<Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
				<ColumnText text={dateAddedText} matchParentWidth ellipsis/>
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
