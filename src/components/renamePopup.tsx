import { createSignal, onCleanup } from "solid-js";
import { SubmitButtonStates, getSubmitButtonStyle } from "./submitButton";
import { FilesystemEntry } from "./fileExplorer";
import { sortFilesystemEntryByName } from "../utility/sorting";
import { deduplicateFileEntryName } from "../utility/fileNames";
import { UserFilesystem, UserFilesystemRenameEntry } from "../client/userFilesystem";
import CONSTANTS from "../common/constants";

// Icons
import CloseIcon from "../assets/icons/svg/close.svg?component-solid";

type RenamePopupContext = {
	open?: (entries: FilesystemEntry[], parentHandle: string) => void;
	close?: () => void;
	isOpen?: () => boolean;
};

type RenamePopupProps = {
	context: RenamePopupContext;
	userFilesystem: UserFilesystem;
	refreshCallback: () => void;
};

function RenamePopup(props: RenamePopupProps) {
	const { userFilesystem, refreshCallback } = props;
	const [ isVisible, setVisible ] = createSignal(false);
	const [ buttonState, setButtonState ] = createSignal(SubmitButtonStates.Disabled);
	const [ targetEntries, setTargetEntries ] = createSignal<FilesystemEntry[]>([]);
	const [ showAccessibilityOutline, setAccessibilityOutline ] = createSignal<boolean>(false);
	const [ inputRef, setInputRef ] = createSignal<HTMLInputElement | null>(null);
	const [ isBusy, setBusy ] = createSignal<boolean>(false);
	let currentParentHandle: string = "";
	let originalName = ""; // The original name of the file when the popup is opened

	const validateName = (name: string) => {
		// Cap the length of the text
		if (name.length > CONSTANTS.MAX_FILE_NAME_SIZE)
			name = name.slice(0, CONSTANTS.MAX_FILE_NAME_SIZE);

		return name;
	};

	const onInput = (event: Event) => {
		// @ts-ignore
		let newName = event.target.value as string;
		newName = validateName(newName);

		inputRef()!.value = newName;
		updateButtonState();
	};

	const updateButtonState = () => {
		const trimmedName = inputRef()!.value.trim();

		// TODO: a better algorithm to determine the button state should check if the names of all
		// the files have already been deduplicated (maybe via regex)

		if (trimmedName.length == 0 || (originalName == trimmedName && targetEntries().length == 1)) {
			setButtonState(SubmitButtonStates.Disabled);
		} else {
			setButtonState(SubmitButtonStates.Enabled);
		};
	};

	const confirm = async () => {
		if (!isVisible() || buttonState() == SubmitButtonStates.Disabled)
			return;

		setButtonState(SubmitButtonStates.Disabled);
		setBusy(true);

		const newName = validateName(inputRef()!.value);
		const baseDedupedName = deduplicateFileEntryName(newName, currentParentHandle, userFilesystem);
		console.log(`Submitted name: ${newName}`);
		
		try {
			// TODO: optimise this incredibly inefficient algorithm!
			// Problem: calling deduplicate searches current directory's file entries every single time it gets called
			// Solutions: 1. optimise the function's code
			//            2. use the internal code of the function and make it custom for this specific need

			// Create rename entries
			const renameEntries: UserFilesystemRenameEntry[] = [];

			for (let i = 0; i < targetEntries().length; i++) {
				const entry = targetEntries()[i];
				const name = (i == 0 ? baseDedupedName : deduplicateFileEntryName(baseDedupedName, null, userFilesystem, i - 1));

				renameEntries.push({
					handle: entry.handle,
					newName: name
				});
			};

			// Submit refresh entries
			await userFilesystem.renameEntriesGlobally(renameEntries);

			// Refresh
			refreshCallback();
		} catch (error) {
			console.error(error);
		} finally {			
			setBusy(false);
			props.context.close?.();
		}
	};

	// Set context
	props.context.open = (entries: FilesystemEntry[], parentHandle: string) => {
		if (entries.length == 0) {
			console.error("Tried opening rename popup but provided entries count was zero!");
			return;
		}

		currentParentHandle = parentHandle;

		// Sort entries by alphabetical order
		entries.sort((a, b) => sortFilesystemEntryByName(a, b, false));

		// Update
		setTargetEntries(entries);
		setVisible(true);

		// Select first entry and use that to set the default renaming text
		const firstEntry = entries[0];
		originalName = firstEntry.name;
		inputRef()!.value = firstEntry.name;
		updateButtonState();

		// Force select the input element after the value was updated (the order is important so
		// that by default the whole of the text is selected and not just the end of it)
		const inputElement = inputRef();

		if (inputElement != null) {
			inputElement.select();
		} else {
			console.error("inputRef is null!");
		}
	};

	props.context.close = () => {
		setVisible(false);
	};

	props.context.isOpen = () => isVisible();
	
	// Event handlers
	const handleCloseButton = () => {
		if (isBusy())
			return;
		
		setVisible(false);
		setButtonState(SubmitButtonStates.Disabled);
		setTargetEntries([]);
	};

	// Key events
	const handleKeyPress = (event: KeyboardEvent) => {
		if (event.key == "Enter") {
			confirm();
		}
	};

	document.addEventListener("keypress", handleKeyPress);

	onCleanup(() => {
		document.removeEventListener("keypress", handleKeyPress);
	});

	return (
		<div
			class="
				absolute flex justify-center items-center self-center w-full h-full right-0 z-10
				backdrop-blur-[2px] backdrop-brightness-[0.85]
			"
			style={`${!isVisible() && "display: none;"}`}
			onDrop={(event) => event.preventDefault() } // This is here just in case the user misses the drop window and drops on the edge instead
		>
			<div
				class="
					flex flex-col items-center rounded-xl w-[90%] max-w-[400px] aspect-[3] z-30
					bg-zinc-100 border-solid border-2 border-zinc-500 drop-shadow-xl
				"
			>
				<CloseIcon
					class={`
						absolute w-7 h-7 self-end mr-2 mt-1 rounded-lg
						${isBusy() ?
							"text-zinc-500" :
							"text-zinc-950 hover:bg-zinc-300 active:bg-zinc-400 hover:cursor-pointer"
						}
					`}
					onClick={handleCloseButton}
				/>
				<span class="font-SpaceGrotesk font-semibold text-xl text-zinc-900 mb-0.5 mt-2">
					{`Renaming ${targetEntries().length} item${targetEntries().length != 1 ? "s" : ""}`}
				</span>
				<input
					ref={setInputRef}
					class={`
					flex w-[90%] h-8 px-1.5 mt-2 mb-3
					font-SpaceGrotesk font-normal text-sm
					rounded-md border-2 bg-zinc-200 outline-none
					${showAccessibilityOutline() ? "border-blue-600" : "border-zinc-600"}
					`}
					onInput={onInput}
					onFocus={() => setAccessibilityOutline(true)}
					onBlur={() => setAccessibilityOutline(false)}
					maxLength={CONSTANTS.MAX_FILE_NAME_SIZE}
				/>
				<button
					type="submit"
					class={`${getSubmitButtonStyle(buttonState())} mb-3`}
					disabled={buttonState() == SubmitButtonStates.Disabled || isBusy()}
					onClick={() => {
						confirm();
					}}
				>Rename</button>
			</div>
		</div>
	);
}

export type {
	RenamePopupContext,
	RenamePopupProps
}

export {
	RenamePopup
}
