import { Accessor, createSignal, For } from "solid-js";
import { UPLOAD_FILES_COLUMN_WIDTHS } from "../client/columnWidths";
import { getFormattedByteSizeText } from "../common/commonUtils";
import { Column, ColumnText } from "./column";
import { SubmitButtonStates, getSubmitButtonStyle } from "./submitButton";
import { UploadFileEntry, UploadSettings } from "../client/transfers";
import { UserSettings } from "../client/userSettings";
import { UserFilesystem } from "../client/userFilesystem";
import cryptoRandomString from "crypto-random-string";
import CONSTANTS from "../common/constants";

// Icons
import CloseButton from "../assets/icons/svg/close.svg?component-solid";
import DesktopIcon from "../assets/icons/svg/desktop-icon.svg?component-solid";
import CheckboxTickIcon from "../assets/icons/svg/checkbox-tick.svg?component-solid";
import AlertTriangle from "../assets/icons/svg/alert-triangle.svg?component-solid";

type UploadEntryProps = {
	name: string;
	size: number;
	userSettings: Accessor<UserSettings>;
};

type CheckboxSettingProps = {
	nameText: string;
	settingCallback: Function;
	defaultValue: boolean;
};

function UploadEntry(props: UploadEntryProps) {
	const { name, size, userSettings } = props;
	const sizeInBytesText = getFormattedByteSizeText(size, userSettings().dataSizeUnit);

	return (
		<div class="flex flex-row w-full h-6 mb-[1px]">
			<Column width={UPLOAD_FILES_COLUMN_WIDTHS.NAME}>
				<ColumnText textSize="sm" text={name} ellipsis />
			</Column>
			<Column width={UPLOAD_FILES_COLUMN_WIDTHS.SIZE}>
				<ColumnText text={sizeInBytesText} />
			</Column>
		</div>
	);
}

function CheckboxSetting(props: CheckboxSettingProps) {
	const { nameText, settingCallback, defaultValue } = props;
	const [ enabled, setEnabled ] = createSignal(defaultValue);

	return (
		<div class="flex flex-col w-full h-7 px-2 py-2">
			<div class="flex flex-row">
				<div
					class={`flex flex-row items-center border-2 w-5 h-5 rounded-md
									${enabled() ? "border-blue-600" : "border-zinc-400"}
								 hover:bg-blue-100 hover:cursor-pointer active:bg-blue-200`}
					onClick={() => {
						const newValue = !enabled();
						setEnabled(newValue);
						settingCallback(newValue);
					}}
				>
					<CheckboxTickIcon
						class="w-4 h-4 text-blue-600"
						style={!enabled() ? "visibility: hidden;" : ""}
					/>
				</div>
				<span class="ml-2 font-SpaceGrotesk text-sm">{nameText}</span>
			</div>
		</div>
	);
}

type UploadFilesPopupContext = {
	open?: (directoryHandle: string) => void;
	close?: () => void;
	isOpen?: () => boolean;
}

type UploadFilesPopupProps = {
	context: UploadFilesPopupContext;
	userFilesystem: UserFilesystem;
	uploadCallback: (entries: UploadFileEntry[]) => void; // TODO: type checking for functions???
	userSettings: Accessor<UserSettings>;
	uploadSettings: UploadSettings;
};

