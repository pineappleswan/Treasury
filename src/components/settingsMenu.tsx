import { Accessor, createSignal, For, onCleanup } from "solid-js";
import { getTimeZones } from "@vvo/tzdb";
import { naturalCompareString } from "../utility/sorting";
import { DataSizeUnitSetting, getTimezoneOffsetInMinutesFromTimezoneName, UserSettings } from "../client/userSettings";
import { getLocalStorageUserCryptoInfo } from "../client/localStorage";
import binarySearch from "binary-search"; // TODO: REMOVE PACKAGE?
import cloneDeep from "clone-deep";
import base64js from "base64-js";

import RightAngleArrow from "../assets/icons/svg/right-angle-arrow.svg?component-solid";
import AlertTriangle from "../assets/icons/svg/alert-triangle.svg?component-solid";
import CheckboxTickIcon from "../assets/icons/svg/checkbox-tick.svg?component-solid";

// SPACING COMPONENT

type SpacingProps = {
	height: number;
}

function Spacing(props: SpacingProps) {
	return (
		<div
			class={`flex shrink-0 w-full`}
			style={`height: ${props.height}px;`}
		></div>
	)
}

// SEPARATOR LINE COMPONENT

function SeparatorLine() {
	return (
		<div class="w-full h-[1px] mx-4 mt-1 bg-zinc-300"></div>
	)
}

// SECTION COMPONENT

type SectionProps = {
	title: string;
	hierarchyId: number; // Integer between 0 and 4 inclusive. Higher numbers mean a smaller text font
	defaultClosed?: boolean; // True if the section should be collapsed/closed by default
	children?: any;
}

function Section(props: SectionProps) {
	const [ isOpen, setOpen ] = createSignal(true);
	const { title, hierarchyId, defaultClosed, children } = props;
	let textSizeClass = "";

	if (defaultClosed) {
		setOpen(false);
	}

	// Determine text size
	switch (hierarchyId) {
		case 0: textSizeClass = "text-xl"; break;
		case 1: textSizeClass = "text-lg"; break;
		case 2: textSizeClass = "text-md"; break;
		case 3: textSizeClass = "text-sm"; break;
		case 4: textSizeClass = "text-xs"; break;
		default: console.error(`Invalid hierarchy id for section! Value: ${hierarchyId}`);
	}

	const switchOpenState = () => {
		setOpen(!isOpen());
	};

	return (
		<div>
			<div
				class="
					flex flex-row items-center w-full ml-3 rounded-lg 
					hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300
				"
				onClick={switchOpenState}
			>
				<span class={`pl-2 grow font-SpaceGrotesk ${textSizeClass} font-medium text-zinc-900 select-none`}>{title}</span>
				<RightAngleArrow class={`w-7 h-7 rounded-lg ${isOpen() ? "rotate-180" : "rotate-90"}`} />
			</div>
			<SeparatorLine />
			<div
				class={`
				${!isOpen() && "hidden"}
				`}
			>
				<Spacing height={8} />
				{children}
				<Spacing height={12} />
			</div>
			<Spacing height={12} />
		</div>
	)
}

// SUBTITLE COMPONENT

type SubtitleProps = {
	text: string;
}

function Subtitle(props: SubtitleProps) {
	const { text } = props;

	return (
		<span class="py-0.5 ml-5 font-SpaceGrotesk text-sm font-medium text-zinc-900 mt-2">{text}</span>
	)
}

// FILE SELECTOR COMPONENT

function FileSelector(props: any) {
	return (
		<div class="flex w-40 h-6 bg-zinc-100 border-[1px] border-zinc-300 rounded-md ml-5 mt-2">
			
		</div>
	)
}

// CHECKBOX COMPONENT

type CheckboxProps = {
	name: string;
	options: string[];
}

function Checkbox(props: CheckboxProps) {
	return (
		<div class="flex flex-row">
			<Subtitle text={props.name} />
		</div>
	)
}

// MULTI RADIO BUTTON COMPONENT

type MultiRadioButtonProps = {
	name: string;
	options: string[];
	defaultOption: string;
	optionSelectedCallback: (option: string) => void;
	optionalColumnWidth?: number; // In pixels
}

