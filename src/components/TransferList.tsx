import { createEffect, createSignal, onCleanup, For } from "solid-js";
import { getFormattedBPSText, getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../utility/formatting";
import { TransferStatus, TRANSFER_LIST_COLUMN_WIDTHS } from "../utility/enums";
import { Column, ColumnText } from "./Column";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import PauseIcon from "../assets/icons/svg/pause.svg?component-solid"
import FinishedTransferTick from "../assets/icons/svg/finished-transfer-tick.svg?component-solid"
import UploadingArrow from "../assets/icons/svg/uploading-arrow.svg?component-solid"
import DownloadingArrow from "../assets/icons/svg/downloading-arrow.svg?component-solid"
import FailedTransferCross from "../assets/icons/svg/failed-transfer-cross.svg?component-solid"

// Constructs a transfer entry object that can be appended to 'transferEntries()'
// class and updated with setTransferEntries()
type TransferEntry = {
	handle: string,
	fileName: string,
	transferSize: number,
	transferredBytes: number,
	transferSpeed: number,
	timeLeft: number,
	uploadStartTime: number,
	status: TransferStatus
};

function createTransferEntry(handle: string, fileName: string, transferSize: number) {
	return {
		handle: handle,
		fileName: fileName,
		transferSize: transferSize,
		transferredBytes: 0,
		transferSpeed: 0,
		timeLeft: 0,
		uploadStartTime: 0, // should be new Date() or something
		status: TransferStatus.WAITING
	};
}

function TransferListWindow(props: any) {
	const { transferEntriesData } = props;

	// This stores all the metadata of files in the user's currentl filepath.
	// When setTransferEntries() is called, the DOM will update with the new entries.
	const [ transferEntries, setTransferEntries ] = createSignal([]);

	let searchText: string = "";
	
	// This function refreshes the file list and sorts the data
	const refreshFileList = () => {
		let entries = transferEntriesData;

		// Filter by search text if applicable
		if (searchText.length > 0) {
			entries = entries.filter((entry: TransferEntry) => {
				let findIndex = entry.fileName.toLowerCase().search(searchText.toLowerCase());
				return findIndex != -1;
			});
		}
		
		// Sort
		entries.sort((a: TransferEntry, b: TransferEntry) => {
			return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" });
		});

		setTransferEntries(entries);
	};

	// Handles search bar functionality
	const onSearchBarKeypress = (event: any) => {
		if (event.keyCode != 13)
			return;

		searchText = event.target.value;

		// Unfocus the search bar
		event.target.blur();

		try {
			refreshFileList();
		} catch (error) {
			console.error(`SEARCH FAILED FOR REASON: ${error}`);
		}
	}

	// The file entry component
	const TransferEntry = (props: any) => {
		const [ status, setStatus ] = createSignal(TransferStatus.WAITING);
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

				if (status() == TransferStatus.WAITING) {
					setStatusText("Waiting...");
					setStatusTextBold(false);
				} else if (status() == TransferStatus.FINISHED) {
					setTransferredBytesText("");
					setStatusText("");
					setTransferSizeText(getFormattedBytesSizeText(props.transferSize));
				} else if (status() == TransferStatus.FAILED) {
					setTransferredBytesText("");
					setStatusText("FAILED");
					setTransferSizeText(getFormattedBytesSizeText(props.transferSize));
				} else {
					setTransferredBytesText(getFormattedBytesSizeText(props.transferredBytes));
					setStatusTextBold(true);
					
					if (status() == TransferStatus.UPLOADING) {
						setStatusText("Uploading...");
					} else if (status() == TransferStatus.DOWNLOADING) {
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
				<Column width={TRANSFER_LIST_COLUMN_WIDTHS.NAME} noShrink>
					<ColumnText text={props.fileName}/>
				</Column>
				<Column width={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS} noShrink>
					<div class="w-[40%] h-[5px] bg-zinc-300 rounded-full ml-2 mr-1">
						<div
							class={`
								h-[100%] rounded-full
								${status() == TransferStatus.FINISHED ? "bg-green-400" : (status() == TransferStatus.FAILED ? "bg-red-500" : "bg-sky-400")}
							`}
							style={`width: ${progressPercentage() * 100}%`}
						></div>
					</div>
					<ColumnText text={transferredBytesText()}/>
					<ColumnText text={transferSizeText()} marginSize={(status() == TransferStatus.FINISHED || status() == TransferStatus.FAILED) ? 0 : 1} bold/>
				</Column>
				<Column width={TRANSFER_LIST_COLUMN_WIDTHS.STATUS}>
					{() => status() == TransferStatus.UPLOADING && (
						<UploadingArrow class="w-5 h-5 ml-1 flex-shrink-0"/>
					)}
					{() => status() == TransferStatus.DOWNLOADING && (
						<DownloadingArrow class="w-5 h-5 ml-1 flex-shrink-0 rotate-180"/>
					)}
					{() => status() == TransferStatus.FINISHED && (
						<FinishedTransferTick class="w-4 h-4 flex-shrink-0 ml-1.5"/>
					)}
					{() => status() == TransferStatus.FAILED && (
						<FailedTransferCross class="w-5 h-5 flex-shrink-0 ml-1"/>
					)}
					<ColumnText semibold={boldStatusText()} text={statusText}/>
				</Column>
				<Column width={TRANSFER_LIST_COLUMN_WIDTHS.EXTRA}>
					
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
				<div class="w-[100%] h-[100%] flex flex-col">
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
							<Column width={TRANSFER_LIST_COLUMN_WIDTHS.NAME} noShrink>
								<ColumnText semibold text="Name" />
							</Column>
							<Column width={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS} noShrink>
								<ColumnText semibold text="Progress"/>
							</Column>
							<Column width={TRANSFER_LIST_COLUMN_WIDTHS.STATUS}>
								<ColumnText semibold text="Status"/>
							</Column>
							<Column width={TRANSFER_LIST_COLUMN_WIDTHS.EXTRA}>
								
							</Column>
						</div>
						<For each={transferEntries()}>
							{(entryInfo: TransferEntry, index) => (
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

export type { TransferEntry };
export { TransferListWindow, createTransferEntry };
