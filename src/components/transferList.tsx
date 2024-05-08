import { createSignal, For, Accessor, onCleanup } from "solid-js";
import { getFormattedBytesSizeText } from "../common/commonUtils";
import { TRANSFER_LIST_COLUMN_WIDTHS } from "../client/columnWidths";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { getFileIconFromExtension } from "../client/fileTypes";
import { getFileExtensionFromName } from "../utility/fileNames";
import { TransferType, TransferStatus } from "../client/transfers";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import FinishedTransferTick from "../assets/icons/svg/finished-transfer-tick.svg?component-solid";
import SimpleArrowIcon from "../assets/icons/svg/simple-arrow.svg?component-solid";
import DashIcon from "../assets/icons/svg/dash.svg?component-solid";
import FailedTransferCrossIcon from "../assets/icons/svg/failed-transfer-cross.svg?component-solid";

type TransferListEntry = {
	progressHandle: string;
	parentHandle?: string; // Only for uploads
	fileName: string;
	transferSize: number;
	transferredBytes: number;
	transferSpeed: number;
	timeLeft: number;
	transferStartTime: Date;
	transferType: TransferType;
	status: TransferStatus;
	statusText: string;

	// Forces the transfer list entry component's update function to be called which refreshs the ui
	// based on the properties inside this type
	refresh?: () => void; 
};

type TransferListProgressInfoCallback = (
	progressHandle: string, // Can be any random string
	transferType: TransferType,
	transferStatus: TransferStatus,
	parentHandle?: string, // Must be provided on uploads and be the actual destination parent handle!
	
	// If any value below here is undefined, they will remain unchanged in the transfer list entry gui
	progress?: number,
	fileName?: string,
	transferSize?: number,
	statusText?: string
) => void;

type TransferListWindowProps = {
	transferEntriesGetter: Accessor<TransferListEntry[]>; // TODO: back to ordinary array?
	userSettingsAccessor: Accessor<UserSettings>;
	visible: boolean;
	transferType: TransferType;
};

type TransferListEntryProps = {
	entry: TransferListEntry;
	userSettingsAccessor: Accessor<UserSettings>;
}

const TransferListEntry = (props: TransferListEntryProps) => {
	const SIZE_TEXT_PRECISION = 2;

	const { entry, userSettingsAccessor } = props;
	const [ status, setStatus ] = createSignal(TransferStatus.Waiting);
	const [ statusText, setStatusText ] = createSignal("Waiting...");
	const [ statusTextBold, setStatusTextBold ] = createSignal(false);
	const [ progressPercentage, setProgressPercentage ] = createSignal(0);
	const [ transferredBytesText, setTransferredBytesText ] = createSignal(getFormattedBytesSizeText(0, userSettingsAccessor().dataSizeUnits));
	const [ transferSizeText, setTransferSizeText ] = createSignal("/ " + getFormattedBytesSizeText(entry.transferSize, userSettingsAccessor().dataSizeUnits, SIZE_TEXT_PRECISION));

	// Listen for property changes periodically whilst the transfer status is not finished or failed
	const update = () => {
		const currentStatus = entry.status;
		setStatus(currentStatus);

		const progressPercentage = Math.min((entry.transferredBytes / entry.transferSize), 1);
		setProgressPercentage(progressPercentage);

		if (currentStatus == TransferStatus.Waiting) {
			setStatusText(entry.statusText.length > 0 ? entry.statusText : "Waiting...");
			setStatusTextBold(false);
		} else if (currentStatus == TransferStatus.Finished) {
			setTransferredBytesText("");
			setStatusText(entry.statusText);
			setTransferSizeText(getFormattedBytesSizeText(entry.transferSize, userSettingsAccessor().dataSizeUnits, SIZE_TEXT_PRECISION));
		} else if (currentStatus == TransferStatus.Failed) {
			setTransferredBytesText("");
			setStatusText(entry.statusText);
			setTransferSizeText(getFormattedBytesSizeText(entry.transferSize, userSettingsAccessor().dataSizeUnits, SIZE_TEXT_PRECISION));
		} else {
			setTransferredBytesText(getFormattedBytesSizeText(entry.transferredBytes, userSettingsAccessor().dataSizeUnits, SIZE_TEXT_PRECISION));
			setStatusTextBold(true);
			
			if (entry.transferType == TransferType.Uploads) {
				setStatusText(entry.statusText.length > 0 ? entry.statusText : "Uploading...");
			} else if (entry.transferType == TransferType.Downloads) {
				setStatusText(entry.statusText.length > 0 ? entry.statusText : "Downloading...");
			}
		}
	};

	const fileName = entry.fileName;
	const fileExtension = getFileExtensionFromName(fileName);

	// Set refresh function
	entry.refresh = update;

	return (
		<div class="flex flex-row flex-nowrap flex-start flex-shrink-0 items-center overflow-x-hidden w-full h-8 border-b-[1px] bg-zinc-100">
			<div class={`flex justify-center items-center h-full aspect-[1.2]`}>
				{ getFileIconFromExtension(fileExtension) }
			</div>
			<Column width={TRANSFER_LIST_COLUMN_WIDTHS.NAME} noShrink>
				<ColumnText text={fileName} matchParentWidth ellipsis/>
			</Column>
			<Column width={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS} noShrink>
				<div class="w-0 min-w-[40%] h-[5px] bg-zinc-300 rounded-full ml-2 mr-1">
					<div
						class={`
							h-full rounded-full
							${status() == TransferStatus.Finished ? "bg-green-400" : (status() == TransferStatus.Failed ? "bg-red-500" : "bg-sky-400")}
						`}
						style={`width: ${progressPercentage() * 100}%`}
					></div>
				</div>
				<ColumnText text={transferredBytesText()}/>
				<ColumnText text={transferSizeText()} marginSize={(status() == TransferStatus.Finished || status() == TransferStatus.Failed) ? 0 : 1} bold/>
			</Column>
			<Column width={TRANSFER_LIST_COLUMN_WIDTHS.STATUS}>
				{() => status() == TransferStatus.Transferring && entry.transferType == TransferType.Uploads && (
					<SimpleArrowIcon class="w-5 h-5 ml-1 flex-shrink-0 text-sky-400"/>
				)}
				{() => status() == TransferStatus.Transferring && entry.transferType == TransferType.Downloads && (
					<SimpleArrowIcon class="w-5 h-5 ml-1 flex-shrink-0 rotate-180 text-green-500"/>
				)}
				{() => status() == TransferStatus.Finished && (
					<FinishedTransferTick class="w-4 h-4 flex-shrink-0 ml-1.5 text-green-500"/>
				)}
				{() => status() == TransferStatus.Failed && (
					<FailedTransferCrossIcon class="w-5 h-5 flex-shrink-0 ml-1 text-red-500"/>
				)}
				{() => status() == TransferStatus.Waiting && (
					<DashIcon class="w-4 h-4 flex-shrink-0 ml-1 text-sky-400"/>
				)}
				<ColumnText semibold={statusTextBold()} text={statusText()}/>
			</Column>
		</div>
	);
}

