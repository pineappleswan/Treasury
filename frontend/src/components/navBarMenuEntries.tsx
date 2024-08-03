import { Accessor, createSignal } from "solid-js";
import { UserFilesystem } from "../client/userFilesystem";
import { getFormattedByteSizeText } from "../utility/commonUtils";
import { UserSettings } from "../client/userSettings";
import WindowType from "../client/windowType";

// Icons
import GearIcon from "../assets/icons/svg/gear.svg?component-solid";
import LogoutIcon from "../assets/icons/svg/logout.svg?component-solid";
import FolderIcon from "../assets/icons/svg/folder.svg?component-solid";
import SharedLinkIcon from "../assets/icons/svg/shared-link.svg?component-solid";
import TrashIcon from "../assets/icons/svg/trash-bin.svg?component-solid";

type FilesystemMenuEntryProps = {
  currentWindowType: Accessor<WindowType>;
  setWindowType: (windowType: WindowType) => void;
};

function FilesystemMenuEntry(props: FilesystemMenuEntryProps) {
  const { currentWindowType, setWindowType } = props;

  const handleClick = () => {
    setWindowType(WindowType.Filesystem);
  }

  return (
    <div
      class={`
        flex flex-row w-full items-center h-8
        rounded-md
        hover:drop-shadow-sm hover:cursor-pointer
        ${(currentWindowType() == WindowType.Filesystem) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}
      `}
      onClick={handleClick}
    >
      <div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
        <FolderIcon class="aspect-square h-[26px] invert-[20%]" />
      </div>
      <span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Filesystem</span>
    </div>
  );
}

type SharedMenuEntryProps = {
  currentWindowType: Accessor<WindowType>;
  setWindowType: (windowType: WindowType) => void;
};

function SharedMenuEntry(props: SharedMenuEntryProps) {
  const { currentWindowType, setWindowType } = props;

  const handleClick = () => {
    setWindowType(WindowType.Shared);
  }

  return (
    <div
      class={`
        flex flex-row w-full h-8 items-center mr-2 py-0.5 rounded-md
        hover:drop-shadow-sm hover:cursor-pointer
        ${
          (currentWindowType() == WindowType.Shared) ?
          "bg-neutral-200 active:bg-neutral-300" :
          "hover:bg-white active:bg-neutral-200"
        }
      `}
      onClick={handleClick}
    >
      <div class="flex ml-2 mr-2 w-7 items-center justify-center aspect-square rounded-full">
        <SharedLinkIcon class="aspect-square h-[24px] invert-[20%]" />
      </div>
      <span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Shared</span>
    </div>
  );
}

type TrashMenuEntryProps = {
  currentWindowType: Accessor<WindowType>;
  setWindowType: (windowType: WindowType) => void;
};

function TrashMenuEntry(props: TrashMenuEntryProps) {
  const { currentWindowType, setWindowType } = props;

  const handleClick = () => {
    setWindowType(WindowType.Trash);
  }

  return (
    <div
      class={`
        flex flex-row w-full h-8 mr-2 py-0.5 items-center rounded-md
        hover:drop-shadow-sm hover:cursor-pointer
        ${(currentWindowType() == WindowType.Trash) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}
      `}
      onClick={handleClick}
    >
      <div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
        <TrashIcon class="aspect-square h-[28px] invert-[20%]" />
      </div>
      <span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Trash</span>
    </div>
  );
}

type SettingsMenuEntryProps = {
  currentWindowType: Accessor<WindowType>;
  setWindowType: (windowType: WindowType) => void;
};

function SettingsMenuEntry(props: SettingsMenuEntryProps) {
  const { currentWindowType, setWindowType } = props;

  const handleClick = () => {
    setWindowType(WindowType.Settings);
  }

  return (
    <div class={`flex flex-row w-full items-center mr-2 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
                ${(currentWindowType() == WindowType.Settings) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
         onClick={handleClick}>
      <div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
        <GearIcon class="aspect-square h-[22px] invert-[20%]" />
      </div>
      <span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Settings</span>
    </div>
  );
}

type QuotaMenuEntryContext = {
  /** When called, it will refresh the storage quota based on the values in the user filesystem class. */
  refresh?: () => void;
}

type QuotaMenuEntryProps = {
  currentWindowType: Accessor<WindowType>;
  setWindowType: (windowType: WindowType) => void;
  userSettings: Accessor<UserSettings>;
  userFilesystem: UserFilesystem;
  context: QuotaMenuEntryContext;
};

function QuotaMenuEntry(props: QuotaMenuEntryProps) {
  const { context, userFilesystem, userSettings } = props;
  const [ quotaText, setQuotaText ] = createSignal("Loading usage data...");
  const [ barWidth, setBarWidth ] = createSignal(0); // Bar width is a value between 0 and 100 (must be an integer or else the bar won't show)

  // Refresh function
  context.refresh = () => {
    const { bytesUsed, totalBytes } = userFilesystem.getStorageQuota();

    if (bytesUsed == -1 || totalBytes == -1) {
      setQuotaText("Loading usage data...");
      setBarWidth(0);
    } else {
      let usedQuotaText = getFormattedByteSizeText(bytesUsed, userSettings().dataSizeUnit, 2);
      let totalQuotaText = getFormattedByteSizeText(totalBytes, userSettings().dataSizeUnit, 2);
      let ratio = Math.floor((bytesUsed / totalBytes) * 100);
      
      // Clamp between 0-100
      if (ratio < 0) {
        ratio = 0;
      } else if (ratio > 100) {
        ratio = 100;
      }

      setQuotaText(usedQuotaText + " / " + totalQuotaText);
      setBarWidth(ratio);
    }
  };

  return (
    <div class="flex flex-col w-full h-11 px-1">
      <span class="mb-1 font-SpaceGrotesk font-medium text-sm text-zinc-700">{quotaText()}</span>
      <div class="flex w-full h-2 rounded-full bg-zinc-300">
        <div
          style={`width: ${barWidth()}%`}
          class={`
            flex rounded-full
            ${barWidth() < 70 ? "bg-sky-600" : (barWidth() < 90 ? "bg-amber-400" : "bg-red-500")}
          `}
        />
      </div>
    </div>
  );
}

type LogoutMenuEntryProps = {
  logoutCallback: () => void;
};

function LogoutMenuEntry(props: LogoutMenuEntryProps) {
  const { logoutCallback } = props;

  return (
    <div class="flex flex-row items-center py-1 rounded-md drop-shadow-sm hover:bg-red-100 hover:cursor-pointer active:bg-red-200"
         onClick={logoutCallback}>
      <div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
        <LogoutIcon class="aspect-square h-[24px] text-red-500" />
      </div>
      <span class="flex-grow font-SpaceGrotesk font-medium text-md text-red-500 select-none">Log out</span>
    </div>
  );
};

export type {
  FilesystemMenuEntryProps,
  SharedMenuEntryProps,
  TrashMenuEntryProps,
  SettingsMenuEntryProps,
  QuotaMenuEntryContext,
  QuotaMenuEntryProps,
  LogoutMenuEntryProps
}

export {
  FilesystemMenuEntry,
  SharedMenuEntry,
  TrashMenuEntry,
  SettingsMenuEntry,
  QuotaMenuEntry,
  LogoutMenuEntry
}