function MultiRadioButtonOption(props: MultiRadioButtonProps) {
	const { name, options, defaultOption, optionSelectedCallback, optionalColumnWidth } = props;

	// Ensure default option is valid
	if (!options.includes(defaultOption)) {
		console.error("defaultOption is invalid!");
		return;
	}

	const [ selectedOption, setSelectedOption ] = createSignal(props.defaultOption);

	return (
		<div class="flex flex-col">
			<Subtitle text={name} />
			<div class="flex flex-col ml-8">
				<For each={options}>
					{(option) => (
						<div class="flex flex-row items-center h-7" style={`width: ${optionalColumnWidth ? optionalColumnWidth : 256}px;`}>
							<div
								class={`
									flex items-center justify-center w-[17px] h-[17px] border-[2px] rounded-full
									hover:cursor-pointer hover:bg-zinc-200 active:bg-blue-200
									${selectedOption() == option ? "border-teal-500" : "border-zinc-900"}
								`}
								onClick={() => {
									if (selectedOption() == option)
										return;
									
									setSelectedOption(option);
									optionSelectedCallback(option);
								}}
							>	
								<div
									class={`w-[9px] h-[9px] bg-teal-500 rounded-full ${selectedOption() != option && "hidden"}`}
								>
									
								</div>
							</div>
							<span
								class="font-SpaceGrotesk font-normal text-zinc-900 ml-2 grow"
								style={`font-size: 0.825rem; line-height: 1rem;`}
							>{option}</span>
						</div>
					)}
				</For>
			</div>
		</div>
	)
}

// DROPDOWN SELECTOR COMPONENT

type DropdownSelectorOnSetCallback = (setting: string) => void;

type DropdownSelectorProps = {
	options: string[];
	optionsTags?: Map<string, string[]>; // Allows the user to search for some options even when it doesn't match the option's text.
	defaultOption: string;
	widthInPixels: number;
	onSetCallback: DropdownSelectorOnSetCallback;
}

