import { Accessor, createSignal } from "solid-js";
import { getTimeZones } from "@vvo/tzdb";
import { naturalCompareString } from "../utility/sorting";
import { DataSizeUnitSetting, getTimeOffsetInMinutesFromTimezoneName, UserSettings } from "../client/userSettings";
import { getLocalStorageUserCryptoInfo } from "../client/localStorage";
import qrcode from "qrcode";
import cloneDeep from "clone-deep";
import base64js from "base64-js";

// Widgets used by the settings menu
import {
  AlertText,
  DropdownSelector,
  DropdownSelectorOnSetCallback,
  FileSelector,
  InputTextbox,
  MultiRadioButtonOption,
  Section,
  SeparatorLine,
  Spacing,
  SpoilerImage,
  SpoilerText,
  Subtitle
} from "./settingsWidgets";
import { hashRawPasswordToComponents } from "../client/clientCrypto";

// TODO: support new profile picture blobs
type SettingsMenuUpdateCallback = (settings: UserSettings) => boolean; // Return true for success

type SettingsMenuContext = {
  // Must be called when the settings menu is closed (i.e when the user clicks another navigation button)
  close?: () => void;
}

type SettingsMenuProps = {
  context: SettingsMenuContext;
  username: string;
  visible: boolean;
  userSettings: Accessor<UserSettings>;
  userSettingsUpdateCallback: SettingsMenuUpdateCallback;
};

