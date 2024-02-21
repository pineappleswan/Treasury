import { createSignal } from "solid-js";
import { getFormattedBPSText, getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../utility/formatting";
import { TRANSFER_STATUS, TRANSFER_LIST_COLUMN_WIDTHS } from "../utility/enums";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import RightAngleArrowIcon from "../assets/icons/svg/right-angle-arrow.svg?component-solid";

let columnWidthDivider = Object.values(TRANSFER_LIST_COLUMN_WIDTHS).reduce((a, b) => a + b, 0) / 100;

// Constructs a transfer entry object that can be appended to 'transferEntries()'
// class and updated with setTransferEntries()
const createTransferEntry = (handle, fileName, fileSize, fileType) => {
	// Type checking
	if (typeof(handle) != "string") throw new TypeError("handle must be a string!");
	if (typeof(fileName) != "string") throw new TypeError("fileName must be a string!");
	if (typeof(fileSize) != "number") throw new TypeError("fileSize must be a number!");
	if (typeof(fileType) != "string") throw new TypeError("fileType must be a string!");

	return {
		handle: handle,
		fileName: fileName,
		fileType: fileType,
		fileSize: fileSize,
		transferSpeed: 0,
		transferredBytes: 0,
		timeLeft: 0,
		uploadStartTime: 0, // should be new Date() or something
		status: TRANSFER_STATUS.IN_QUEUE
	};
}

// Generate mock file entries data (TODO: this is temporary)
let transferEntriesData = [];

for (let i = 0; i < 100; i++) {
	let handle = Math.floor(Math.random() * 100);
	let dateAdded = (new Date()) / 1000;
	dateAdded = dateAdded + (Math.random() - 0.5) * 10000;

	try {
		let entry = createTransferEntry(
			handle.toString(),
			handle.toString(),
			Math.random() * 100000000,
			"png"
		);

		transferEntriesData.push(entry);
	} catch (error) {
		console.error(error);
	}
}

function TransferListWindow(props) {
	// This stores all the metadata of files in the user's currentl filepath.
	// When setTransferEntries() is called, the DOM will update with the new entries.
	const [ transferEntries, setTransferEntries ] = createSignal([]);

	// This function populates the file list with file entries defined in the 'transferEntries' signal.
	const refreshFileList = () => {
		let entries = transferEntriesData;

		// Filter by search text if applicable
		let searchText = props.state.searchText;

		if (searchText != undefined) {
			entries = entries.filter(entry => {
				let findIndex = entry.fileName.toLowerCase().search(searchText.toLowerCase());
				return findIndex != -1;
			});
		}

		let sortMode = props.state.sortMode;
		let sortAscending = props.state.sortAscending;

		// Sort
		// TODO: fixed sort algorithm prioritising queue position

		/*
		if (sortMode == TRANSFER_LIST_SORT_MODES.NAME) {
			if (sortAscending) {
				entries.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" }));
			} else {
				entries.sort((a, b) => b.fileName.localeCompare(a.fileName, undefined, { numeric: true, sensitivity: "base" }));
			}
		} else if (sortMode == TRANSFER_LIST_SORT_MODES.TYPE) {
			if (sortAscending) {
				entries.sort((a, b) => a.fileType.localeCompare(b.fileType, undefined, { numeric: true, sensitivity: "base" }));
			} else {
				entries.sort((a, b) => b.fileType.localeCompare(a.fileType, undefined, { numeric: true, sensitivity: "base" }));
			}
		} else if (sortMode == TRANSFER_LIST_SORT_MODES.SIZE) {
			if (sortAscending) {
				entries.sort((a, b) => a.fileSize > b.fileSize);
			} else {
				entries.sort((a, b) => a.fileSize < b.fileSize);
			}
		} else if (sortMode == TRANSFER_LIST_SORT_MODES.DATE_ADDED) {
			if (sortAscending) {
				entries.sort((a, b) => a.dateAdded > b.dateAdded);
			} else {
				entries.sort((a, b) => a.dateAdded < b.dateAdded);
			}
		} else {
			throw new Error(`Invalid sort mode!`);
		}
		*/

		setTransferEntries(entries);
	};

	// Handles search bar functionality
	const onSearchBarKeypress = (event) => {
		if (event.keyCode != 13)
			return;

		props.state.searchText = event.target.value;

		// Unfocus the search bar
		event.target.blur();

		try {
			refreshFileList();
		} catch (error) {
			console.error(`SEARCH FAILED FOR REASON: ${error}`);
		}
	}

	// Creates a div with a relative width to other columns that add up to be the total width of the column's parent div
	const Column = (props) => {
		return (
			<div style={`width: ${props.relativeWidth / columnWidthDivider}%;`}
						class={`flex items-center h-[100%]`}>
				{props.children}
			</div>
		);
	};
	
	const ColumnHeaderText = (props) => {
		// TODO: marginSize not needed

		return (
			<h1 
				class={`
					${props.marginSize ? `ml-${props.marginSize}` : ""}
					font-SpaceGrotesk text-zinc-900 text-sm overflow-ellipsis font-medium whitespace-nowrap select-none
				`}
			>{props.text}</h1>
		);
	};
	
	// This component is used TODO
	const TransferEntryColumnText = (props) => {
		return (
			<h1
				class={`
					${props.marginSize ? `ml-${props.marginSize}` : "ml-2"} font-SpaceGrotesk text-zinc-900 text-[0.825em] overflow-ellipsis
					${props.bold ? "font-bold" : "font-normal"}
					whitespace-nowrap select-none
				`}
			>{props.text}</h1>
		);
	};

	// The file entry component
	const TransferEntry = (props) => {
		let fileTypeText = props.fileType
		let timeLeftText = props.timeLeft;
		let speedText = props.transferSpeed;
		let sizeText = getFormattedBytesSizeText(props.fileSize);
		let transferredBytesText = getFormattedBytesSizeText(0);

		// Get rid of the suffix
		//transferredBytesText = transferredBytesText.split(" ")[0]

		return (
			<div class="flex flex-row flex-nowrap flex-start flex-shrink-0 items-center overflow-x-hidden w-[100%] h-8 border-b-[1px] bg-zinc-100">
				<div class={`flex justify-center items-center h-[100%] aspect-[1.2]`}>
					<div class="aspect-square ml-2 h-[80%] bg-indigo-500">

					</div>
				</div>
				<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.NAME}>
					<TransferEntryColumnText text={props.fileName}/>
				</Column>
				<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.SIZE}>
					<TransferEntryColumnText text={sizeText}/>
				</Column>
				<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS}>
					<TransferEntryColumnText text={transferredBytesText}/>
					<TransferEntryColumnText text={"/ " + sizeText} marginSize={1} bold/>
				</Column>
			</div>
		);
	}

	// Initialise the file list
	refreshFileList();

	return (
		<div class="flex flex-row w-[100%] h-[100%] overflow-auto">
			<div id="file-explorer-window" class="flex flex-row w-[100%] h-[100%]">
				<div class="w-[100%] h-[100%] flex flex-col min-w-[550px]"> {/* Style is used for width so it can be resized dynamically using JS */}
					<div class="flex flex-col px-2 items-center flex-shrink-0 w-[100%] bg-zinc-200"> {/* Search bar and column headers */}
						<div class="flex flex-row items-center justify-start w-[100%] h-10 my-1.5 bg-zinc-50 rounded-full border-2 border-zinc-300"> 
							<MagnifyingGlassIcon class="aspect-square w-5 h-5 invert-[20%] ml-3" />
							<input
								type="text"
								placeholder="Search"
								class="flex-grow ml-2 mr-6 outline-none bg-transparent font-SpaceGrotesk text-medium text-[0.95em]"
								onKeyPress={onSearchBarKeypress}
							/>
						</div>
						<div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"> {/* Column headers bar */}
							<div class={`h-[100%] aspect-[1.95]`}></div> {/* Icon column (empty) */}
							<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.NAME}>
								<ColumnHeaderText text="Name" />
							</Column>
							<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.SIZE}>
								<ColumnHeaderText text="Size"/>
							</Column>
							<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS}>
								<ColumnHeaderText text="Progress"/>
							</Column>
						</div>
					</div>
					<div class="flex flex-col w-[100%] overflow-auto bg-zinc-300">
						<For each={transferEntries()}>
							{(entryInfo, index) => (
								<TransferEntry
									{...entryInfo}
								/>
							)}
						</For>
					</div>
				</div>
			</div>
		</div>
	);
}

export default TransferListWindow;
