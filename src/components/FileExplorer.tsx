import { createSignal, For } from "solid-js";
import { getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../utility/formatting";
import { FILESYSTEM_COLUMN_WIDTHS } from "../utility/enums";
import { uploadFileToServer } from "../utility/transfers";
import { UploadFileEntry, UploadFilesPopup } from "./UploadFilesPopup";
import { Column, ColumnText } from "./Column";
import { UserSettings } from "../utility/usersettings";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import SplitLayoutIcon from "../assets/icons/svg/split-layout.svg?component-solid";
import RightAngleArrowIcon from "../assets/icons/svg/right-angle-arrow.svg?component-solid";
import UploadIcon from "../assets/icons/svg/upload.svg?component-solid";

// TODO: error popups! + disallow user from uploading a file to a target folder, then deleting that folder while in progress (moving or renaming destination shouldnt matter, as it has a handle)
// TODO: remove all the state crap

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
	typeInfoText: string, // This is what shows on the user's screen in the type column
	dateAdded: number
};

type FileExplorerWindowProps = {
	userSettings: UserSettings,
	globalFileEntries: FilesystemEntry[],
	visible: boolean,
};

type FileExplorerProps = {
	parentWindowProps: FileExplorerWindowProps,
};

const [ splitViewMode, setSplitViewMode ] = createSignal(false);

// The actual file explorer component
const FileExplorer = (props: FileExplorerProps) => {
	const { parentWindowProps } = props;
	const userSettings: UserSettings = parentWindowProps.userSettings;

	// This stores all the metadata of files in the user's current filepath.
	// When setFileEntries() is called, the DOM will update with the new entries.
	const [ fileEntries, setFileEntries ] = createSignal<FilesystemEntry[]>([]); // TODO: globalFileEntries should not be used, only one directory (root by default) is viewable at a time

	let searchText: string = "";
	let [ sortMode, setSortMode ] = createSignal<FileListSortMode>(FileListSortMode.Name);
	let [ sortAscending, setSortAscending ] = createSignal<boolean>(true);
	
	// This function populates the file list with file entries defined in the 'fileEntries' signal.
	const refreshFileList = () => {
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
				entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
			} else {
				entries.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" }));
			}
		} else if (sortMode() == FileListSortMode.Type) {
			if (sortAscending()) {
				entries.sort((a, b) => a.typeInfoText.localeCompare(b.typeInfoText, undefined, { numeric: true, sensitivity: "base" }));
			} else {
				entries.sort((a, b) => b.typeInfoText.localeCompare(a.typeInfoText, undefined, { numeric: true, sensitivity: "base" }));
			}
		} else if (sortMode() == FileListSortMode.Size) {
			if (sortAscending()) {
				entries.sort((a, b) => a.size - b.size);
			} else {
				entries.sort((a, b) => b.size - a.size);
			}
		} else if (sortMode() == FileListSortMode.DateAdded) {
			if (sortAscending()) {
				entries.sort((a, b) => a.dateAdded - b.dateAdded);
			} else {
				entries.sort((a, b) => b.dateAdded - a.dateAdded);
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
					} else {
						// Flip state only when the current store mode is the same as this button's sort mode
						setSortAscending(!sortAscending());
						setRotation(sortAscending() ? 0 : 180);
					}

					refreshFileList();
				}}
				// Make button visible when hovering over it while it's invisible by default (if its not of the current sort type)
				onmouseenter={() => setForceVisible(true) }
				onmouseleave={() => setForceVisible(false) }
			/>
		);
	};
	
	// This component is used
	const FileEntryColumnText = (props: any) => {
		return (
			<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-[0.825em] overflow-ellipsis font-normal whitespace-nowrap select-none">{props.text}</h1>
		);
	};

	// The file entry component
	const FileEntry = (entry: FilesystemEntry) => {
		let sizeText = getFormattedBytesSizeText(entry.size);
		let dateAddedText = getDateAddedTextFromUnixTimestamp(entry.dateAdded, userSettings.useAmericanDateFormat);

		return (
			<div class="flex flex-row flex-nowrap flex-start flex-shrink-0 items-center overflow-x-hidden w-[100%] h-8 border-b-[1px] bg-zinc-100">
				<div class={`flex justify-center items-center h-[100%] aspect-[1.2]`}>
					<div class="aspect-square ml-2 h-[80%] bg-indigo-500">

					</div>
				</div>
				<Column width={FILESYSTEM_COLUMN_WIDTHS.NAME} noShrink>
					<FileEntryColumnText text={entry.name}/>
				</Column>
				<Column width={FILESYSTEM_COLUMN_WIDTHS.TYPE} noShrink>
					<FileEntryColumnText text={entry.typeInfoText}/>
				</Column>
				<Column width={FILESYSTEM_COLUMN_WIDTHS.SIZE} noShrink>
					<FileEntryColumnText text={sizeText}/>
				</Column>
				<Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
					<FileEntryColumnText text={dateAddedText}/>
				</Column>
			</div>
		);
	}

	// Initialise the file list
	refreshFileList();

	// Handle upload window drag events
	const [ uploadWindowVisible, setUploadWindowVisible ] = createSignal(false);

	// Upload
	const uploadPopupCallback = (fileEntries: UploadFileEntry[]) => {
		//navigator.vibrate(200);
		setUploadWindowVisible(false);

		fileEntries.forEach((entry) => {
			const file: File = entry.file;

			uploadFileToServer(file)
			.then((result: any) => {
				if (result) {
					const success = result.success;
					const handle = result.handle;

					if (!success) {
						console.error("Upload did not return success!");
						return;
					}

					console.log(`Upload finished!`);
					console.log(`Finalise transfer handle: ${handle}`);

					// Finalise upload
					fetch("/api/transfer/finaliseupload", {
						method: "POST",
						headers: {
							"Content-Type": "application/json"
						},
						body: JSON.stringify({
							handle: handle
						})
					});
				} else {
					console.log("No reponse data?");
				}
			})
			.catch((error: any) => {
				const reasonMessage = error.reasonMessage;
				console.error(`Upload cancelled for reason: ${reasonMessage}`);
			});
		});
	};

	return (
		<div class="relative flex flex-col w-[100%] h-[100%] min-w-[550px]">
			<UploadFilesPopup
				visibilityGetter={uploadWindowVisible}
				uploadCallback={uploadPopupCallback}
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
					class={`aspect-square w-[27px] h-[27px] ml-3 p-[3px] rounded-md invert-[20%]
									hover:cursor-pointer hover:bg-zinc-100 active:bg-zinc-300 ${uploadWindowVisible() ? "bg-zinc-100" : ""}`}
					onClick={() => {
						setUploadWindowVisible(!uploadWindowVisible());
					}}
				/>
				<SplitLayoutIcon
					class={`aspect-square w-[27px] h-[27px] ml-2 mr-4 p-[3px] rounded-md invert-[20%]
									hover:cursor-pointer hover:bg-zinc-100 active:bg-zinc-300 ${splitViewMode() ? "bg-zinc-100" : ""}`}
					onClick={() => {
						let newState = !splitViewMode();
						setSplitViewMode(newState);
					}}
				/>
			</div>
			<div class="flex flex-col w-[100%] overflow-auto bg-zinc-300">
				<div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"> {/* Column headers bar */}
					<div class={`h-[100%] aspect-[1.95]`}></div> {/* Icon column (empty) */}
					<Column width={FILESYSTEM_COLUMN_WIDTHS.NAME} noShrink>
						<ColumnText text="Name" semibold/>
						<SortButton sortAscending={true} sortMode={FileListSortMode.Name} />
					</Column>
					<Column width={FILESYSTEM_COLUMN_WIDTHS.TYPE} noShrink>
						<ColumnText text="Type" semibold/>
						<SortButton sortAscending={true} sortMode={FileListSortMode.Type} />
					</Column>
					<Column width={FILESYSTEM_COLUMN_WIDTHS.SIZE} noShrink>
						<ColumnText text="Size" semibold/>
						<SortButton sortAscending={true} sortMode={FileListSortMode.Size} />
					</Column>
					<Column width={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
						<ColumnText text="Date added" semibold/>
						<SortButton sortAscending={true} sortMode={FileListSortMode.DateAdded} />
					</Column>
				</div>
				<For each={fileEntries()}>
					{(entryInfo, index) => (
						<FileEntry
							{...entryInfo}
						/>
					)}
				</For>
			</div>
		</div>
	);
}

