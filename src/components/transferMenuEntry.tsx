import { Accessor, createSignal, Setter, onCleanup } from "solid-js";
import { TransferType } from "../client/transfers";
import { WindowTypes } from "../client/clientEnumsAndTypes";
import { getFormattedBPSText } from "../common/commonUtils";

import DownloadArrowIcon from "../assets/icons/svg/downloading-arrow.svg?component-solid";
import UploadArrowIcon from "../assets/icons/svg/uploading-arrow.svg?component-solid";

const TRANSFER_MENU_ENTRY_SPEED_REFRESH_DELAY_MS = 100; // TODO: move elsewhere?

type TransfersMenuEntrySettings = {
  notify?: () => void // Called externally to make the notify animation run
};

type TransfersMenuEntryProps = {
  transferType: TransferType,
  settings: TransfersMenuEntrySettings,
  currentWindowGetter: Accessor<WindowTypes>,
  currentWindowSetter: Setter<WindowTypes>,
  getTransferSpeed: () => number // The function that provides data
};

function TransfersMenuEntry(props: TransfersMenuEntryProps) {
  const [ speedText, setSpeedText ] = createSignal("");
  const [ visible, setVisible ] = createSignal(false);
  const windowTransferType = props.transferType;
  const windowType = (windowTransferType == TransferType.Uploads ? WindowTypes.Uploads : WindowTypes.Downloads);
  const menuEntryText = (windowTransferType == TransferType.Uploads ? "Uploads" : "Downloads");

  const handleClick = () => {
    props.currentWindowSetter(windowType);
  }

  const refreshDisplayInterval = () => {
    const speed = props.getTransferSpeed();

    if (speed <= 0) {
      setVisible(false);
    } else {
      setSpeedText(getFormattedBPSText(speed));
      setVisible(true);
    }
  };

  const interval = setInterval(refreshDisplayInterval, TRANSFER_MENU_ENTRY_SPEED_REFRESH_DELAY_MS);

  onCleanup(() => {
    clearInterval(interval);
  });

  const htmlId = (windowTransferType == TransferType.Uploads ? "uploads-menu-entry" : "downloads-menu-entry");

  props.settings.notify = () => {
    const thisElement = document.getElementById(htmlId);

    if (!thisElement) {
      console.error("Notify failed because couldn't find own element???");
      return;
    }

    const onTime = 800;
    const fadeInTime = 50;
    const fadeOutTime = 1000;

    // TODO: notify color theme constant somewhere...

    thisElement.setAttribute(
      "style",
      `
      background: rgb(180, 225, 255);
      transition: background-color ${fadeInTime}ms;
      `
    );

    setTimeout(() => {
      thisElement.setAttribute(
        "style",
        `
        background: transparent;
        transition: background-color ${fadeOutTime}ms;
        `
      );

      setTimeout(() => {
        thisElement.removeAttribute("style");
      }, fadeOutTime);
    }, onTime + fadeInTime);
  };

  return (
    <div
      class={`flex flex-row w-[100%] items-center mr-2 mb-1 pl-0.5 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
            ${(props.currentWindowGetter() == windowType) ?	"bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
      id={htmlId}
      onClick={handleClick}
    >
      <div
        class={`
          flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-6 border-solid border-2
          ${windowTransferType == TransferType.Uploads ? "border-[#33bbee]" : "border-[#11bf22]"}
        `}
      >
        {windowTransferType == TransferType.Uploads ? (
          <UploadArrowIcon class="aspect-square h-5" />
        ) : (
          <DownloadArrowIcon class="aspect-square h-5 rotate-180" />
        )}
      </div>
      <h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">{menuEntryText}</h1>
      <div class={`flex items-center justify-center font bg-[#f4f4f4] px-1.5 h-5 mr-1.5 rounded-md border-solid border-[1px] border-[#dfdfdf]
                  ${visible() == true ? "visible" : "invisible"}`}>
        <h1 class="font-SpaceGrotesk font-medium text-xs text-zinc-700 select-none">{speedText()}</h1>
      </div>
    </div>
  );
}

export type {
  TransfersMenuEntrySettings,
  TransfersMenuEntryProps
}

export {
  TransfersMenuEntry
}