function DropdownSelector(props: DropdownSelectorProps) {
	const { options, optionsTags, defaultOption, widthInPixels, onSetCallback } = props;

	// Config
	const dropdownElementHeight = 24;
	const maxDropdownElementsVisible = 8;

	// Find default option's index in the options
	const defaultIndex = options.indexOf(defaultOption);

	if (defaultIndex < 0) {
		console.error("Default option was not found in the list of options in the dropdown selector component!");
		return;
	}

	// Variables
	const [ visibleOptions, setVisibleOptions ] = createSignal<string[]>([]);
	const [ selectedOption, setSelectedOption ] = createSignal(options[defaultIndex]);
	const [ dropdownVisible, setDropdownVisible ] = createSignal(false);
	const [ editable, setEditable ] = createSignal(false);
	const [ searchText, setSearchText ] = createSignal("");
	const [ menuHeight, setMenuHeight ] = createSignal(0);
	const [ showOutline, setShowOutline ] = createSignal(false);
	let inputRef: HTMLInputElement | undefined;
	let parentDivRef: HTMLDivElement | undefined;

	const refreshVisibleOptions = (includeSelectedOption: boolean) => {
		const newOptions: string[] = [];
		const loweredSearchText = searchText().toLowerCase();

		options.forEach(option => {
			if (!includeSelectedOption && option == selectedOption())
				return;

			// Check tags
			let canInclude = false;

			if (optionsTags) {
				const tags = optionsTags.get(option);

				if (tags) {
					const found = tags.some(tag => tag.toLowerCase().includes(loweredSearchText));

					if (found) {
						canInclude = true;
					}
				}
			}

			// Check if name is searchable
			if (!canInclude) {
				if (loweredSearchText.length == 0 || option.toLowerCase().includes(loweredSearchText)) {
					canInclude = true;
				}
			}

			if (canInclude)
				newOptions.push(option);
		});

		setVisibleOptions(newOptions);
			
		// Calculate menu height
		const height = dropdownElementHeight * Math.min(maxDropdownElementsVisible, newOptions.length + 1) + 1;
		setMenuHeight(height);
	}

	const onDropdownOpen = () => {
		//setDropdownVisible(true);
		setDropdownVisible(true);
		setSearchText("");
		refreshVisibleOptions(false);
		setShowOutline(true);
	}

	const onEditFocus = () => {
		setEditable(true);
		setDropdownVisible(true);
		inputRef?.focus();
		refreshVisibleOptions(true);
	}

	const onEditFocusLost = () => {
		setEditable(false);
		setDropdownVisible(false);
		setSearchText("");
		setShowOutline(false);
	}

	const onEditKeyDown = (event: KeyboardEvent) => {
		// If user presses enter on the search bar and there is exactly one option, then it will be automatically set to it.
		if (event.key == "Enter" && visibleOptions().length == 1) {
			const option = visibleOptions()[0];

			// Set option
			setSelectedOption(option);
			onSetCallback(option);

			// Reset
			setEditable(false);
			setDropdownVisible(false);
			setSearchText("");
		}
	}

	const onSearchInputUpdate = (event: InputEvent) => {
		// @ts-ignore
		const text = event.target.value;
		setSearchText(text);
		refreshVisibleOptions(true);
	}

	// Handle global click event
	const handleDocumentMouseDown = (event: MouseEvent) => {
		if (parentDivRef === undefined) {
			console.error("parentDivRef is undefined!");
			return;
		}

		const clickX = event.clientX;
		const clickY = event.clientY;
		const bounds = parentDivRef.getBoundingClientRect();

		if (clickX < bounds.left || clickX > bounds.right || clickY < bounds.top || clickY > bounds.bottom) {
			setDropdownVisible(false);
			setEditable(false);
			setSearchText("");
			setShowOutline(false);
		}
	}

	document.addEventListener("mousedown", handleDocumentMouseDown);

	onCleanup(() => {
		document.removeEventListener("mousedown", handleDocumentMouseDown);
	});
	
	// First refresh
	refreshVisibleOptions(false);

	return (
		<div
			ref={parentDivRef}
			class={`
				relative flex flex-col bg-white border-[1px] border-zinc-300 rounded-md ml-5 mt-2
				${showOutline() && "outline-2 outline-blue-600 outline outline-offset-1"}
			`}
			style={`
				width: ${widthInPixels}px;
				height: ${dropdownVisible() ? menuHeight() : dropdownElementHeight}px;
				${dropdownVisible() && `margin-bottom: -${menuHeight() - dropdownElementHeight}px; z-index: 10;`}
			`}
		>
			<div
				class={`
					flex flex-row shrink-0 content-center w-full
					${dropdownVisible() ? "border-b-[1px] border-zinc-300 rounded-tl-md rounded-tr-md" : "rounded-md"}
				`}
				style={`height: ${dropdownElementHeight - 1}px;`}
			>
				{editable() ? (
					<input
						ref={inputRef}
						type="text"
						class="
							flex items-center w-full h-full pl-1.5 bg-transparent pb-[1px] rounded-md
							font-SpaceGrotesk text-sm font-normal overflow-clip text-ellipsis
							select-none outline-none
						"
						onBlur={onEditFocusLost}
						onInput={onSearchInputUpdate}
						onKeyDown={onEditKeyDown}
						onFocus={() => setShowOutline(true)}
					>
						{selectedOption()}
					</input>
				) : (
					<span
						class="
							flex w-full h-full font-SpaceGrotesk text-sm font-normal pl-1.5 overflow-clip text-ellipsis select-none
							rounded-l-md
							hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300
						"
						onClick={onEditFocus}
					>
						{selectedOption()}
					</span>
				)}
				<div
					class={`
						flex shrink-0 items-center justify-center aspect-[1.1]
						border-l-[1px] border-zinc-300 rounded-r-sm
						hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300
					`}
					style={`height: ${dropdownElementHeight - 2}px;`}
					onClick={onDropdownOpen}
				>
					<RightAngleArrow class="w-5 h-5 rotate-180" />
				</div>
			</div>
			<div
				class="flex flex-col overflow-y-auto w-full"
				style={`height: ${menuHeight()}px; scrollbar-width: thin;`}
			>
				{dropdownVisible() && (
					<For each={visibleOptions()}>
						{(option) => (
							<div
								class="
									flex items-center w-full shrink-0 font-SpaceGrotesk text-sm pl-1.5 select-none align-self-center
									overflow-clip text-ellipsis whitespace-nowrap
									hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300
								"
								style={`height: ${dropdownElementHeight}px;`}
								onMouseDown={() => {
									setDropdownVisible(false);
									setSelectedOption(option);
									onSetCallback(option);
								}}
							>
								{option}
							</div>
						)}
					</For>
				)}
			</div>
		</div>
	)
}

// WARNING TEXT COMPONENT

type WarningTextProps = {
	text: string;
}

function WarningText(props: WarningTextProps) {
	const { text } = props;
	
	return (
		<div class="flex flex-row w-full ml-5">
			<AlertTriangle class="w-5 h-5 text-red-500" />
			<span class="font-SpaceGrotesk text-red-500 text-sm ml-2">{text}</span>
		</div>
	)
}

// SPOILER TEXT COMPONENT

