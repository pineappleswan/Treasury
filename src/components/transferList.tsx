import { createSignal, For, Accessor } from "solid-js";
import { getFormattedBytesSizeText } from "../common/commonUtils";
import { TRANSFER_LIST_COLUMN_WIDTHS } from "../client/enumsAndTypes";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { getFileExtensionFromName, getFileIconFromExtension } from "../utility/fileTypes";
import { TransferType } from "../client/transfers";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import FinishedTransferTick from "../assets/icons/svg/finished-transfer-tick.svg?component-solid";
import UploadingArrow from "../assets/icons/svg/uploading-arrow.svg?component-solid";
import DownloadingArrow from "../assets/icons/svg/downloading-arrow.svg?component-solid";
import FailedTransferCross from "../assets/icons/svg/failed-transfer-cross.svg?component-solid";

// TODO: move to transfers.ts?
// Constructs a transfer entry object that can be appended to 'transferEntries()'
// class and updated with setTransferEntries()

enum TransferStatus {
	Waiting,
	Transferring,
	Finished,
	Failed
}

type TransferListEntry = {
	handle: string,
	fileName: string,
	transferSize: number,
	transferredBytes: number,
	transferSpeed: number,
	timeLeft: number,
	transferStartTime: number,
	status: TransferStatus,
	transferType: TransferType
};

function createTransferListEntry(handle: string, fileName: string, transferSize: number, transferType: TransferType): TransferListEntry {
	return {
		handle: handle,
		fileName: fileName,
		transferSize: transferSize,
		transferredBytes: 0,
		transferSpeed: 0,
		timeLeft: 0,
		transferStartTime: 0, // should be new Date() or something
		status: TransferStatus.Waiting,
		transferType: transferType
	};
}

type TransferListWindowProps = {
	transferEntriesGetter: Accessor<TransferListEntry[]>, // TODO: back to ordinary array?
	userSettings: UserSettings,
	visible: boolean,
	transferType: TransferType
};

