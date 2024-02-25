import { createEffect, createSignal } from "solid-js";
import { UPLOAD_FILES_COLUMN_WIDTHS } from "../utility/enums";
import { getFormattedBytesSizeText } from "../utility/formatting";
import { Column, ColumnText } from "./Column";
import { SubmitButton, SUBMIT_BUTTON_STATES, getSubmitButtonStyle } from "./SubmitButton";
import CloseButton from "../assets/icons/svg/close.svg?component-solid"
import DesktopIcon from "../assets/icons/svg/desktop-icon.svg?component-solid"

function CreateUploadFileEntryInfo(file) {
  return {
    file: file,
    fileName: file.name,
    sizeInBytes: file.size
  };
}

function UploadEntry(props) {
  const { fileName, sizeInBytes } = props;
  const sizeInBytesText = getFormattedBytesSizeText(sizeInBytes);

  return (
    <div class="flex flex-row w-[100%] h-6 mb-[1px]">
      <Column width={UPLOAD_FILES_COLUMN_WIDTHS.NAME}>
        <ColumnText textSize="sm" text={fileName} />
      </Column>
      <Column width={UPLOAD_FILES_COLUMN_WIDTHS.SIZE}>
        <ColumnText text={sizeInBytesText} />
      </Column>
    </div>
  );
}

function UploadFilesPopup(props) {
  const { wasDraggedOverGetter, uploadCallback, closeCallback, visibilityGetter } = props;

  if (wasDraggedOverGetter == undefined)
    throw new Error("wasDraggedOverGetter is undefined!");
  
  if (uploadCallback == undefined)
    throw new Error("uploadCallback is undefined!");

  if (closeCallback == undefined)
    throw new Error("closeCallback is undefined!");

  if (visibilityGetter == undefined)
    throw new Error("visibilityGetter is undefined!");

  const [ entriesData, setEntriesData ] = createSignal([]);
  const [ isDraggingOver, setDraggingOver ] = createSignal(false);
  const [ buttonState, setButtonState ] = createSignal(SUBMIT_BUTTON_STATES.DISABLED);

  const updateEntriesFromFileList = (fileList) => {
    console.log(fileList);

    let newEntries = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      newEntries.push(CreateUploadFileEntryInfo(file));
    }

    setEntriesData(newEntries);
    setButtonState(SUBMIT_BUTTON_STATES.ENABLED);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setDraggingOver(true);
  };
  
  const handleDragLeave = (event) => {
    setDraggingOver(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();

    const files = event.dataTransfer.files;
    updateEntriesFromFileList(files);
    setDraggingOver(false);
  };

  return (
    <div
      onDrop={(event) => event.preventDefault() } // This is here just in case the user misses the drop window and drops on the edge instead
      class={`absolute inset-0 flex justify-center items-center backdrop-blur-[2px] w-[100%] h-[100%] z-10 backdrop-brightness-90`}
      style={`${!visibilityGetter() && "display: none;"}`}
    >
      <input type="file" id="prompt-select-files" class="invisible" /> {/* This is used to prompt the user to select files for uploading */}
      <div
        class={`flex flex-col rounded-xl bg-zinc-100 border-solid border-2 border-zinc-500 w-[60%] max-w-[600px] aspect-[1.5] z-30 items-center drop-shadow-xl`}
      >
        <CloseButton
          class="absolute w-8 h-8 self-end mr-2 mt-1 rounded-lg hover:bg-zinc-300 active:bg-zinc-400 hover:cursor-pointer"
          onClick={() => {
            closeCallback();
            setEntriesData([]); // Clear entries
            setButtonState(SUBMIT_BUTTON_STATES.DISABLED);
          }}
        />
        <h1 class="font-SpaceGrotesk font-semibold text-2xl text-zinc-900 mb-2 mt-2">Upload files</h1>
        {(buttonState() == SUBMIT_BUTTON_STATES.DISABLED) ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            class={`flex flex-col flex-grow justify-center w-[90%] mb-3 border-2 border-dashed transition-all
                    ${isDraggingOver() ? "rounded-2xl border-blue-700 bg-blue-200" : "rounded-md border-blue-500 bg-blue-100"}`}
          >
            <h1 class="font-SpaceGrotesk font-semibold text-3xl text-blue-600 self-center pointer-events-none select-none">Drag and drop</h1>
            <h1 class="font-SpaceGrotesk font-medium text-xl text-blue-500 mt-1 self-center pointer-events-none select-none">OR</h1>
            <input
              id="prompt-file-select-input"
              type="file"
              onInput={(e) => updateEntriesFromFileList(e.target.files)}
              multiple
              hidden
            />
            <button
              class="flex flex-row self-center rounded-md px-1 py-0.5 hover:cursor-pointer hover:bg-blue-200 active:bg-blue-300"
              type="file"
              onClick={() => document.getElementById("prompt-file-select-input").click()}
              multiple
            >
              <DesktopIcon class="w-[30px] h-[30px] mr-1" />
              <h1 class="font-SpaceGrotesk font-semibold text-xl text-blue-600 self-center pointer-events-none select-none">Browse computer</h1>
            </button>
          </div>
        ) : (
          <div class="flex flex-col flex-grow w-[90%] bg-zinc-200 rounded-md mb-3">
            <div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-7 border-b-[1px] border-zinc-400 bg-zinc-300 rounded-t-md">
              <Column width={UPLOAD_FILES_COLUMN_WIDTHS.NAME}>
                <ColumnText text="Name" semibold/>
              </Column>
              <Column width={UPLOAD_FILES_COLUMN_WIDTHS.UPLOAD}>
                <ColumnText text="Size" semibold/>
              </Column>
            </div>
            <For each={entriesData()}>
              {(entryInfo, index) => (
                <UploadEntry
                  {...entryInfo}
                />
              )}
            </For>
          </div>
        )}
        <span class="space-x-2">
          <button
            type="submit"
            onClick={() => uploadCallback(entriesData())}
            disabled={buttonState() == SUBMIT_BUTTON_STATES.DISABLED}
            class={`${getSubmitButtonStyle(buttonState())} mb-3`}
          >
            Upload
          </button>
        </span>
      </div>
    </div>
  );
}

export {
  UploadFilesPopup,
  CreateUploadFileEntryInfo
}