type SpoilerTextProps = {
	name: string;
	text: string;
	namePixelWidth: number;

	// When provided, a function will be added to the array where when called, will hide the spoiler text again
	optionalHideFunctionArray?: Function[];
}

function SpoilerText(props: SpoilerTextProps) {
	const { optionalHideFunctionArray } = props;
	const [ visible, setVisible ] = createSignal(false);

	if (optionalHideFunctionArray) {
		optionalHideFunctionArray.push(() => {
			setVisible(false);
		});
	}

	return (
		<div class="flex flex-row items-center w-full h-6">
			<span
				class="font-SpaceGrotesk text-sm font-normal text-zinc-900 ml-10"
				style={`width: ${props.namePixelWidth}px`}
			>{props.name}</span>
			<div
				class={`
					flex items-center justify-center ml-5 rounded-md px-1
					${visible() ? 
						"bg-zinc-300" :
						"bg-zinc-700 hover:cursor-pointer hover:bg-zinc-800"
					}
				`}
				onClick={() => setVisible(true)}
			>
				<span class={`font-IBMPlexMono text-sm font-medium ${visible() ? "text-zinc-900" : "text-transparent select-none"}`}>{props.text}</span>
			</div>
		</div>
	)
}

// INPUT TEXT BOX COMPONENT

type InputTextboxProps = {
	name: string;
	namePixelWidth: number;
	defaultValue: string;
	onInputChangeCallback: (value: string) => void;

	// Return false if input should be ignored and the text box be reset to the previous value.
	// Return true if input is considered valid
	// Return a string to modify the input value
	isValidCallback?: (value: string) => string | boolean;
}

function InputTextbox(props: InputTextboxProps) {
	const { name, namePixelWidth, defaultValue, onInputChangeCallback, isValidCallback } = props;
	const [ currentText, setCurrentText ] = createSignal(defaultValue);
	let inputElement: HTMLInputElement | undefined;

	const handleOnChange = (event: Event) => {
		// @ts-ignore
		const newValue = event.target.value;

		// Check if new value is valid if applicable
		if (isValidCallback) {
			if (!isValidCallback(newValue)) {
				inputElement!.value = currentText();
				return;
			}
		}

		setCurrentText(newValue);
		onInputChangeCallback(newValue);
	};

	return (
		<div class="flex flex-row items-center w-full h-6">
			<span
				class="font-SpaceGrotesk text-sm font-normal text-zinc-900 ml-10"
				style={`width: ${namePixelWidth}px`}
			>{name}</span>
			<input
				ref={inputElement}
				type="text"
				class="
					flex grow border-[1px] border-zinc-300 h-full ml-5 rounded-md pl-1
					font-SpaceGrotesk text-sm
				"
				onChange={handleOnChange}
				value={currentText()}
			/>
		</div>
	)
}

// SETTINGS MENU COMPONENT

// TODO: support new profile picture blobs
type SettingsMenuUpdateCallback = (settings: UserSettings) => boolean; // Return true for success

type SettingsMenuContext = {
	close?: () => void; // Must be called when the settings menu is closed (i.e when the user clicks another navigation button)
}

type SettingsMenuProps = {
	context: SettingsMenuContext;
	visible: boolean;
	userSettingsAccessor: Accessor<UserSettings>;
	userSettingsUpdateCallback: SettingsMenuUpdateCallback;
};

