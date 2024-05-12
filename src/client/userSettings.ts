import { getTimeZones } from "@vvo/tzdb";

enum DataSizeUnitSetting {
  Base2, // KiB, MiB, GiB ...
  Base10 // KB, MB, GB ...
}

type UserSettings = {
  theme: string;
  timezoneSetting: string;
  timezoneOffsetInMinutes: number;
  useAmericanDateFormat: boolean;
  dataSizeUnit: DataSizeUnitSetting;
  defaultMediaViewerVolume: number;
};

function getDefaultUserSettings(): UserSettings {
  return {
    useAmericanDateFormat: false,
    timezoneSetting: "Automatic",
    timezoneOffsetInMinutes: 0,
    dataSizeUnit: DataSizeUnitSetting.Base10,
    theme: "Light",
    defaultMediaViewerVolume: 1
  }
}

function getTimezoneOffsetInMinutesFromTimezoneName(name: string) {
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
  getTimezoneOffsetInMinutesFromTimezoneName
}
