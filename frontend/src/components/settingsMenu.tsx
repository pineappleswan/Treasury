import { Accessor, createSignal } from "solid-js";
import { getTimeZones } from "@vvo/tzdb";
import { naturalCompareString } from "../utility/sorting";
import { DataSizeUnitSetting, getTimeOffsetInMinutesFromTimezoneName, UserSettings } from "../client/userSettings";
import { getLocalStorageUserCryptoInfo } from "../client/localStorage";
import cloneDeep from "clone-deep";

// Widgets used by the settings menu
import {
	DropdownSelector,
	DropdownSelectorOnSetCallback,
	FileSelector,
	InputTextbox,
	MultiRadioButtonOption,
	Section,
	SeparatorLine,
	Spacing,
	Subtitle
} from "./settingsWidgets";

// TODO: support new profile picture blobs
type SettingsMenuUpdateCallback = (settings: UserSettings) => boolean; // Return true for success

type SettingsMenuContext = {
	close?: () => void; // Must be called when the settings menu is closed (i.e when the user clicks another navigation button)
}

type SettingsMenuProps = {
	context: SettingsMenuContext;
	visible: boolean;
	userSettings: Accessor<UserSettings>;
	userSettingsUpdateCallback: SettingsMenuUpdateCallback;
};

function SettingsMenuWindow(props: SettingsMenuProps) {
	const { userSettingsUpdateCallback, userSettings } = props;
	const [ canSave, setCanSave ] = createSignal(false);
	let currentUserSettings = cloneDeep(userSettings()); // The currently used settings (i.e the reference point)
	const modifiedUserSettings = cloneDeep(userSettings()); // This is what the settings menu will modify

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
		modifiedUserSettings.timezoneOffsetInMinutes = getTimeOffsetInMinutesFromTimezoneName(setting);
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

	// TODO: add discard buttons
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
							onSetCallback={sizeUnitTypesOptionCallback}
						/>
						<MultiRadioButtonOption
							name={"Time date format"}
							options={timeDateFormatOptions}
							defaultOption={defaultTimeDateFormatOption}
							optionalColumnWidth={200}
							onSetCallback={timeDateFormatOptionCallback}
						/>
						<Spacing height={8} />
					</Section>

					{/* Security & Privacy section */}
					<Section title={"Security & Privacy"} hierarchyId={0} >
						
					</Section>

					{/* Advanced section */}
					<Section title={"Advanced"} hierarchyId={0} defaultCollapsed >
						<InputTextbox
							name="Media viewer default volume"
							namePixelWidth={200}
							defaultValue={defaultMediaViewerDefaultVolume}
							isValidCallback={mediaViewerDefaultVolumeIsValidCallback}
							onSetCallback={mediaViewerDefaultVolumeInputChangeCallback}
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