function SettingsMenuWindow(props: SettingsMenuProps) {
	const { userSettingsUpdateCallback, userSettingsAccessor } = props;
	const [ canSave, setCanSave ] = createSignal(false);
	let currentUserSettings = cloneDeep(userSettingsAccessor()); // The currently used settings (i.e the reference point)
	const modifiedUserSettings = cloneDeep(userSettingsAccessor()); // This is what the settings menu will modify

	// Get local storage user crypto info
	const userLocalCryptoInfo = getLocalStorageUserCryptoInfo();

	if (userLocalCryptoInfo == null) {
		console.error("userLocalCryptoInfo is null!");
		return;
	}

	// Prepare timezone options
	const timezoneDropdownOptions = [
		"Automatic",
		"UTC",
	];

	const timezones = getTimeZones();

	// Allow searching for timezones by country name
	const timezoneSearchTags = new Map<string, string[]>();

	// Add options
	timezones.forEach(timezone => {
		const option = timezone.name;
		timezoneDropdownOptions.push(option);
		timezoneSearchTags.set(option, [ timezone.countryName ]);
	});

	timezoneDropdownOptions.sort((a, b) => {
		if (a == "Automatic" || a == "UTC") {
			return -1;
		} else {
			return naturalCompareString(a, b);
		}
	});

	const themeDropdownOptions = [
		"Light",
		"Dark",
		"Paper",
		"Nebula",
		"Sunset"
	];

	const sizeUnitsOptions = [
		"Binary (KiB, MiB ...)",
		"Decimal (KB, MB ...)"
	];

	// ONLY for international or american date formatting at the moment because the user settings type has a boolean for using the american date format
	const timeDateFormatOptions = [
		"DD/MM/YYYY",
		"MM/DD/YYYY"
	];

	// TODO: parse user settings json from server!
	const defaultThemeDropdownOption = themeDropdownOptions[0];
	const defaultTimezoneDropdownOption = timezoneDropdownOptions[0];
	const defaultSizeUnitOption = sizeUnitsOptions[1];
	const defaultTimeDateFormatOption = timeDateFormatOptions[0];
	const defaultMediaViewerDefaultVolume = "100";

	const themeSettingCallback: DropdownSelectorOnSetCallback = (setting: string) => {
		if (setting == modifiedUserSettings.theme)
			return;

		modifiedUserSettings.theme = setting;
		setCanSave(true);
	};

	const timezoneSettingCallback: DropdownSelectorOnSetCallback = (setting: string) => {
		if (setting == modifiedUserSettings.timezoneSetting)
			return;

		modifiedUserSettings.timezoneSetting = setting;
		modifiedUserSettings.timezoneOffsetInMinutes = getTimezoneOffsetInMinutesFromTimezoneName(setting);
		setCanSave(true);
	};

	const sizeUnitTypesOptionCallback = (option: string) => {
		// Convert to data size unit enum type
		const newSizeUnitOption = (option == sizeUnitsOptions[0] ? DataSizeUnitSetting.Base2 : DataSizeUnitSetting.Base10);

		if (newSizeUnitOption == modifiedUserSettings.dataSizeUnit)
			return;

		modifiedUserSettings.dataSizeUnit = newSizeUnitOption;
		setCanSave(true);
	};

	const timeDateFormatOptionCallback = (option: string) => {
		const newFormatOptionIsAmerican = (option == timeDateFormatOptions[1] ? true : false);
		
		if (newFormatOptionIsAmerican == modifiedUserSettings.useAmericanDateFormat)
			return;

		modifiedUserSettings.useAmericanDateFormat = newFormatOptionIsAmerican;
		setCanSave(true);
	};

	const onSaveButtonClick = () => {
		// Check if settings are modified
		const keys = Object.keys(currentUserSettings) as Array<keyof UserSettings>;
		let isModified = false;

		keys.forEach(key => {
			if (currentUserSettings[key] != modifiedUserSettings[key]) {
				isModified = true;
			}
		});

		// If nothing was modified, don't save.
		if (!isModified) {
			setCanSave(false);
			return;
		}

		const success = userSettingsUpdateCallback(cloneDeep(modifiedUserSettings));

		if (success) {
			// Update the reference point
			currentUserSettings = cloneDeep(modifiedUserSettings);
			setCanSave(false);
		}
	};

	const onDiscardChangesClick = () => {
		

		setCanSave(false);
	};

	// Callbacks
	const mediaViewerDefaultVolumeInputChangeCallback = (value: string) => {
		// Validity is checked in the validity check callback, so we can call parseInt safely here
		modifiedUserSettings.defaultMediaViewerVolume = parseInt(value) / 100; // Divide by 100 to normalise
		setCanSave(true);
	};

	const mediaViewerDefaultVolumeIsValidCallback = (value: string) => {
		// Ensure value is an integer (i.e contains only digits)
		if (/^\d+$/.test(value)) {
			// Ensure number is in valid range
			const number = parseInt(value, 10);

			if (number < 0 || number > 100)
				return false;

			return true;
		} else {
			return false;
		}
	};

	// Spoiler text hide functions
	const spoilerTextHideFunctions: Function[] = [];

	// Context
	props.context.close = () => {
		spoilerTextHideFunctions.forEach(f => f());
	};

	return (
		<div
			class={`flex flex-col w-full h-full bg-zinc-50 overflow-y-auto`}
			style={`${!props.visible && "display: none;"}`}
		>
			<div class="flex flex-col max-w-[700px] w-[60%] min-w-[520px] h-full shrink-0">
				<div class="flex flex-col w-full">
					{/* Top padding */}
					<Spacing height={10} />

					{/* Profile section */}
					<Section title={"Profile"} hierarchyId={0} >
						<Subtitle text={"Profile picture"} />
						<div class="w-20 h-20 rounded-full bg-zinc-200 ml-5 my-2 border-[1px] border-zinc-300">
							
						</div>
						<FileSelector />
					</Section>

					{/* Appearance section */}
					<Section title={"Appearance"} hierarchyId={0} >
						<Subtitle text={"Theme"} />
						<DropdownSelector
							options={themeDropdownOptions}
							defaultOption={defaultThemeDropdownOption}
							widthInPixels={200}
							onSetCallback={themeSettingCallback}
							/>
						<Spacing height={8} />
						<Subtitle text={"Timezone"} />
						<DropdownSelector
							options={timezoneDropdownOptions}
							defaultOption={defaultTimezoneDropdownOption}
							optionsTags={timezoneSearchTags}
							widthInPixels={350}
							onSetCallback={timezoneSettingCallback}
						/>
						<Spacing height={4} />
						<MultiRadioButtonOption
							name={"Data size unit format"}
							options={sizeUnitsOptions}
							defaultOption={defaultSizeUnitOption}
							optionalColumnWidth={200}
							optionSelectedCallback={sizeUnitTypesOptionCallback}
						/>
						<MultiRadioButtonOption
							name={"Time date format"}
							options={timeDateFormatOptions}
							defaultOption={defaultTimeDateFormatOption}
							optionalColumnWidth={200}
							optionSelectedCallback={timeDateFormatOptionCallback}
						/>
						<Spacing height={8} />
					</Section>

					{/* Security & Privacy section */}
					<Section title={"Security & Privacy"} hierarchyId={0} >
						
					</Section>

					{/* Advanced section */}
					<Section title={"Advanced"} hierarchyId={0} defaultClosed >
						<InputTextbox
							name="Media viewer default volume"
							namePixelWidth={200}
							defaultValue={defaultMediaViewerDefaultVolume}
							isValidCallback={mediaViewerDefaultVolumeIsValidCallback}
							onInputChangeCallback={mediaViewerDefaultVolumeInputChangeCallback}
						/>
					</Section>

					{/* Keypairs */}
					<Section title={"Keypairs"} hierarchyId={0} defaultClosed >
						<Spacing height={8} />
						<WarningText text="Do not show anyone your private keys unless you know what you're doing!" />
						<Spacing height={8} />
						<Subtitle text={"Ed25519"} />
						<SpoilerText
							name={"Private key"}
							namePixelWidth={80}
							text={base64js.fromByteArray(userLocalCryptoInfo.ed25519PrivateKey)}
							optionalHideFunctionArray={spoilerTextHideFunctions}
						/>
						<Spacing height={2} />
						<SpoilerText
							name={"Public key"}
							namePixelWidth={80}
							text={base64js.fromByteArray(userLocalCryptoInfo.ed25519PublicKey)}
							optionalHideFunctionArray={spoilerTextHideFunctions}
						/>
						<Spacing height={8} />
						<Subtitle text={"X25519"} />
						<SpoilerText
							name={"Private key"}
							namePixelWidth={80}
							text={base64js.fromByteArray(userLocalCryptoInfo.x25519PrivateKey)}
							optionalHideFunctionArray={spoilerTextHideFunctions}
						/>
						<Spacing height={2} />
						<SpoilerText
							name={"Public key"}
							namePixelWidth={80}
							text={base64js.fromByteArray(userLocalCryptoInfo.x25519PublicKey)}
							optionalHideFunctionArray={spoilerTextHideFunctions}
						/>
					</Section>

					{/* Control bar */}
					<SeparatorLine />
					<Spacing height={12} />
					<div class="flex flex-row items-center">
						{/* Save button */}
						<div
							class={`
								flex items-center justify-center px-2 h-7 ml-5 rounded-md border-[2px]
								${canSave() ?
									"bg-sky-400 border-sky-500 hover:cursor-pointer active:bg-sky-300" :
									"bg-zinc-300 border-zinc-400"
								}
							`}
							style={``}
							onClick={onSaveButtonClick}
						>
							<span class="font-SpaceGrotesk text-white text-md font-semibold select-none">Save</span>
						</div>
					</div>

					{/* Bottom padding */}
					<Spacing height={200} />
				</div>
			</div>
		</div>
	)
}

export type {
	SettingsMenuContext,
	SettingsMenuProps
}

export {
	SettingsMenuWindow
}
