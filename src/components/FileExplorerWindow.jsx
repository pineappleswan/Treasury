import { createSignal, For } from "solid-js";
import { getFormattedBPSText, getFormattedBytesSizeText, getDateAddedTextFromUnixTimestamp } from "../utility/formatting";
import { FILESYSTEM_COLUMN_WIDTHS, FILESYSTEM_SORT_MODES } from "../utility/enums";
import { ENCRYPTED_FILE_CHUNK_SIZE } from "../common/clientCrypto";

// Icons
import MagnifyingGlassIcon from "../assets/icons/svg/magnifying-glass.svg?component-solid";
import SplitLayoutIcon from "../assets/icons/svg/split-layout.svg?component-solid";
import RightAngleArrowIcon from "../assets/icons/svg/right-angle-arrow.svg?component-solid";
import { saveCurrentDepth } from "@solidjs/router";

// TODO: fix issue where user sets any column's sort mode to descending in filesystem, then exit the window and reenter it, then all the sort buttons are now descending
//       because everytime the window component is created, it reads from only one sortAscending boolean

// Constructs a file entry object that can be appended to 'fileEntries()' within the 'FileExplorer'
// class and updated with setFileEntries()
function createFilesystemEntry(handle, fileName, fileSizeInBytes, fileType, dateAdded) {
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

// Upload file function
const uploadFileToServer = (file) => {
	return new Promise(async (resolve, reject) => {
		const chunkSize = ENCRYPTED_FILE_CHUNK_SIZE;
		const fileSize = file.size;

		// TODO: HANDLE FOLDER UPLOADS!!!

		// Begin upload
		let response = await fetch("/api/transfer/startupload", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				fileSize: fileSize
			})
		});

		let data = await response.json();

		if (!data.success) {
			reject("Failed to start upload because server returned success: false");
			return;
		}

		const transferHandle = data.handle;
		console.log(data);

		let readOffset = 0;
		let busyChunks = 0;
		const maxBusyChunks = 1;
		const maxUploadChunkRetries = 1; // TODO: set to 1 for testing reasons

		// TODO: need better error handling (more consistent)

		const uploadChunkToServer = async (writeOffset, chunkArrayBuffer) => {
			const tryUploadChunk = async () => {
				return new Promise(async (_resolve, _reject) => {
					if (typeof(writeOffset) != "number") {
						throw new TypeError("writeOffset must be a number!");
					}

					// Add randomness to test uploading many chunks at random
					await new Promise((res) => {
						setTimeout(res, Math.random() * 100);
					});

					const chunkSize = chunkArrayBuffer.byteLength;
					let totalUploadedBytes = 0;
					let lastEventBytes = 0;

					const xhr = new XMLHttpRequest();
					xhr.open("POST", "/api/transfer/uploadchunk", true);

					xhr.upload.onprogress = (event) => {
						if (!event.lengthComputable)
							return;

						let transferredBytes = event.loaded;
						let deltaBytes = transferredBytes - lastEventBytes;
						deltaBytes = Math.max(deltaBytes, 0);
						lastEventBytes = transferredBytes;
						totalUploadedBytes += deltaBytes;
						totalUploadedBytes = Math.min(totalUploadedBytes, chunkSize);

						// TODO: progress value callback or something
						// console.log(`Progress: ${(totalUploadedBytes / chunkSize) * 100}%`)
					};

					xhr.onload = () => {
						if (xhr.status == 200) {
							// console.log(`Uploaded: ${chunkArrayBuffer.byteLength}`)
							_resolve();
						} else {
							// Try parse json response
							let json = JSON.parse(xhr.response);

							if (json.message) {
								_reject(json.message);
							} else {
								_reject("UNKNOWN ERROR");
							}
						}
					};

					// Send
					const formData = new FormData();
					formData.append("handle", transferHandle);
					formData.append("writeOffset", writeOffset); // Write offset specifies the starting byte where the server will begin writing to the destination upload file
					formData.append("data", new Blob([chunkArrayBuffer]));

					xhr.send(formData);
				});
			};
			
			return new Promise(async (_resolve, _reject) => {
				// Try upload the chunk and if it fails, then retry a few times
				let tries = 0;

				while (tries < maxUploadChunkRetries) {
					tries++;
					
					if (tries > 1) {
						console.log(`Trying to reupload chunk again...`);
					}

					try {
						await tryUploadChunk();
						_resolve(); // Chunk uploaded successfully
						break;
					} catch (error) {
						console.error(`Upload chunk error: ${error}`);
					}
				}

				_reject("Chunk upload failed all retries!");
			});
		};

		const readEventHandler = async (event) => {
			if (event.target.error == null) {
				const chunkArrayBuffer = event.target.result;
				const chunkSize = chunkArrayBuffer.byteLength;

				let writeOffset = readOffset;
				readOffset += chunkSize;
				
				// Upload chunk to server
				try {
					console.log(`Writing at: ${writeOffset} for size: ${chunkSize}`);
					//uploadChunkToServer(writeOffset, chunkArrayBuffer);                    // TODO: UNCOMMENT TO SEE FILE DESCRIPTOR ERRORS FROM SERVER!
					await uploadChunkToServer(writeOffset, chunkArrayBuffer);
				} catch (error) {
					reject(error);
					return; // Cancel upload
				}

				busyChunks--;
			} else {
				console.error(`Read error: ${event.target.error}`);
				return;
			}
			
			if (readOffset >= fileSize) {
				// Return success boolean and the transfer handle
				resolve({
					success: true,
					handle: transferHandle
				});

				return;
			}
		};

		const readChunk = async () => {
			busyChunks++;
			let reader = new FileReader();
			let blob = file.slice(readOffset, readOffset + chunkSize);
			reader.onload = readEventHandler;
			reader.readAsArrayBuffer(blob);

			tryReadNextChunk();
		};

		// This function will try read the next chunk of the file but if the number of busy chunks is too high, then it will wait 50ms and retry. TODO: add limit to retries
		const tryReadNextChunk = async () => {
			if (busyChunks >= maxBusyChunks) {
				console.log(`Timed out.`);

				// Wait a short bit of time before retrying
				setTimeout(() => {
					tryReadNextChunk();
				}, 50);
			} else {
				readChunk();
				// await readChunk();
			}
		};

		tryReadNextChunk();
	});
};