function TransferListWindow(props: TransferListWindowProps) {
	const { transferEntriesGetter, transferType } = props;

	// This stores all the metadata of files in the user's currentl filepath.
	// When setTransferEntries() is called, the DOM will update with the new entries.
	const [ transferEntries, setTransferEntries ] = createSignal<TransferListEntry[]>([]);

	let searchText: string = "";
	
	// This function refreshes the file list and sorts the data
	const refreshFileList = () => {
		let entries = transferEntriesGetter();

		/* TODO: for testing super long names
		let entries = [
			{
				handle: "blah",
				fileName: "adf7a9d67g g9dfa8d",
				transferSize: 1237825943,
				transferredBytes: 1237825943,
				transferSpeed: 0,
				timeLeft: 0,
				uploadStartTime: 0,
				status: TransferStatus.FINISHED
			}
		];
		*/
		
		// Filter by search text if applicable
		if (searchText.length > 0) {
			entries = entries.filter((entry: TransferListEntry) => {
				let findIndex = entry.fileName.toLowerCase().search(searchText.toLowerCase());
				return findIndex != -1;
			});
		}
		
		// Sort
		entries.sort((a: TransferListEntry, b: TransferListEntry) => {
			return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" });
		});
		
		setTransferEntries(entries);
	};

	// Update loop (TODO: remove redundant updates???)
	setInterval(() => {
		refreshFileList();
	}, 100);

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
	const TransferListEntry = (props: TransferListEntry) => {
		const [ status, setStatus ] = createSignal(TransferStatus.Waiting);
		const [ statusText, setStatusText ] = createSignal("Waiting...");
		const [ boldStatusText, setStatusTextBold ] = createSignal(false);
		const [ progressPercentage, setProgressPercentage ] = createSignal(0);
		const [ transferredBytesText, setTransferredBytesText ] = createSignal(getFormattedBytesSizeText(0));
		const [ transferSizeText, setTransferSizeText ] = createSignal("/ " + getFormattedBytesSizeText(props.transferSize));

		// Listen for property changes periodically whilst the transfer status is not finished or failed
		const update = () => {
			const currentStatus = props.status;
			setStatus(currentStatus);

			let progressPercentage = Math.min((props.transferredBytes / props.transferSize), 1);
			setProgressPercentage(progressPercentage);

			if (currentStatus == TransferStatus.Waiting) {
				setStatusText("Waiting...");
				setStatusTextBold(false);
			} else if (currentStatus == TransferStatus.Finished) {
				setTransferredBytesText("");
				setStatusText("");
				setTransferSizeText(getFormattedBytesSizeText(props.transferSize));
			} else if (currentStatus == TransferStatus.Failed) {
				setTransferredBytesText("");
				setStatusText("FAILED");
				setTransferSizeText(getFormattedBytesSizeText(props.transferSize));
			} else {
				setTransferredBytesText(getFormattedBytesSizeText(props.transferredBytes));
				setStatusTextBold(true);
				
				if (transferType == TransferType.Uploads) {
					setStatusText("Uploading...");
				} else if (transferType == TransferType.Downloads) {
					setStatusText("Downloading...");
				}
			}

			// Stop loop when transfer is done
			const done = (currentStatus == TransferStatus.Finished || currentStatus == TransferStatus.Failed);

			if (done) {
				clearInterval(interval);
			}
		};

		// Update UI from entry data every 250ms
		const interval = setInterval(update, 250);
		
		const fileName = props.fileName;
		const fileExtension = getFileExtensionFromName(fileName);

		return (
			<div class="flex flex-row flex-nowrap flex-start flex-shrink-0 items-center overflow-x-hidden w-[100%] h-8 border-b-[1px] bg-zinc-100">
				<div class={`flex justify-center items-center h-[100%] aspect-[1.2]`}>
					{ getFileIconFromExtension(fileExtension) }
				</div>
				<Column width={TRANSFER_LIST_COLUMN_WIDTHS.NAME} noShrink>
					<ColumnText text={fileName} matchParentWidth ellipsis/>
				</Column>
				<Column width={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS} noShrink>
					<div class="w-0 min-w-[40%] h-[5px] bg-zinc-300 rounded-full ml-2 mr-1">
						<div
							class={`
								h-[100%] rounded-full
								${status() == TransferStatus.Finished ? "bg-green-400" : (status() == TransferStatus.Failed ? "bg-red-500" : "bg-sky-400")}
							`}
							style={`width: ${progressPercentage() * 100}%`}
						></div>
					</div>
					<ColumnText text={transferredBytesText()}/>
					<ColumnText text={transferSizeText()} marginSize={(status() == TransferStatus.Finished || status() == TransferStatus.Failed) ? 0 : 1} bold/>
				</Column>
				<Column width={TRANSFER_LIST_COLUMN_WIDTHS.STATUS}>
					{() => status() == TransferStatus.Transferring && props.transferType == TransferType.Uploads && (
						<UploadingArrow class="w-5 h-5 ml-1 flex-shrink-0"/>
					)}
					{() => status() == TransferStatus.Transferring && props.transferType == TransferType.Downloads && (
						<DownloadingArrow class="w-5 h-5 ml-1 flex-shrink-0 rotate-180"/>
					)}
					{() => status() == TransferStatus.Finished && (
						<FinishedTransferTick class="w-4 h-4 flex-shrink-0 ml-1.5"/>
					)}
					{() => status() == TransferStatus.Failed && (
						<FailedTransferCross class="w-5 h-5 flex-shrink-0 ml-1"/>
					)}
					<ColumnText semibold={boldStatusText()} text={statusText()}/>
				</Column>
				<Column width={TRANSFER_LIST_COLUMN_WIDTHS.EXTRA} />
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
							<Column width={TRANSFER_LIST_COLUMN_WIDTHS.EXTRA} />
						</div>
						<For each={transferEntries()}>
							{(entry: TransferListEntry) => {
								// Only render transfer entry when it belongs to the current transfer window's transfer type
								if (entry.transferType == props.transferType) {
									return (
										<TransferListEntry
											{...entry}
										/>
									)
								}
							}}
						</For>
					</div>
				</div>
			</div>
		</div>
	);
}

export type {
	TransferListEntry
};

export {
	TransferStatus,
	TransferListWindow,
	createTransferListEntry
};