function SettingsMenuWindow(props: SettingsMenuProps) {
  const { userSettingsUpdateCallback, userSettings } = props;
  // const [ canSave, setCanSave ] = createSignal(false);
  let currentUserSettings = cloneDeep(userSettings()); // The currently used settings (i.e the reference point)
  const modifiedUserSettings = cloneDeep(userSettings()); // This is what the settings menu will modify

  // Get local storage user crypto info
  const userLocalCryptoInfo = getLocalStorageUserCryptoInfo();

  if (userLocalCryptoInfo == null) {
    console.error("userLocalCryptoInfo is null!");
    return;
  }

  // Function to save settings and update
  const saveSettingsAndUpdate = () => {
    currentUserSettings = cloneDeep(modifiedUserSettings);
    userSettingsUpdateCallback(cloneDeep(modifiedUserSettings));
  };

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

  // ONLY for international or american date formatting at the moment because the user 
  // settings type has a boolean for using the american date format
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
    saveSettingsAndUpdate();
  };

  const timezoneSettingCallback: DropdownSelectorOnSetCallback = (setting: string) => {
    if (setting == modifiedUserSettings.timezoneSetting)
      return;

    modifiedUserSettings.timezoneSetting = setting;
    modifiedUserSettings.timezoneOffsetInMinutes = getTimeOffsetInMinutesFromTimezoneName(setting);
    saveSettingsAndUpdate();
  };

  const sizeUnitTypesOptionCallback = (option: string) => {
    // Convert to data size unit enum type
    const newSizeUnitOption = (option == sizeUnitsOptions[0] ? DataSizeUnitSetting.Base2 : DataSizeUnitSetting.Base10);

    if (newSizeUnitOption == modifiedUserSettings.dataSizeUnit)
      return;

    modifiedUserSettings.dataSizeUnit = newSizeUnitOption;
    saveSettingsAndUpdate();
  };

  const timeDateFormatOptionCallback = (option: string) => {
    const newFormatOptionIsAmerican = (option == timeDateFormatOptions[1] ? true : false);
    
    if (newFormatOptionIsAmerican == modifiedUserSettings.useAmericanDateFormat)
      return;

    modifiedUserSettings.useAmericanDateFormat = newFormatOptionIsAmerican;
    saveSettingsAndUpdate();
  };

  // Two-factor authentication
  const [otpAuthUrl, setOtpAuthUrl] = createSignal<string | null>(null);
  const [otpAuthUrlSecret, setOtpAuthUrlSecret] = createSignal<string | null>(null);
  const [otpAuthUrlQRCodeImg, setOtpAuthUrlQRCodeImg] = createSignal<string>("");
  const [twoFactorAuthPasswordInputRef, setTwoFactorAuthPasswordInputRef] = createSignal<HTMLInputElement>();
  const [update2FAButtonEnabled, setUpdate2FAButtonEnabled] = createSignal(true);
  const [update2FAErrorMessage, setUpdate2FAErrorMessage] = createSignal("");

  /**
   * Gets the two factor auth url for the user from the server and refreshes the QR code and secret key
   */
  const refreshTwoFactorAuthUrl = () => {
    fetch("/api/twofactorauth/url")
    .then((response) => {
      if (response.ok) {
        return response.json();
      } else if (response.status == 404) { // 404 = 2FA is disabled
        setOtpAuthUrl(null);
        setOtpAuthUrlSecret(null);
        setOtpAuthUrlQRCodeImg("");
      }
    })
    .then((json) => {
      if (json === null || json === undefined) {
        return;
      }

      let url = json.url;
      let secret = json.secret;

      setOtpAuthUrl(url);
      setOtpAuthUrlSecret(secret);

      // Generate QR code
      let options: qrcode.QRCodeToDataURLOptions = {
        errorCorrectionLevel: "L",
        type: "image/png",
        margin: 0,
        scale: 3,
        color: {
          dark: "#000000FF",
          light: "#00000000"
        }
      };

      qrcode.toDataURL(url, options, (err, url) => {
        if (err) {
          console.error(`Generating QR code for totp error: ${err}`);
          return;
        }

        setOtpAuthUrlQRCodeImg(url);
      });
    });
  };

  /**
   * Enables or disables 2FA for the user. 
   * @param enable If true, 2FA is enabled; or else it's disabled.
   */
  const update2FA = async (enable: boolean) => {
    try {
      setUpdate2FAButtonEnabled(false);
      setUpdate2FAErrorMessage("");
      
      // Get the raw confirmation password from the input field
      const rawPassword = twoFactorAuthPasswordInputRef()!.value;

      if (rawPassword.length == 0) {
        setUpdate2FAErrorMessage("Password is empty.");
        return;
      }

      // Get the user's salt
      let response = await fetch(`/api/accounts/${props.username}/salt`);
      const saltB64 = await response.text();
      const salt = base64js.toByteArray(saltB64);
    
      // Get the auth key
      const [ _, authKey ] = await hashRawPasswordToComponents(rawPassword, salt);
      const authKeyB64 = base64js.fromByteArray(authKey);

      // Send request
      response = await fetch(`/api/twofactorauth/${enable ? "enable" : "disable"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authKey: authKeyB64 })
      });

      if (!response.ok) {
        if (response.status == 401) {
          setUpdate2FAErrorMessage("Incorrect password.");
        } else {
          setUpdate2FAErrorMessage("Internal error.");
        }

        return;
      }

      refreshTwoFactorAuthUrl();
      twoFactorAuthPasswordInputRef()!.value = "";
    } catch (error) {
      console.error(error);
      setUpdate2FAErrorMessage("Internal error.");
    } finally {
      setUpdate2FAButtonEnabled(true);
    }
  };

  // Callbacks
  const mediaViewerDefaultVolumeInputChangeCallback = (value: string) => {
    // Validity is checked in the validity check callback, so we can call parseInt safely here
    modifiedUserSettings.defaultMediaViewerVolume = parseInt(value) / 100; // Divide by 100 to normalise
    saveSettingsAndUpdate();
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

  // Spoiler hide functions
  const spoilerHideFunctions: Function[] = [];

  // Context
  props.context.close = () => {
    spoilerHideFunctions.forEach(f => f());
  };

  refreshTwoFactorAuthUrl();

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
            {/* Two-factor authentication section */}
            <Section title={"Two-factor authentication"} hierarchyId={1} >
              {otpAuthUrl() !== null &&
                <>
                  <Subtitle text={"Your QR code"} />
                  <Spacing height={4} />
                    <SpoilerImage
                    name=""
                    src={otpAuthUrlQRCodeImg()}
                    namePixelWidth={0}
                    optionalHideFunctionArray={spoilerHideFunctions}
                  />
                  <Spacing height={8} />
                  <Subtitle text={"Secret key"} />
                  <Spacing height={4} />
                  <SpoilerText
                    name=""
                    text={otpAuthUrlSecret()!}
                    namePixelWidth={0}
                    optionalHideFunctionArray={spoilerHideFunctions}
                  />
                  <Spacing height={12} />
                </>
              }
              {otpAuthUrl() === null &&
                <>
                  <Spacing height={4} />
                  <AlertText text="Remember to scan the QR code immediately after you've enabled 2FA! Otherwise you may lose your account!" />
                </>
              }
              <Spacing height={12} />
              <div class="flex flex-row ml-5">
                <input
                  type="password"
                  ref={setTwoFactorAuthPasswordInputRef}
                  placeholder="Enter your password"
                  class="
                  w-48 border-[1px] border-black rounded-md mr-2 px-1 outline-offset-1
                  font-SpaceGrotesk text-sm
                  "
                />
                <button
                  onClick={() => update2FA(otpAuthUrl() === null)}
                  innerText={otpAuthUrl() === null ? "Enable 2FA" : "Disable 2FA"}
                  disabled={!update2FAButtonEnabled()}
                  class={`
                    w-min text-nowrap px-1 h-6 rounded-md border-[1px]
                    font-SpaceGrotesk text-sm text-white align-middle
                    ${
                      update2FAButtonEnabled() ?
                      `${
                        otpAuthUrl() === null ?
                        "hover:bg-green-600 active:bg-green-700" :
                        "hover:bg-red-600 active:bg-red-700"
                      }` : 
                      "opacity-50"
                    }
                    ${
                      otpAuthUrl() === null ?
                      "border-green-700 bg-green-500" :
                      "border-red-700 bg-red-500"
                    }
                  `}
                />
                <div class="ml-2 font-SpaceGrotesk text-sm text-red-600">
                  {update2FAErrorMessage()}
                </div>
              </div>
            </Section>
          </Section>

          {/* Advanced section */}
          <Section title={"Advanced"} hierarchyId={0} >
            <InputTextbox
              name="Media viewer default volume"
              namePixelWidth={200}
              defaultValue={defaultMediaViewerDefaultVolume}
              isValidCallback={mediaViewerDefaultVolumeIsValidCallback}
              onSetCallback={mediaViewerDefaultVolumeInputChangeCallback}
            />
          </Section>

          

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

/*
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
*/

/*
{/ Control bar /}
{
<SeparatorLine />
<Spacing height={12} />
<div class="flex flex-row items-center">
  { Save button }
  <div
    class={`
      flex items-center justify-center px-2 h-7 ml-5 rounded-md border-[1px]
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
}
*/