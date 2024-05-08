import { Accessor, createSignal, Setter, onCleanup } from "solid-js";
import { TransferType } from "../client/transfers";
import { WindowType } from "../client/clientEnumsAndTypes";
import { getFormattedBPSText } from "../common/commonUtils";
import { UserSettings } from "../client/userSettings";
import SimpleArrowIcon from "../assets/icons/svg/simple-arrow.svg?component-solid";

const TRANSFER_MENU_ENTRY_SPEED_REFRESH_DELAY_MS = 100; // TODO: move elsewhere? perhaps part of the theme

type TransfersMenuEntrySettings = {
  notify?: () => void; // Called externally to make the notify animation run
};

type TransfersMenuEntryProps = {
  transferType: TransferType;
  settings: TransfersMenuEntrySettings;
  userSettingsAccessor: Accessor<UserSettings>;
  currentWindowGetter: Accessor<WindowType>;
  currentWindowSetter: Setter<WindowType>;
  getTransferSpeed: () => number; // The function that provides data
};

function TransfersMenuEntry(props: TransfersMenuEntryProps) {
  const { userSettingsAccessor } = props;
  const [ speedText, setSpeedText ] = createSignal("");
  const [ visible, setVisible ] = createSignal(false);
  const windowTransferType = props.transferType;
  const windowType = (windowTransferType == TransferType.Uploads ? WindowType.Uploads : WindowType.Downloads);
  const menuEntryText = (windowTransferType == TransferType.Uploads ? "Uploads" : "Downloads");
  let thisHtmlElement: HTMLDivElement | undefined;

  const handleClick = () => {
    props.currentWindowSetter(windowType);
  }

  const refreshDisplayInterval = () => {
    const userSettings = userSettingsAccessor();
    const speed = props.getTransferSpeed();

    if (speed <= 0) {
      setVisible(false);
    } else {
      setSpeedText(getFormattedBPSText(speed, userSettings.dataSizeUnits));
      setVisible(true);
    }
  };

  const refreshInterval = setInterval(refreshDisplayInterval, TRANSFER_MENU_ENTRY_SPEED_REFRESH_DELAY_MS);

  onCleanup(() => {
    clearInterval(refreshInterval);
  });

  props.settings.notify = () => {
    if (!thisHtmlElement) {
      console.error("Notify failed because couldn't find own element???");
      return;
    }

    // TODO: constants as a theme value
    const onTime = 800;
    const fadeInTime = 50;
    const fadeOutTime = 1000;

    // TODO: notify color theme constant somewhere...

    thisHtmlElement.setAttribute(
      "style",
      `
      background: rgb(180, 225, 255);
      transition: background-color ${fadeInTime}ms;
      `
    );

    setTimeout(() => {
      thisHtmlElement.setAttribute(
        "style",
        `
        background: transparent;
        transition: background-color ${fadeOutTime}ms;
        `
      );

      setTimeout(() => {
        thisHtmlElement.removeAttribute("style");
      }, fadeOutTime);
    }, onTime + fadeInTime);
  };

  return (
    <div
      ref={thisHtmlElement}
      class={`flex flex-row w-full items-center mr-2 mb-1 pl-0.5 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
            ${(props.currentWindowGetter() == windowType) ?	"bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
      onClick={handleClick}
    >
      <div
        class={`
          flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-6 border-solid border-2
          ${windowTransferType == TransferType.Uploads ? "border-sky-400" : "border-green-500"}
        `}
      >
        {windowTransferType == TransferType.Uploads ? (
          <SimpleArrowIcon class="aspect-square h-5 text-sky-400" />
        ) : (
          <SimpleArrowIcon class="aspect-square h-5 rotate-180 text-green-500" />
        )}
      </div>
      <span class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">{menuEntryText}</span>
      <div class={`flex items-center justify-center font bg-[#f4f4f4] px-1.5 h-5 mr-1.5 rounded-md border-solid border-[1px] border-[#dfdfdf]
                  ${visible() == true ? "visible" : "invisible"}`}>
        <span class="font-SpaceGrotesk font-medium text-xs text-zinc-700 select-none">{speedText()}</span>
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
