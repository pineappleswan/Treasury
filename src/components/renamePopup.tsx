import { createSignal } from "solid-js";
import CloseButton from "../assets/icons/svg/close.svg?component-solid";
import { SubmitButtonStates, getSubmitButtonStyle } from "./submitButton";

type RenamePopupProps = {

};

function RenamePopup(props: RenamePopupProps) {
  const [ isVisible, setVisible ] = createSignal(true);
  const [ buttonState, setButtonState ] = createSignal(SubmitButtonStates.DISABLED);

  return (
    <div
      onDrop={(event) => event.preventDefault() } // This is here just in case the user misses the drop window and drops on the edge instead
      class={`absolute flex justify-center items-center self-center backdrop-blur-[2px] w-full h-full z-10 backdrop-brightness-[0.85]`}
      style={`${!isVisible() && "display: none;"}`}
    >
      <div
        class={`flex flex-col rounded-xl bg-zinc-100 border-solid border-2 border-zinc-500 w-[90%] max-w-[400px] aspect-[3] z-30 items-center drop-shadow-xl`}
      >
        <CloseButton
          class="absolute w-8 h-8 self-end mr-2 mt-1 rounded-lg hover:bg-zinc-300 active:bg-zinc-400 hover:cursor-pointer"
          onClick={() => {
            setVisible(false);
            setButtonState(SubmitButtonStates.DISABLED);
          }}
        />
        <span class="space-x-2">
          <button
            type="submit"
            class={`${getSubmitButtonStyle(buttonState())} mb-3`}
            disabled={buttonState() == SubmitButtonStates.DISABLED}
            onClick={() => {
              setButtonState(SubmitButtonStates.DISABLED);
              setVisible(false);
            }}
          >
            Upload
          </button>
        </span>
      </div>
    </div>
  );
}

export type {
  RenamePopupProps
}

export {
  RenamePopup
}
