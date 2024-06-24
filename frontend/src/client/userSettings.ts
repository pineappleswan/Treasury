import { getTimeZones } from "@vvo/tzdb";

/**
 * An enum that specifies the type of suffix used when representing byte sizes (e.g. MB vs MiB)
*/
enum DataSizeUnitSetting {
  Base2, // KiB, MiB, GiB ...
  Base10 // KB, MB, GB ...
}

/**
 * A type representing the settings that are controllable by the user via the settings menu.
*/
type UserSettings = {
  theme: string;
  timezoneSetting: string;
  timezoneOffsetInMinutes: number;
  useAmericanDateFormat: boolean;
  dataSizeUnit: DataSizeUnitSetting;
  defaultMediaViewerVolume: number;
  changeDocumentTitleToMatchContent: boolean;
};

/**
 * Gets the default user settings that are used when a new user logs in for the first time.
 * @returns {UserSettings} The default user settings.
*/
function getDefaultUserSettings(): UserSettings {
  return {
    useAmericanDateFormat: false,
    timezoneSetting: "Automatic",
    timezoneOffsetInMinutes: 0,
    dataSizeUnit: DataSizeUnitSetting.Base10,
    theme: "Light",
    defaultMediaViewerVolume: 1,
    changeDocumentTitleToMatchContent: true
  }
}

/**
 * Gets the offset in minutes from UTC time of a given timezone via its name.
 * @param {string} name - The name of the timezone.
 * @returns {number} The timezone's UTC time offset in minutes.
*/
function getTimeOffsetInMinutesFromTimezoneName(name: string): number {
  const timezones = getTimeZones();
  let timezoneName = name;

  if (timezoneName == "Automatic") {
    timezoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  if (timezoneName == "UTC") {
    return 0;
  }

  const userTimezoneInfo = timezones.find(data => data.name == timezoneName);

  if (userTimezoneInfo) {
    return userTimezoneInfo.currentTimeOffsetInMinutes;
  } else {
    console.warn(`Couldn't find user's timezone information based on the name: ${timezoneName}. Defaulting to UTC timezone offset.`);
    return 0;
  }
}

export type {
  UserSettings
}

export {
  DataSizeUnitSetting,
  getDefaultUserSettings,
  getTimeOffsetInMinutesFromTimezoneName
}
