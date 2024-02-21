import { createEffect, createSignal, onCleanup } from "solid-js";
import { getFormattedBPSText, getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../utility/formatting";
import { TRANSFER_STATUS, TRANSFER_LIST_COLUMN_WIDTHS } from "../utility/enums";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import PauseIcon from "../assets/icons/svg/pause.svg?component-solid"
import FinishedTransferTick from "../assets/icons/svg/finished-transfer-tick.svg?component-solid"
import UploadingArrow from "../assets/icons/svg/uploading-arrow.svg?component-solid"
import DownloadingArrow from "../assets/icons/svg/downloading-arrow.svg?component-solid"
import FailedTransferCross from "../assets/icons/svg/failed-transfer-cross.svg?component-solid"

let columnWidthDivider = Object.values(TRANSFER_LIST_COLUMN_WIDTHS).reduce((a, b) => a + b, 0) / 100;

// Constructs a transfer entry object that can be appended to 'transferEntries()'
// class and updated with setTransferEntries()
function createTransferEntry(handle, fileName, transferSize) {
	// Type checking
	if (typeof(handle) != "string") throw new TypeError("handle must be a string!");
	if (typeof(fileName) != "string") throw new TypeError("fileName must be a string!");
	if (typeof(transferSize) != "number") throw new TypeError("transferSize must be a number!");

	return {
		handle: handle,
		fileName: fileName,
		transferSize: transferSize,
		transferredBytes: 0,
		transferSpeed: 0,
		timeLeft: 0,
		uploadStartTime: 0, // should be new Date() or something
		status: TRANSFER_STATUS.WAITING
	};
}

function TransferListWindow(props) {
	const { transferEntriesData } = props;

	// This stores all the metadata of files in the user's currentl filepath.
	// When setTransferEntries() is called, the DOM will update with the new entries.
	const [ transferEntries, setTransferEntries ] = createSignal([]);

	// This function refreshes the file list and sorts the data
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
		
		/*
		entries.sort((a, b) => {
			if (a.status == TRANSFER_STATUS.FINISHED && b.status == TRANSFER_STATUS.FINISHED) {
				return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" });
			} else if (a.status == TRANSFER_STATUS.FINISHED) {
				return true;
			} else if (b.status == TRANSFER_STATUS.FINISHED) {
				return false;
			} else {
				let progressA = a.transferredBytes / a.transferSize;
				let progressB = b.transferredBytes / b.transferSize;
				
				return progressA < progressB;
			}
		});
		*/
		
		// Sort
		entries.sort((a, b) => {
			return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" });
		});

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
					${props.marginSize ? `ml-${props.marginSize}` : "ml-2"}
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
					${props.marginSize != undefined ? `ml-${props.marginSize}` : "ml-2"} font-SpaceGrotesk text-zinc-900 text-[0.825em] overflow-ellipsis
					${props.bold ? "font-bold" : (props.semibold ? "font-semibold" : "font-normal")}
					whitespace-nowrap select-none
				`}
			>{props.text}</h1>
		);
	};

	// The file entry component
	const TransferEntry = (props) => {
		const [ status, setStatus ] = createSignal(TRANSFER_STATUS.WAITING);
		const [ statusText, setStatusText ] = createSignal("Waiting...");
		const [ boldStatusText, setStatusTextBold ] = createSignal(false);
		const [ progressPercentage, setProgressPercentage ] = createSignal(0);
		const [ transferredBytesText, setTransferredBytesText ] = createSignal(getFormattedBytesSizeText(0));
		const [ transferSizeText, setTransferSizeText ] = createSignal("/ " + getFormattedBytesSizeText(props.transferSize));

		// Listen for property changes periodically
		createEffect(() => {
			const update = () => {
				// Update status constantly
				setStatus(props.status);

				let progressPercentage = Math.min((props.transferredBytes / props.transferSize), 1);
				setProgressPercentage(progressPercentage);

				if (status() == TRANSFER_STATUS.WAITING) {
					setStatusText("Waiting...");
					setStatusTextBold(false);
				} else if (status() == TRANSFER_STATUS.FINISHED) {
					setTransferredBytesText("");
					setStatusText("");
					setTransferSizeText(getFormattedBytesSizeText(props.transferSize));
				} else if (status() == TRANSFER_STATUS.FAILED) {
					setTransferredBytesText("");
					setStatusText("FAILED");
					setTransferSizeText(getFormattedBytesSizeText(props.transferSize));
				} else {
					setTransferredBytesText(getFormattedBytesSizeText(props.transferredBytes));
					setStatusTextBold(true);
					
					if (status() == TRANSFER_STATUS.UPLOADING) {
						setStatusText("Uploading...");
					} else if (status() == TRANSFER_STATUS.DOWNLOADING) {
						setStatusText("Downloading...");
					}

					// Stop
					// clearInterval(interval);
				}
			};

			update();
			const interval = setInterval(update, 1000);
			onCleanup(() => clearInterval(interval));
		});

		let fileTypeText = props.fileType
		let speedText = props.transferSpeed;

		return (
			<div class="flex flex-row flex-nowrap flex-start flex-shrink-0 items-center overflow-x-hidden w-[100%] h-8 border-b-[1px] bg-zinc-100">
				<div class={`flex justify-center items-center h-[100%] aspect-[1.2]`}>
					<div class="aspect-square ml-2 h-[80%] bg-indigo-500">

					</div>
				</div>
				<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.NAME}>
					<TransferEntryColumnText text={props.fileName}/>
				</Column>
				<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS}>
					<div class="w-[40%] h-[5px] bg-zinc-300 rounded-full ml-2 mr-1">
						<div
							class={`
								h-[100%] rounded-full
								${status() == TRANSFER_STATUS.FINISHED ? "bg-green-400" : (status() == TRANSFER_STATUS.FAILED ? "bg-red-500" : "bg-sky-400")}
							`}
							style={`width: ${progressPercentage() * 100}%`}
						></div>
					</div>
					<TransferEntryColumnText text={transferredBytesText()}/>
					<TransferEntryColumnText text={transferSizeText()} marginSize={(status() == TRANSFER_STATUS.FINISHED || status() == TRANSFER_STATUS.FAILED) ? 0 : 1} bold/>
				</Column>
				<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.STATUS}>
					{() => status() == TRANSFER_STATUS.UPLOADING && (
						<UploadingArrow class="w-5 h-5 ml-1"/>
					)}
					{() => status() == TRANSFER_STATUS.DOWNLOADING && (
						<DownloadingArrow class="w-5 h-5 ml-1 rotate-180"/>
					)}
					{() => status() == TRANSFER_STATUS.FINISHED && (
						<FinishedTransferTick class="w-4 h-4 ml-1.5"/>
					)}
					{() => status() == TRANSFER_STATUS.FAILED && (
						<FailedTransferCross class="w-5 h-5 ml-1"/>
					)}
					<TransferEntryColumnText semibold={boldStatusText()} text={statusText}/>
				</Column>
				<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.EXTRA}>
					
				</Column>
			</div>
		);
	}

	// Initialise the file list
	refreshFileList();

	return (
		<div
			class={`flex flex-row w-[100%] h-[100%] overflow-auto`}
			style={`${props.visible ? "width: 100%;" : "width: 0;"}`}
		>
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
					</div>
					<div class="flex flex-col w-[100%] overflow-auto bg-zinc-300">
						<div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"> {/* Column headers bar */}
							<div class={`h-[100%] aspect-[1.95]`}></div> {/* Icon column (empty) */}
							<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.NAME}>
								<ColumnHeaderText text="Name" />
							</Column>
							<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS}>
								<ColumnHeaderText text="Progress"/>
							</Column>
							<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.STATUS}>
								<ColumnHeaderText text="Status"/>
							</Column>
							<Column relativeWidth={TRANSFER_LIST_COLUMN_WIDTHS.EXTRA}>
								
							</Column>
						</div>
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

export { TransferListWindow, createTransferEntry };
