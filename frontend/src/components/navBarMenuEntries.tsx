import { Accessor, Setter, createSignal } from "solid-js";
import { UserFilesystem } from "../client/userFilesystem";
import { getFormattedByteSizeText } from "../common/commonUtils";
import { UserSettings } from "../client/userSettings";
import { WindowType } from "../client/clientEnumsAndTypes";

// Icons
import GearIcon from "../assets/icons/svg/gear.svg?component-solid";
import LogoutIcon from "../assets/icons/svg/logout.svg?component-solid";
import FolderIcon from "../assets/icons/svg/folder.svg?component-solid";
import SharedLinkIcon from "../assets/icons/svg/shared-link.svg?component-solid";
import TrashIcon from "../assets/icons/svg/trash-bin.svg?component-solid";

type FilesystemMenuEntryProps = {
  currentWindowAccessor: Accessor<WindowType>;
  currentWindowSetter: Setter<WindowType>;
};

function FilesystemMenuEntry(props: FilesystemMenuEntryProps) {
  const { currentWindowAccessor, currentWindowSetter } = props;

  const handleClick = () => {
    currentWindowSetter(WindowType.Filesystem);
  }

  return (
    <div class={`flex flex-row w-full items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
                ${(currentWindowAccessor() == WindowType.Filesystem) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
         onClick={handleClick}>
      <div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
        <FolderIcon class="aspect-square h-[26px] invert-[20%]" />
      </div>
      <span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Filesystem</span>
    </div>
  );
}

type SharedMenuEntryProps = {
  currentWindowAccessor: Accessor<WindowType>;
  currentWindowSetter: Setter<WindowType>;
};

function SharedMenuEntry(props: SharedMenuEntryProps) {
  const { currentWindowAccessor, currentWindowSetter } = props;

  const handleClick = () => {
    currentWindowSetter(WindowType.Shared);
  }

  return (
    <div class={`flex flex-row w-full items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
                ${(currentWindowAccessor() == WindowType.Shared) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
         onClick={handleClick}>
      <div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
        <SharedLinkIcon class="aspect-square h-[24px] invert-[20%]" />
      </div>
      <span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Shared</span>
    </div>
  );
}

type TrashMenuEntryProps = {
  currentWindowAccessor: Accessor<WindowType>;
  currentWindowSetter: Setter<WindowType>;
};

function TrashMenuEntry(props: TrashMenuEntryProps) {
  const { currentWindowAccessor, currentWindowSetter } = props;

  const handleClick = () => {
    currentWindowSetter(WindowType.Trash);
  }

  return (
    <div class={`flex flex-row w-full items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
                ${(currentWindowAccessor() == WindowType.Trash) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
         onClick={handleClick}>
      <div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
        <TrashIcon class="aspect-square h-[28px] invert-[20%]" />
      </div>
      <span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Trash</span>
    </div>
  );
}

type SettingsMenuEntryProps = {
  currentWindowAccessor: Accessor<WindowType>;
  currentWindowSetter: Setter<WindowType>;
};

function SettingsMenuEntry(props: SettingsMenuEntryProps) {
  const { currentWindowAccessor, currentWindowSetter } = props;

  const handleClick = () => {
    currentWindowSetter(WindowType.Settings);
  }

  return (
    <div class={`flex flex-row w-full items-center mr-2 mt-1 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
                ${(currentWindowAccessor() == WindowType.Settings) ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
         onClick={handleClick}>
      <div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
        <GearIcon class="aspect-square h-[22px] invert-[20%]" />
      </div>
      <span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Settings</span>
    </div>
  );
}

type QuotaMenuEntryProps = {
  currentWindowAccessor: Accessor<WindowType>;
  currentWindowSetter: Setter<WindowType>;
  userSettings: Accessor<UserSettings>;
  userFilesystem: UserFilesystem;
};

function QuotaMenuEntry(props: QuotaMenuEntryProps) {
  const { userFilesystem, userSettings } = props;
  const [ quotaText, setQuotaText ] = createSignal("Loading usage data...");
  const [ barWidth, setBarWidth ] = createSignal(0); // Bar width is a value between 0 and 100 (must be an integer or else the bar won't show)

  // Update the quota text every 1 second
  setInterval(() => {
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
  }, 1000);

  return (
    <div class="flex flex-col w-full h-12 p-2">
      <span class="mb-1 font-SpaceGrotesk font-medium text-sm text-zinc-700">{quotaText()}</span>
      <div class="flex w-full h-2 rounded-full bg-zinc-300">
        <div
          style={`width: ${barWidth()}%`}
          class={`
            flex h-[100 rounded-full
            ${barWidth() < 70 ? "bg-sky-600" : (barWidth() < 90 ? "bg-amber-400" : "bg-red-500")}
          `}
        ></div> {/* Uses style for bar width since tailwind can't update that fast */}
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
    <div class="flex flex-row items-center mt-1 py-1 rounded-md drop-shadow-sm hover:bg-red-100 hover:cursor-pointer active:bg-red-200"
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