// 'FileExplorerWindow' can hold one or multiple 'FileExplorer' components
function FileExplorerWindow(props) {
	const { filesystemEntriesData } = props;
	const { useAmericanDateFormat } = props.settings; // TODO: have to refresh page to update setting probably
	const [ splitViewMode, setSplitViewMode ] = createSignal(props.state.splitViewEnabled);

	// Checking
	if (filesystemEntriesData == undefined) {
		throw new Error("filesystemEntriesData is undefined!");
	}

	// The actual file explorer component
	const FileExplorer = (localProps) => {
		// Number values can be specified to adjust the relative widths of the columns in the file explorer
		let columnWidthDivider = Object.values(FILESYSTEM_COLUMN_WIDTHS).reduce((a, b) => a + b, 0) / 100;

		// This stores all the metadata of files in the user's currentl filepath.
		// When setFileEntries() is called, the DOM will update with the new entries.
		const [ fileEntries, setFileEntries ] = createSignal([]);
		
		// This function populates the file list with file entries defined in the 'fileEntries' signal.
		const refreshFileList = () => {
			if (localProps.state.sortMode == undefined)
				throw new Error(`localProps.state.sortMode is undefined!`);

			if (typeof(localProps.state.sortAscending) != "boolean")
				throw new TypeError(`localProps.state.sortAscending must be a boolean!`);

			let entries = filesystemEntriesData;

			// Filter by search text if applicable
			if (localProps.state.searchText != undefined) {
				entries = entries.filter(entry => {
					let findIndex = entry.fileName.toLowerCase().search(localProps.state.searchText.toLowerCase());
					return findIndex != -1;
				});
			}

			// Sort
			if (localProps.state.sortMode == FILESYSTEM_SORT_MODES.NAME) {
				if (localProps.state.sortAscending) {
					entries.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" }));
				} else {
					entries.sort((a, b) => b.fileName.localeCompare(a.fileName, undefined, { numeric: true, sensitivity: "base" }));
				}
			} else if (localProps.state.sortMode == FILESYSTEM_SORT_MODES.TYPE) {
				if (localProps.state.sortAscending) {
					entries.sort((a, b) => a.fileType.localeCompare(b.fileType, undefined, { numeric: true, sensitivity: "base" }));
				} else {
					entries.sort((a, b) => b.fileType.localeCompare(a.fileType, undefined, { numeric: true, sensitivity: "base" }));
				}
			} else if (localProps.state.sortMode == FILESYSTEM_SORT_MODES.SIZE) {
				if (localProps.state.sortAscending) {
					entries.sort((a, b) => a.fileSizeInBytes > b.fileSizeInBytes);
				} else {
					entries.sort((a, b) => a.fileSizeInBytes < b.fileSizeInBytes);
				}
			} else if (localProps.state.sortMode == FILESYSTEM_SORT_MODES.DATE_ADDED) {
				if (localProps.state.sortAscending) {
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

			localProps.state.searchText = event.target.value;

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
			const [ visible, setVisible ] = createSignal(localProps.state.sortMode == props.sortMode);

			columnHeaderSortButtonVisibilitySetters.push(setVisible);

			return (
				<RightAngleArrowIcon
					style={`opacity: ${visible() ? 100 : 0}%`}
					class={`aspect-square w-5 h-5 ml-1 rounded-full hover:cursor-pointer hover:bg-zinc-300 rotate-${rotation()}`}
					onClick={() => {
						let sortMode = props.sortMode;

						if (localProps.state.sortMode != sortMode) {
							localProps.state.sortMode = sortMode;
							
							// Set all other sort ascending buttons to be invisible and only set this one to be visible
							columnHeaderSortButtonVisibilitySetters.forEach(setter => setter(false));
							setVisible(true);
						} else {
							// Flip state only when the current store mode is the same as this button's sort mode
							props.sortAscending = !props.sortAscending;
							setRotation(props.sortAscending ? 0 : 180);
						}
						
						// Refresh file list with new sort settings
						localProps.state.sortAscending = props.sortAscending;

						try {
							refreshFileList();
						} catch (error) {
							console.log(`FAILED TO REFRESH FILE LIST FOR REASON: ${error}`);
						}
					}}
					// Make button visible when hovering over it while it's invisible by default (if its not of the current sort type)
					onmouseenter={() => {
						if (props.sortMode != localProps.state.sortMode) {
							setVisible(true);
						}
					}}
					onmouseleave={() => {
						if (props.sortMode != localProps.state.sortMode) {
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
					<Column relativeWidth={FILESYSTEM_COLUMN_WIDTHS.NAME}>
						<FileEntryColumnText text={props.fileName}/>
					</Column>
					<Column relativeWidth={FILESYSTEM_COLUMN_WIDTHS.TYPE}>
						<FileEntryColumnText text={fileTypeText}/>
					</Column>
					<Column relativeWidth={FILESYSTEM_COLUMN_WIDTHS.SIZE}>
						<FileEntryColumnText text={sizeText}/>
					</Column>
					<Column relativeWidth={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
						<FileEntryColumnText text={dateAddedText}/>
					</Column>
				</div>
			);
		}

		// Initialise the file list
		refreshFileList();

		// Define as local variable due to "setting getter-only property" error (TODO: since the window component is never destroyed, maybe just set the state as local values here?)
		let sortAscending = localProps.state.sortAscending;

		// Handle upload window drag events
		const [ uploadWindowVisible, setUploadWindowVisible ] = createSignal(false);

		const handleDragOver = (event) => {
			event.preventDefault();
			setUploadWindowVisible(true);
		};
	
		const handleDragLeave = (event) => {
			setUploadWindowVisible(false);
		};

		const handleDrop = (event) => {
			event.preventDefault();

			// Process dropped files
			const files = event.dataTransfer.files;
			
			for (let i = 0; i < files.length; i++) {
				const file = files[i];

				uploadFileToServer(file)
				.then((result) => {
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
				.catch((error) => {
					console.error(`Upload failed for error: ${error}`);
				});
			}
		};

		return (
			<>
				<div
					onDragOver={handleDragOver}
					class="relative flex flex-col min-w-[550px] w-[100%] h-[100%]"
				>
					<div
						onDrop={handleDrop}
						onDragLeave={handleDragLeave}
						class={`absolute inset-0 flex justify-center items-center backdrop-blur-[2px] w-[100%] h-[100%] z-10`}
						style={`${!uploadWindowVisible() && "display: none;"}`}
						>
						<div
							class={`flex bg-red-500 w-[50%] h-[50%] z-30`}
						>

						</div>
					</div>
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
						<SplitLayoutIcon
							class={`aspect-square w-[27px] h-[27px] ml-3 mr-4 p-[3px] rounded-md invert-[20%]
							hover:cursor-pointer hover:bg-zinc-100 active:bg-zinc-300 ${splitViewMode() ? "bg-zinc-100" : ""}`}
							onClick={() => {
								let newState = !splitViewMode();
								setSplitViewMode(newState);
								props.state.splitViewEnabled = newState; // Update state
							}}
						/>
					</div>
					<div class="flex flex-col w-[100%] overflow-auto bg-zinc-300">
						<div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-6 pb-1 border-b-[1px] border-zinc-300 bg-zinc-200"> {/* Column headers bar */}
							<div class={`h-[100%] aspect-[1.95]`}></div> {/* Icon column (empty) */}
							<Column relativeWidth={FILESYSTEM_COLUMN_WIDTHS.NAME}>
								<ColumnHeaderText text="Name"/>
								<ColumnHeaderSortButton sortAscending={sortAscending} sortMode={FILESYSTEM_SORT_MODES.NAME} />
							</Column>
							<Column relativeWidth={FILESYSTEM_COLUMN_WIDTHS.TYPE}>
								<ColumnHeaderText text="Type"/>
								<ColumnHeaderSortButton sortAscending={sortAscending} sortMode={FILESYSTEM_SORT_MODES.TYPE} />
							</Column>
							<Column relativeWidth={FILESYSTEM_COLUMN_WIDTHS.SIZE}>
								<ColumnHeaderText text="Size"/>
								<ColumnHeaderSortButton sortAscending={sortAscending} sortMode={FILESYSTEM_SORT_MODES.SIZE} />
							</Column>
							<Column relativeWidth={FILESYSTEM_COLUMN_WIDTHS.DATE_ADDED}>
								<ColumnHeaderText text="Date added"/>
								<ColumnHeaderSortButton sortAscending={sortAscending} sortMode={FILESYSTEM_SORT_MODES.DATE_ADDED} />
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
			</>
		);
	}

	// Split view mode dragging resize functionality
	const [ leftWidth, setLeftWidth ] = createSignal(props.state.splitViewLeftWidth);
	const [ rightWidth, setRightWidth ] = createSignal(100 - props.state.splitViewLeftWidth);
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
		const mouseX = event.clientX;
		const mouseXDelta = mouseX - startDraggingX;
		const mouseXDeltaPercentage = (mouseXDelta / masterContainerWidth) * 100;

		let newLeftWidth = startDraggingLeftWidth + mouseXDeltaPercentage;

		// Clamp how much the user can resize the relative width of the two explorers
		if (newLeftWidth < 20) newLeftWidth = 20;
		if (newLeftWidth > 80) newLeftWidth = 80;

		setLeftWidth(newLeftWidth);
		props.state.splitViewLeftWidth = newLeftWidth;
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
				<FileExplorer state={props.state.leftFileListState} />
			</div>
			<div
				class={`flex flex-row h-[100%]`}
				style={`width: ${splitViewMode() ? rightWidth() : "0"}%`}
			>
				<div class={`bg-zinc-300 w-[3px] h-[100%] hover:cursor-ew-resize`} onMouseDown={handleMouseDown}> {/* Draggable separator for the two windows */}

				</div>
				<div class="flex flex-row overflow-auto w-[100%]" style={`width: 100%`}>
					<FileExplorer state={props.state.rightFileListState} />
				</div>
			</div>
		</div>
	);
}

export { FileExplorerWindow, createFilesystemEntry };