function UploadFilesPopup(props: UploadFilesPopupProps) {
	const { userFilesystem, uploadCallback, userSettings, uploadSettings } = props;
	const [ entriesData, setEntriesData ] = createSignal<UploadFileEntry[]>([]);
	const [ isDraggingOver, setDraggingOver ] = createSignal(false);
	const [ buttonState, setButtonState ] = createSignal(SubmitButtonStates.Disabled);
	const [ isVisible, setVisible ] = createSignal(false);
	const [ uploadPathText, setUploadPathText ] = createSignal("???");
	let currentOpenDirectoryHandle = "";

	const updateEntriesFromFileList = (fileList: FileList | null) => {
		if (fileList === null || fileList.length == 0) {
			setEntriesData([]);
			return;
		}

		// Every character as zeroes in the file handle points to the root directory
		let newUploadEntries: UploadFileEntry[] = [];

		// Convert files in the file list to upload entries
		for (let i = 0; i < fileList.length; i++) {
			const file = fileList[i];

			if (file.size > CONSTANTS.MAX_FILE_SIZE) {
				console.error(`TEMPORARY WARNING: '${file.name}' has a size that is too big!`);
				continue;
			}

			newUploadEntries.push({
				fileName: file.name,
				fileSize: file.size,
				file: file,
				parentHandle: currentOpenDirectoryHandle,
				progressCallbackHandle: cryptoRandomString({ length: CONSTANTS.PROGRESS_CALLBACK_HANDLE_LENGTH, type: "alphanumeric" })
			});
		}
		
		// Sort
		newUploadEntries.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" }));

		setEntriesData(newUploadEntries);
		setButtonState(SubmitButtonStates.Enabled);
	};

	const handleDragOver = (event: any) => {
		event.preventDefault();
		setDraggingOver(true);
	};
	
	const handleDragLeave = (event: any) => {
		setDraggingOver(false);
	};

	const handleDrop = (event: any) => {
		event.preventDefault();
		updateEntriesFromFileList(event.dataTransfer.files);
		setDraggingOver(false);
	};

	// Set context
	props.context.open = (directoryHandle: string) => {
		currentOpenDirectoryHandle = directoryHandle;
		setUploadPathText(userFilesystem.getFullPathStringFromHandle(directoryHandle, "/"));
		setVisible(true);
	};

	props.context.close = () => {
		setVisible(false);
	};

	props.context.isOpen = () => isVisible();

	// Upload settings
	let promptFileUploadInputHtmlElement: HTMLInputElement | undefined;

	return (
		<div
			class="absolute flex justify-center items-center self-center backdrop-blur-[2px] w-full h-full right-0 z-10 backdrop-brightness-[0.85]"
			style={`${!isVisible() && "display: none;"}`}
			onDrop={(event) => event.preventDefault() } // This is here just in case the user misses the drop window and drops on the edge instead
		>
			<div
				class="flex flex-col rounded-xl bg-zinc-100 border-solid border-2 border-zinc-500 w-[90%] max-w-[700px] aspect-[2] z-30 items-center drop-shadow-xl"
			>
				<CloseButton
					class="absolute w-8 h-8 self-end mr-2 mt-1 rounded-lg hover:bg-zinc-300 active:bg-zinc-400 hover:cursor-pointer"
					onClick={() => {
						setVisible(false);
						setEntriesData([]); // Clear entries
						setButtonState(SubmitButtonStates.Disabled);
					}}
				/>
				<span class="font-SpaceGrotesk font-semibold text-2xl text-zinc-900 mb-0.5 mt-2">Upload files</span>
				<span class="font-SpaceGrotesk font-medium text-sm text-blue-600 text-center mb-2">{`Path: ${uploadPathText()}`}</span>
				{(buttonState() == SubmitButtonStates.Disabled) ? (
					<div
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						onDrop={handleDrop}
						class={`flex flex-col justify-center w-[90%] h-full mb-3 border-2 border-dashed transition-all
										${isDraggingOver() ? "rounded-2xl border-blue-700 bg-blue-200" : "rounded-md border-blue-500 bg-blue-100"}`}
					>
						<span class="font-SpaceGrotesk font-semibold text-3xl text-blue-600 self-center pointer-events-none select-none">Drag and drop</span>
						<span class="font-SpaceGrotesk font-medium text-xl text-blue-500 mt-1 self-center pointer-events-none select-none">OR</span>
						<input
							// This input exists so the .click() function can be called, prompting the user to select files for upload
							ref={promptFileUploadInputHtmlElement}
							type="file"
							onInput={(e) => updateEntriesFromFileList(e.target.files)}
							multiple
							hidden
						/>
						<button
							class="flex flex-row self-center rounded-md px-1 py-0.5 hover:cursor-pointer hover:bg-blue-200 active:bg-blue-300"
							onClick={async () => {
								if (promptFileUploadInputHtmlElement) {
									promptFileUploadInputHtmlElement.click();
								} else {
									console.error("Couldn't find prompt file upload input html element!");
								}
							}}
						>
							<DesktopIcon class="w-[30px] h-[30px] mr-1 text-blue-600" />
							<span class="font-SpaceGrotesk font-semibold text-xl text-blue-600 self-center pointer-events-none select-none">Browse computer</span>
						</button>
					</div>
				) : (
					<div class="flex flex-row justify-between w-[93%] h-full mb-3 ml-[5%] mr-[3%]">
						<div class="flex flex-col w-[65%] h-full mr-2 bg-zinc-200 rounded-md overflow-y-auto">
							<div class="flex flex-row flex-nowrap flex-shrink-0 w-full h-7 border-b-[1px] border-zinc-400 bg-zinc-300 rounded-t-md">
								<Column width={UPLOAD_FILES_COLUMN_WIDTHS.NAME}>
									<ColumnText text="Name" semibold ellipsis/>
								</Column>
								<Column width={UPLOAD_FILES_COLUMN_WIDTHS.UPLOAD}>
									<ColumnText text="Size" semibold/>
								</Column>
							</div>
							<For each={entriesData()}>
								{(entryInfo) => (
									<UploadEntry name={entryInfo.fileName} size={entryInfo.fileSize} userSettings={userSettings} />
								)}
							</For>
						</div>
						<div class="flex flex-col w-[35%] h-full rounded-md border-blue-200 border-dashed">
							<CheckboxSetting
								settingCallback={(value: boolean) => uploadSettings.optimiseVideosForStreaming = value}
								defaultValue={uploadSettings.optimiseVideosForStreaming}
								nameText="Optimise videos for streaming"
							/>
							<span class="flex flex-row font-SpaceGrotesk text-medium text-xs text-red-600 px-2 py-6">
								<AlertTriangle class="shrink-0 mr-2 ml-0.5" />
								Optimising videos for streaming will modify the file and use more RAM (EXPERIMENTAL)
							</span>
						</div>
					</div>
				)}
				<span class="space-x-2">
					<button
						type="submit"
						class={`${getSubmitButtonStyle(buttonState())} mb-3`}
						disabled={buttonState() == SubmitButtonStates.Disabled}
						onClick={() => {
							const data: UploadFileEntry[] = entriesData();
							setEntriesData([]); // Clear gui entries
							setButtonState(SubmitButtonStates.Disabled);
							setVisible(false);
							uploadCallback(data);
						}}
					>
						Upload
					</button>
				</span>
			</div>
		</div>
	);
}

export type {
	UploadFileEntry,
	UploadFilesPopupContext,
	UploadFilesPopupProps
}

export {
	UploadFilesPopup
}
