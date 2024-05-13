import { createEffect, createSignal } from "solid-js";
import CloseButton from "../assets/icons/svg/close.svg?component-solid";
import { SubmitButtonStates, getSubmitButtonStyle } from "./submitButton";
import { FilesystemEntry } from "./fileExplorer";
import CONSTANTS from "../common/constants";
import { naturalCompareString, sortFilesystemEntryByName } from "../utility/sorting";

type RenamePopupContext = {
  show?: (entries: FilesystemEntry[]) => void;
  hide?: () => void;
};

type RenamePopupProps = {
  context: RenamePopupContext;
};

function RenamePopup(props: RenamePopupProps) {
  const [ isVisible, setVisible ] = createSignal(false);
  const [ buttonState, setButtonState ] = createSignal(SubmitButtonStates.DISABLED);
  const [ targetEntries, setTargetEntries ] = createSignal<FilesystemEntry[]>([]);
  const [ showAccessibilityOutline, setAccessibilityOutline ] = createSignal<boolean>(false);
  const [ currentText, setCurrentText ] = createSignal("");
  const [ targetName, setTargetName ] = createSignal("");
  const [ inputRef, setInputRef ] = createSignal<HTMLInputElement | null>(null);

  const onInput = (event: Event) => {
    // @ts-ignore
		const newText = event.target.value as string;

    setCurrentText(newText);
    
    if (newText.length > CONSTANTS.MAX_FILE_NAME_SIZE) {
      setCurrentText(newText.slice(0, 10));
      return;
    }
  };

  createEffect(() => {
    // Check new name's validity
    const newName = targetName();

    if (newName.length > 0) {

    }
  });

  // Set context
  props.context.show = (entries: FilesystemEntry[]) => {
    if (entries.length == 0) {
      console.error("Tried opening rename popup but provided entries count was zero!");
      return;
    }

    // Sort entries by alphabetical order
    entries.sort((a, b) => sortFilesystemEntryByName(a, b, false));

    // Update
    setTargetEntries(entries);
    setVisible(true);

    // Force select the input
    const inputElement = inputRef();

    if (inputElement != null) {
      inputElement.select();
    } else {
      console.error("inputRef is null!");
    }

    // Select first entry and use that to set the default renaming text
    const firstEntry = entries[0];
    setCurrentText(firstEntry.name);
  };

  props.context.hide = () => {
    setVisible(false);
  };

  return (
    <div
      class="
        absolute flex justify-center items-center self-center w-full h-full right-0 z-10
        backdrop-blur-[2px] backdrop-brightness-[0.85]
      "
      style={`${!isVisible() && "display: none;"}`}
      onDrop={(event) => event.preventDefault() } // This is here just in case the user misses the drop window and drops on the edge instead
    >
      <div
        class="
          flex flex-col items-center rounded-xl w-[90%] max-w-[400px] aspect-[3] z-30
          bg-zinc-100 border-solid border-2 border-zinc-500 drop-shadow-xl
        "
      >
        <CloseButton
          class="absolute w-7 h-7 self-end mr-2 mt-1 rounded-lg hover:bg-zinc-300 active:bg-zinc-400 hover:cursor-pointer"
          onClick={() => {
            setVisible(false);
            setButtonState(SubmitButtonStates.DISABLED);
          }}
        />
        <span class="font-SpaceGrotesk font-semibold text-xl text-zinc-900 mb-0.5 mt-2">
          {`Renaming ${targetEntries().length} item${targetEntries().length != 1 ? "s" : ""}`}
        </span>
        <input
          ref={setInputRef}
          class={`
            flex w-[90%] h-8 px-1.5 mt-2 mb-3
            font-SpaceGrotesk font-normal text-sm
            rounded-md border-2 bg-zinc-200 outline-none
            ${showAccessibilityOutline() ? "border-blue-600" : "border-zinc-600"}
          `}
          value={currentText()}
          onInput={onInput}
          onFocus={() => setAccessibilityOutline(true)}
          onBlur={() => setAccessibilityOutline(false)}
        />
        <button
          type="submit"
          class={`${getSubmitButtonStyle(buttonState())} mb-3`}
          disabled={buttonState() == SubmitButtonStates.DISABLED}
          onClick={() => {
            setButtonState(SubmitButtonStates.DISABLED);
            setVisible(false);
          }}
        >Rename</button>
      </div>
    </div>
  );
}

export type {
  RenamePopupContext,
  RenamePopupProps
}

export {
  RenamePopup
}
