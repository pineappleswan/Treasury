function FileExplorerWindow(props) {
	let { useAmericanDateFormat } = props.settings;
	const [ splitViewMode, setSplitViewMode ] = createSignal(false);

	// Constructs a file entry object that can be appended to 'fileEntries()' within the 'FileExplorer'
	// class and updated with setFileEntries()
	const createFileEntry = (handle, fileName, fileSizeInBytes, fileType, dateAdded) => {
		// Type checking
		if (typeof(handle) != "string") throw new TypeError("handle must be a string!");
		if (typeof(fileName) != "string") throw new TypeError("fileName must be a string!");
		if (typeof(fileSizeInBytes) != "number") throw new TypeError("fileSizeInBytes must be a number!");
		if (typeof(fileType) != "string") throw new TypeError("fileType must be a string!");
		if (typeof(dateAdded) != "number") throw new TypeError("dateAdded must be a number!");

		return {
			handle: handle,
			fileName: fileName,
			fileSizeInBytes: fileSizeInBytes,
			fileType: fileType,
			dateAdded: dateAdded
		};
	}

	// Generate mock file entries data (TODO: this is temporary)
	let fileEntriesData = [];

	for (let i = 0; i < 100; i++) {
		let handle = Math.floor(Math.random() * 100);
		let dateAdded = (new Date()) / 1000;
		dateAdded = dateAdded + (Math.random() - 0.5) * 10000;

		try {
			let entry = createFileEntry(
				handle.toString(),
				handle.toString(),
				Math.random() * 100000000,
				"png",
				dateAdded
			);

			fileEntriesData.push(entry);
		} catch (error) {
			console.error(error);
		}
	}

	// The actual file explorer component
	const FileExplorer = () => {
		// Arbitrary values can be specified to adjust the relative widths of the columns in the file explorer
		const columnWidths = {
			NAME: 8,
			TYPE: 2,
			SIZE: 2,
			DATE_ADDED: 4
		};

		const FILE_LIST_SORT_MODES = {
			NAME: 0,
			TYPE: 1,
			SIZE: 2,
			DATE_ADDED: 3
		};

		let columnWidthDivider = Object.values(columnWidths).reduce((a, b) => a + b, 0) / 100;

		// This stores all the metadata of files in the user's currentl filepath.
		// When setFileEntries() is called, the DOM will update with the new entries.
		// To create a file entry, call 'createFileEntry' and append it to the array.
		// Alternatively, you can call 'addSingleFileEntry' to add a single entry and immediately
		// update the DOM
		const [ fileEntries, setFileEntries ] = createSignal([]);

		// Adds a single file entry and immediately updates the DOM
		const addSingleFileEntry = (entry) => {
			setFileEntries((prevEntries) => [...prevEntries, entry]);
		};
		
		// Removes any file entry that has a handle that exactly matches 'targetHandle' and immediately updates the DOM
		const removeFileEntriesByHandle = (targetHandle) => {
			setFileEntries((prevEntries) => prevEntries.filter((entry) => { return entry.handle != targetHandle; }));
		};
		
		// These are all the states used by 'refreshFileList'
		let currentSearchText = "";
		let currentSortMode = FILE_LIST_SORT_MODES.NAME;
		let currentSortAscending = true;
		
		// This function populates the file list with file entries defined in the 'fileEntries' signal.
		const refreshFileList = () => {
			if (currentSortMode == undefined)
				throw new Error(`currentSortMode is undefined!`);

			if (typeof(currentSortAscending) != "boolean")
				throw new TypeError(`currentSortAscending must be a boolean!`);

			let entries = fileEntriesData;

			// Filter by search text if applicable
			if (currentSearchText != undefined) {
				entries = entries.filter(entry => {
					let findIndex = entry.fileName.toLowerCase().search(currentSearchText.toLowerCase());
					return findIndex != -1;
				});
			}

			// Sort
			if (currentSortMode == FILE_LIST_SORT_MODES.NAME) {
				if (currentSortAscending) {
					entries.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" }));
				} else {
					entries.sort((a, b) => b.fileName.localeCompare(a.fileName, undefined, { numeric: true, sensitivity: "base" }));
				}
			} else if (currentSortMode == FILE_LIST_SORT_MODES.TYPE) {
				if (currentSortAscending) {
					entries.sort((a, b) => a.fileType.localeCompare(b.fileType, undefined, { numeric: true, sensitivity: "base" }));
				} else {
					entries.sort((a, b) => b.fileType.localeCompare(a.fileType, undefined, { numeric: true, sensitivity: "base" }));
				}
			} else if (currentSortMode == FILE_LIST_SORT_MODES.SIZE) {
				if (currentSortAscending) {
					entries.sort((a, b) => a.fileSizeInBytes > b.fileSizeInBytes);
				} else {
					entries.sort((a, b) => a.fileSizeInBytes < b.fileSizeInBytes);
				}
			} else if (currentSortMode == FILE_LIST_SORT_MODES.DATE_ADDED) {
				if (currentSortAscending) {
					entries.sort((a, b) => a.dateAdded > b.dateAdded);
				} else {
					entries.sort((a, b) => a.dateAdded < b.dateAdded);
				}
			} else {
				throw new Error(`Invalid sort mode!`);
			}

			setFileEntries(entries);
		};

		// Handles search bar functionality
		const onSearchBarKeypress = (event) => {
			if (event.keyCode != 13)
				return;

			currentSearchText = event.target.value;

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
			return (
				<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-sm overflow-ellipsis font-medium whitespace-nowrap select-none">{props.text}</h1>
			);
		};

		let columnHeaderSortButtonVisibilitySetters = [];

		const ColumnHeaderSortButton = (props) => {
			const [ rotation, setRotation ] = createSignal(props.sortAscending ? 0 : 180);
			const [ visible, setVisible ] = createSignal(currentSortMode == props.sortType);

			columnHeaderSortButtonVisibilitySetters.push(setVisible);

			return (
				<RightAngleArrowIcon
					style={`opacity: ${visible() ? 100 : 0}%`}
					class={`aspect-square w-5 h-5 ml-1 rounded-full hover:cursor-pointer hover:bg-zinc-300 rotate-${rotation()}`}
					onClick={() => {
						let sortType = props.sortType;

						if (currentSortMode != sortType) {
							currentSortMode = sortType;
							
							// Set all other sort ascending buttons to be invisible and only set this one to be visible
							columnHeaderSortButtonVisibilitySetters.forEach(setter => setter(false));
							setVisible(true);
						} else {
							// Flip state only when the current store mode is the same as this button's sort mode
							props.sortAscending = !props.sortAscending;
							setRotation(props.sortAscending ? 0 : 180);
						}
						
						// Refresh file list with new sort settings
						currentSortAscending = props.sortAscending;

						try {
							refreshFileList();
						} catch (error) {
							console.log(`FAILED TO REFRESH FILE LIST FOR REASON: ${error}`);
						}
					}}
					// Make button visible when hovering over it while it's invisible by default (if its not of the current sort type)
					onmouseenter={() => {
						if (props.sortType != currentSortMode) {
							setVisible(true);
						}
					}}
					onmouseleave={() => {
						if (props.sortType != currentSortMode) {
							setVisible(false);
						}
					}}
				/>
			);
		};
		
		// This component is used
		const FileEntryColumnText = (props) => {
			return (
				<h1 class="ml-2 font-SpaceGrotesk text-zinc-900 text-[0.825em] overflow-ellipsis font-normal whitespace-nowrap select-none">{props.text}</h1>
			);
		};

		// The file entry component
		const FileEntry = (props) => {
			let fileTypeText = props.fileType
			let sizeText = getFormattedBytesSizeText(props.fileSizeInBytes);
			let dateAddedText = getDateAddedTextFromUnixTimestamp(props.dateAdded, useAmericanDateFormat);

			return (
				<div class="flex flex-row flex-nowrap flex-start flex-shrink-0 items-center overflow-x-hidden w-[100%] h-8 border-b-[1px] bg-zinc-100">
					<div class={`flex justify-center items-center h-[100%] aspect-[1.2]`}>
						<div class="aspect-square ml-2 h-[80%] bg-indigo-500">

						</div>
					</div>
					<Column relativeWidth={columnWidths.NAME}>
						<FileEntryColumnText text={props.fileName}/>
					</Column>
					<Column relativeWidth={columnWidths.TYPE}>
						<FileEntryColumnText text={fileTypeText}/>
					</Column>
					<Column relativeWidth={columnWidths.SIZE}>
						<FileEntryColumnText text={sizeText}/>
					</Column>
					<Column relativeWidth={columnWidths.DATE_ADDED}>
						<FileEntryColumnText text={dateAddedText}/>
					</Column>
				</div>
			);
		}

		// Initialise the file list
		refreshFileList(currentSortMode, true);

		return (
			<div style={`width: ${100}%`} class="flex flex-col min-w-[550px] h-[100%]"> {/* Style is used for width so it can be resized dynamically using JS */}
				<div class="flex flex-row px-2 items-center flex-shrink-0 w-[100%] h-12 bg-zinc-200"> {/* Search bar */}
					<div class="flex flex-row items-center justify-start w-[100%] h-[80%] bg-zinc-50 rounded-full border-2 border-zinc-300"> 
						<MagnifyingGlassIcon class="aspect-square w-5 h-5 invert-[20%] ml-3" />
						<input
							type="text"
							placeholder="Search"
							class="flex-grow ml-2 mr-6 outline-none bg-transparent font-SpaceGrotesk text-medium text-[0.95em]"
							onKeyPress={onSearchBarKeypress}
						/>
					</div>
					<SplitLayoutIcon
						class={`aspect-square w-[27px] h-[27px] ml-3 mr-4 p-[3px] rounded-md invert-[20%]
						hover:cursor-pointer hover:bg-zinc-100 active:bg-zinc-300 ${splitViewMode() ? "bg-zinc-100" : ""}`}
						onClick={() => setSplitViewMode(!splitViewMode())}
					/>
				</div>
				<div class="flex flex-col w-[100%] overflow-auto bg-zinc-300">
					<div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"> {/* Column headers bar */}
						<div class={`h-[100%] aspect-[1.95]`}></div> {/* Icon column (empty) */}
						<Column relativeWidth={columnWidths.NAME}>
							<ColumnHeaderText text="Name"/>
							<ColumnHeaderSortButton sortAscending={true} sortType={FILE_LIST_SORT_MODES.NAME} />
						</Column>
						<Column relativeWidth={columnWidths.TYPE}>
							<ColumnHeaderText text="Type"/>
							<ColumnHeaderSortButton sortAscending={true} sortType={FILE_LIST_SORT_MODES.TYPE} />
						</Column>
						<Column relativeWidth={columnWidths.SIZE}>
							<ColumnHeaderText text="Size"/>
							<ColumnHeaderSortButton sortAscending={true} sortType={FILE_LIST_SORT_MODES.SIZE} />
						</Column>
						<Column relativeWidth={columnWidths.DATE_ADDED}>
							<ColumnHeaderText text="Date added"/>
							<ColumnHeaderSortButton sortAscending={true} sortType={FILE_LIST_SORT_MODES.DATE_ADDED} />
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

	// DRAGGING TEST
	const [ leftWidth, setLeftWidth ] = createSignal(50);
	const [ rightWidth, setRightWidth ] = createSignal(50);
	const [ dragging, setDragging ] = createSignal(false);
	let startDraggingX = 0;
	let startDraggingLeftWidth = 0;

	const handleMouseDown = (event) => {
		startDraggingX = event.clientX;
		startDraggingLeftWidth = leftWidth();
		setDragging(true);
	}

	const handleMouseUp = (event) => {
		setDragging(false);
	}

	const handleMouseMove = (event) => {
		if (!dragging())
			return;
		
		const masterContainerWidth = document.getElementById("file-explorer-window").offsetWidth;
		const leftContainerWidth = document.getElementById("left-file-explorer-div").offsetWidth;
		const rightContainerWidth = document.getElementById("right-file-explorer-div").offsetWidth;
		const mouseX = event.clientX;
		const mouseXDelta = mouseX - startDraggingX;
		const mouseXDeltaPercentage = (mouseXDelta / masterContainerWidth) * 100;

		let newLeftWidth = startDraggingLeftWidth + mouseXDeltaPercentage;

		// Clamp how much the user can resize the relative width of the two explorers
		if (newLeftWidth < 20) newLeftWidth = 20;
		if (newLeftWidth > 80) newLeftWidth = 80;

		setLeftWidth(newLeftWidth);
		setRightWidth(100 - newLeftWidth);
	};

	document.addEventListener("mousemove", handleMouseMove);
	document.addEventListener("mouseup", handleMouseUp);

	return (
		<div id="file-explorer-window" class="flex flex-row w-[100%] h-[100%]">
			<div id="left-file-explorer-div" class="flex flex-row overflow-auto" style={`width: ${splitViewMode() ? leftWidth() : 100}%`}>
				<FileExplorer />
			</div>
			{() => splitViewMode() && (
				<>
					<div class={`bg-zinc-300 w-[3px] h-[100%] hover:cursor-ew-resize`} onMouseDown={handleMouseDown}> {/* Draggable separator for the two windows */}

					</div>
					<div id="right-file-explorer-div" class="flex flex-row overflow-auto w-[100%]" style={`width: ${rightWidth()}%`}>
						<FileExplorer />
					</div>
				</>
			)}
		</div>
	);
}

function TransferListWindow() {
  

  return (
    <div class="flex flex-row w-[100%] h-[100%]">
			<div class="flex flex-row overflow-auto">
				
			</div>
		</div>
  );
}

export default TransferListWindow;
