import { Accessor, createSignal, onCleanup } from "solid-js";
import { TransferType } from "../client/transfers";
import { getFormattedBPSText } from "../utility/commonUtils";
import { UserSettings } from "../client/userSettings";
import WindowType from "../client/windowType";
import SimpleArrowIcon from "../assets/icons/svg/simple-arrow.svg?component-solid";

const TRANSFER_MENU_ENTRY_SPEED_REFRESH_DELAY_MS = 100; // TODO: move elsewhere? perhaps part of the theme

type TransfersMenuEntryContext = {
  notify?: () => void; // Called externally to make the notify animation run
};

type TransfersMenuEntryProps = {
  transferType: TransferType;
  context: TransfersMenuEntryContext;
  userSettings: Accessor<UserSettings>;
  currentWindowType: Accessor<WindowType>;
  setWindowType: (windowType: WindowType) => void;
  getTransferSpeed: () => number; // The function that provides data
};

function TransferListMenuEntry(props: TransfersMenuEntryProps) {
  const { userSettings, currentWindowType, setWindowType } = props;
  const [ speedText, setSpeedText ] = createSignal("");
  const [ visible, setVisible ] = createSignal(false);
  const windowTransferType = props.transferType;
  const windowType = (windowTransferType == TransferType.Uploads ? WindowType.Uploads : WindowType.Downloads);
  const menuEntryText = (windowTransferType == TransferType.Uploads ? "Uploads" : "Downloads");
  let parentDivRef: HTMLDivElement | undefined;

  const handleClick = () => {
    setWindowType(windowType);
  }

  const refreshDisplayInterval = () => {
    const speed = props.getTransferSpeed();

    if (speed <= 0) {
      setVisible(false);
    } else {
      setSpeedText(getFormattedBPSText(speed, userSettings().dataSizeUnit));
      setVisible(true);
    }
  };

  const refreshInterval = setInterval(refreshDisplayInterval, TRANSFER_MENU_ENTRY_SPEED_REFRESH_DELAY_MS);

  onCleanup(() => {
    clearInterval(refreshInterval);
  });

  props.context.notify = () => {
    if (!parentDivRef) {
      console.error("Notify failed because couldn't find own element???");
      return;
    }

    // TODO: constants as a theme value
    const onTime = 800;
    const fadeInTime = 50;
    const fadeOutTime = 1000;

    // TODO: notify color theme constant somewhere...

    parentDivRef.setAttribute(
      "style",
      `
      background: rgb(180, 225, 255);
      transition: background-color ${fadeInTime}ms;
      `
    );

    setTimeout(() => {
      parentDivRef.setAttribute(
        "style",
        `
        background: transparent;
        transition: background-color ${fadeOutTime}ms;
        `
      );

      setTimeout(() => {
        parentDivRef.removeAttribute("style");
      }, fadeOutTime);
    }, onTime + fadeInTime);
  };

  return (
    <div
      ref={parentDivRef}
      class={`
        flex flex-row w-full h-8 items-center pl-0.5
        rounded-md hover:drop-shadow-sm hover:cursor-pointer
        ${(currentWindowType() == windowType) ?	"bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}
      `}
      onClick={handleClick}
    >
      <div
        class={`
          flex w-6 h-6 ml-2 mr-2.5 items-center justify-center
          rounded-full border-solid border-2
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
  TransfersMenuEntryContext,
  TransfersMenuEntryProps
}

export {
  TransferListMenuEntry
}
