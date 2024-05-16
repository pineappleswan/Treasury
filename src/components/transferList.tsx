import { createSignal, For, Accessor, createEffect, Signal } from "solid-js";
import { TRANSFER_LIST_COLUMN_WIDTHS } from "../client/columnWidths";
import { Column, ColumnText } from "./column";
import { UserSettings } from "../client/userSettings";
import { TransferType, TransferStatus } from "../client/transfers";
import { TransferSpeedCalculator } from "../client/transferSpeedCalculator";
import { TransferListEntry } from "./transferListEntry";
import cloneDeep from "clone-deep";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";

type TransferListEntryData = {
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


type TransferListWindowContext = {
	progressCallback?: TransferListProgressInfoCallback;
	transferSpeedCalculator?: TransferSpeedCalculator;
};

type TransferListWindowProps = {
	userSettings: Accessor<UserSettings>;
	visible: boolean;
	transferType: TransferType;
	context: TransferListWindowContext;
};

function TransferListWindow(props: TransferListWindowProps) {
	const { userSettings, context } = props;
	const [ searchBarFocused, setSearchBarFocused ] = createSignal(false);
	const [ searchText, setSearchText ] = createSignal<string>("");

	// This stores all the metadata of files in the user's currentl filepath.
	// When setTransferEntries() is called, the DOM will update with the new entries.
	const [ transferEntryAccessors, setTransferEntryAccessors ] = createSignal<Accessor<TransferListEntryData>[]>([]);
	
	// This function refreshes the file list and sorts the data
	/*
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
	*/

	const [ transferListEntrySignals, setTransferListEntrySignals ] = createSignal<Signal<TransferListEntryData>[]>([]);
	const prevTransferBytesMap = new Map<string, number>(); // Used to calculate delta bytes
	
	// Used by the progress callback to calculate the transfer speed. Additionally, it can be used 
	// externally by accessing this through the context
	context.transferSpeedCalculator = new TransferSpeedCalculator();

	// This callback function is used to update individual transfer list entries by their handle.
	// These changes are reflected instantly in their corresponding transfer list window.
	context.progressCallback = async(
		progressHandle,
		transferType,
		transferStatus,
		parentHandle,
		progress,
		fileName,
		transferSize,
		statusText
	) => {
		const entry = transferListEntrySignals().find((e) => e[0]().progressHandle == progressHandle); // TODO: needs to be more efficient! is it already? problem is that upload entries data is an array...
		
		if (entry == undefined) { // Create new entry if undefined
			prevTransferBytesMap.set(progressHandle, 0);
	
			setTransferListEntrySignals([...transferListEntrySignals(), createSignal<TransferListEntryData>({
				progressHandle: progressHandle,
				parentHandle: parentHandle,
				fileName: fileName || "",
				transferSize: transferSize || 0,
				transferredBytes: 0,
				transferSpeed: 0,
				timeLeft: 0,
				transferStartTime: new Date(),
				transferType: transferType,
				status: transferStatus,
				statusText: statusText || "",
			})]);
		} else {
			let newEntry = cloneDeep(entry[0]());
	
			// Determine if a transfer is finished
			const transferEnded = (newEntry.status == TransferStatus.Failed || newEntry.status == TransferStatus.Finished);
			
			if (transferEnded)
				return;
	
			if (progress) {
				progress = Math.max(Math.min(progress, 1), 0); // Clamp just in case
				const newTransferredBytes = progress * newEntry.transferSize;
				newEntry.transferredBytes = Math.max(newEntry.transferredBytes, newTransferredBytes);
			}
	
			newEntry.status = transferStatus;
	
			if (statusText != undefined)
				newEntry.statusText = statusText;
	
			// Calculate delta bytes
			let previousBytes = prevTransferBytesMap.get(progressHandle);
			previousBytes = previousBytes === undefined ? -1 : previousBytes;
	
			if (previousBytes == -1) {
				console.error(`Previous bytes was undefined for progress handle: ${progressHandle}`);
			}
	
			const deltaBytes = Math.max(0, newEntry.transferredBytes - previousBytes);
			prevTransferBytesMap.set(progressHandle, newEntry.transferredBytes);
	
			// Update transfer speed calculations for the menu entries
			context.transferSpeedCalculator!.appendDeltaBytes(deltaBytes);
			
			// Update total transferred bytes value
			newEntry.transferredBytes = Math.min(newEntry.transferredBytes, newEntry.transferSize);
	
			// Update the entry
			entry[1](newEntry);
		}
	};
	
	createEffect(() => {
		let entrySignals = transferListEntrySignals();
		
		/*
		// Filter by search text if applicable
		if (searchText.length > 0) {
			entries = entries.filter((entry: TransferListEntry) => {
				let findIndex = entry.fileName.toLowerCase().search(searchText.toLowerCase());
				return findIndex != -1;
			});
		}
		*/
		
		// Sort
		entrySignals.sort((a, b) => {
			return a[0]().fileName.localeCompare(b[0]().fileName, undefined, { numeric: true, sensitivity: "base" });
		});
		
		// Create new signals
		const newEntrySignals: Accessor<TransferListEntryData>[] = [];

		entrySignals.forEach(entry => {
			newEntrySignals.push(entry[0]);
		});

		setTransferEntryAccessors(newEntrySignals);
	});

	// Handles search bar functionality
	const onSearchBarKeypress = (event: any) => {
		if (event.keyCode != 13)
			return;

		setSearchText(event.target.value);

		// Unfocus the search bar
		event.target.blur();

		try {
			// refreshFileList();
		} catch (error) {
			console.error(`SEARCH FAILED FOR REASON: ${error}`);
		}
	}

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
						<For each={transferEntryAccessors()}>
							{data => {
								// Only render transfer entry when it belongs to the current transfer window's transfer type
								if (data().transferType == props.transferType) {
									return (
										<TransferListEntry
											transferListEntryData={data}
											userSettings={userSettings}
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
	TransferListEntryData,
	TransferListProgressInfoCallback,
	TransferListWindowContext
};

export {
	TransferStatus,
	TransferListWindow
};