// 'FileExplorerWindow' can hold one or multiple 'FileExplorer' components
function FileExplorerWindow(props: FileExplorerWindowProps) {
	const { userSettings, globalFileEntries } = props;
	let splitViewLeftWidth = 50;

	// Split view mode dragging resize functionality
	const [ leftWidth, setLeftWidth ] = createSignal(splitViewLeftWidth);
	const [ rightWidth, setRightWidth ] = createSignal(100 - splitViewLeftWidth);
	const [ dragging, setDragging ] = createSignal(false);
	let startDraggingX = 0;
	let startDraggingLeftWidth = 0;

	const handleMouseDown = (event: any) => {
		startDraggingX = event.clientX;
		startDraggingLeftWidth = leftWidth();
		setDragging(true);
	}

	const handleMouseUp = (event: any) => {
		setDragging(false);
	}

	const handleMouseMove = (event: any) => {
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
		splitViewLeftWidth = newLeftWidth;
		setRightWidth(100 - newLeftWidth);
	};

	document.addEventListener("mousemove", handleMouseMove);
	document.addEventListener("mouseup", handleMouseUp);

	return (
		<div
			id="file-explorer-window"
			class={`flex flex-row h-[100%]`}
			style={`${props.visible ? "width: 100%;" : "width: 0;"}`}
		>
			<div class="flex flex-row overflow-auto" style={`width: ${splitViewMode() ? leftWidth() : 100}%`}>
				<FileExplorer parentWindowProps={props} />
			</div>
			<div
				class={`flex flex-row h-[100%]`}
				style={`
					width: ${rightWidth()}%;
					visibility: ${!splitViewMode() && "hidden"};
					${!splitViewMode() && "position: absolute;"}
				`}
			>
				<div class={`bg-zinc-300 w-[3px] h-[100%] hover:cursor-ew-resize`} onMouseDown={handleMouseDown}> {/* Draggable separator for the two windows */}

				</div>
				<div class="flex flex-row overflow-auto w-[100%]" style={`width: 100%`}>
					<FileExplorer parentWindowProps={props} />
				</div>
			</div>
		</div>
	);
}

export type { FilesystemEntry };

export {
	FileExplorerWindow,
	FileCategory
};