function TransferListWindow(props: TransferListWindowProps) {
	const { transferEntriesGetter, userSettingsAccessor } = props;
	const [ searchBarFocused, setSearchBarFocused ] = createSignal(false);

	// This stores all the metadata of files in the user's currentl filepath.
	// When setTransferEntries() is called, the DOM will update with the new entries.
	const [ transferEntries, setTransferEntries ] = createSignal<TransferListEntry[]>([]);

	let searchText: string = "";
	
	// This function refreshes the file list and sorts the data
	const refreshFileList = () => {
		let entries = transferEntriesGetter();
		
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

		// Update all transfer list entries
		transferEntries().forEach(entry => {
			if (entry.refresh) {
				entry.refresh();
			}
		});
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

	// Update loop
	const updateInterval = setInterval(refreshFileList, 250);

	onCleanup(() => {
		clearInterval(updateInterval);
	});

	return (
		<div
			class={`flex flex-row w-full h-full overflow-auto`}
			style={`${!props.visible && "display: none;"}`}
		>
			<div class="flex flex-row w-full h-full">
				<div class="w-full h-full flex flex-col">
					<div class="flex flex-col w-full overflow-auto">
						{/* Top bar */}
						<div class="flex flex-row items-center flex-shrink-0 w-full px-2 bg-zinc-200">
							{/* Search bar */}
							<div
								class={`
									flex flex-row items-center justify-start w-full h-9 my-1.5 bg-zinc-50 rounded-xl border-2
									${searchBarFocused() ? "border-blue-600" : "border-zinc-300"}
								`}
							> 
								<MagnifyingGlassIcon class="w-5 h-5 min-w-5 min-h-5 invert-[20%] ml-3" />
								<input
									type="text"
									placeholder="Search"
									class="flex-grow ml-2 mr-6 outline-none bg-transparent font-SpaceGrotesk text-medium text-[0.9em]"
									onKeyPress={onSearchBarKeypress}
									onFocus={() => setSearchBarFocused(true)}
									onBlur={() => setSearchBarFocused(false)}
								/>
							</div>
						</div>

						{/* Column headers bar */}
						<div class="flex flex-row flex-nowrap flex-shrink-0 w-full h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200">
							<div class={`h-full aspect-[1.95]`}></div> {/* Icon column (empty) */}
							<Column width={TRANSFER_LIST_COLUMN_WIDTHS.NAME} noShrink>
								<ColumnText semibold text="Name" />
							</Column>
							<Column width={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS} noShrink>
								<ColumnText semibold text="Progress"/>
							</Column>
							<Column width={TRANSFER_LIST_COLUMN_WIDTHS.STATUS}>
								<ColumnText semibold text="Status"/>
							</Column>
						</div>

						{/* Transfer list entries */}
						<For each={transferEntries()}>
							{(entry: TransferListEntry) => {
								// Only render transfer entry when it belongs to the current transfer window's transfer type
								if (entry.transferType == props.transferType) {
									return (
										<TransferListEntry
											entry={entry}
											userSettingsAccessor={userSettingsAccessor}
										/>
									)
								}
							}}
						</For>

						{/* Padding at the bottom of the file list */}
						<div class="shrink-0 w-full h-[200px]"></div>
					</div>
				</div>
			</div>
		</div>
	);
}

export type {
	TransferListEntry,
	TransferListProgressInfoCallback
};

export {
	TransferStatus,
	TransferListWindow
};
