import { createEffect, createSignal, For } from "solid-js";
import { UPLOAD_FILES_COLUMN_WIDTHS } from "../utility/enums";
import { getFormattedBytesSizeText } from "../utility/formatting";
import { Column, ColumnText } from "./Column";
import { SubmitButton, SUBMIT_BUTTON_STATES, getSubmitButtonStyle } from "./SubmitButton";
import CloseButton from "../assets/icons/svg/close.svg?component-solid";
import DesktopIcon from "../assets/icons/svg/desktop-icon.svg?component-solid";
import CheckboxTickIcon from "../assets/icons/svg/checkbox-tick.svg?component-solid";

type UploadFileEntry = {
  file: File,
  name: string,
  size: number
}

type UploadEntryProps = {
  name: string,
  size: number
};

type CheckboxSettingProps = {
  nameText: string,
  settingCallback: Function,
  defaultValue: boolean
};

type UploadSettings = {
  optimiseVideosForStreaming: boolean
};

function UploadEntry(props: UploadEntryProps) {
  const { name, size } = props;
  const sizeInBytesText = getFormattedBytesSizeText(size);

  return (
    <div class="flex flex-row w-[100%] h-6 mb-[1px]">
      <Column width={UPLOAD_FILES_COLUMN_WIDTHS.NAME}>
        <ColumnText textSize="sm" text={name} />
      </Column>
      <Column width={UPLOAD_FILES_COLUMN_WIDTHS.SIZE}>
        <ColumnText text={sizeInBytesText} />
      </Column>
    </div>
  );
}

function CheckboxSetting(props: CheckboxSettingProps) {
  const { nameText, settingCallback, defaultValue } = props;
  const [ enabled, setEnabled ] = createSignal(defaultValue);

  return (
    <div class="flex flex-col w-[100%] h-7 px-2 py-2">
      <div class="flex flex-row">
        <div
          class="flex flex-row items-center border-2 border-blue-700 w-5 h-5 rounded-md
                 hover:bg-blue-100 hover:cursor-pointer active:bg-blue-200"
          onClick={() => {
            const newValue = !enabled();
            setEnabled(newValue);
            settingCallback(newValue);
          }}
        >
          <CheckboxTickIcon
            class="w-4 h-4"
            style={!enabled() ? "visibility: hidden;" : ""}
          />
        </div>
        <h1 class="ml-2 font-SpaceGrotesk text-sm">{nameText}</h1>
      </div>
    </div>
  );
}

type UploadFilesPopupProps = {
  uploadCallback: Function,
  closeCallback: Function,
  wasDraggedOverGetter: Function,
  visibilityGetter: Function
};

function UploadFilesPopup(props: UploadFilesPopupProps) {
  const { uploadCallback, closeCallback, wasDraggedOverGetter, visibilityGetter } = props;
  const [ entriesData, setEntriesData ] = createSignal<UploadFileEntry[]>([]);
  const [ isDraggingOver, setDraggingOver ] = createSignal(false);
  const [ buttonState, setButtonState ] = createSignal(SUBMIT_BUTTON_STATES.DISABLED);

  setButtonState(SUBMIT_BUTTON_STATES.DISABLED);

  const updateEntriesFromFileList = (fileList?: FileList | null) => {
    if (fileList == undefined || fileList == null) {
      setEntriesData([]);
      return;
    }

    let newEntries: UploadFileEntry[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];

      newEntries.push({
        file: file,
        name: file.name,
        size: file.size
      });
    }

    setEntriesData(newEntries);
    setButtonState(SUBMIT_BUTTON_STATES.ENABLED);
  };

  const handleDragOver = (event: any) => {
    event.preventDefault();
    setDraggingOver(true);
  };
  
  const handleDragLeave = (event: any) => {
    setDraggingOver(false);
  };

  const handleDrop = (event: any) => {
    event.preventDefault();
    updateEntriesFromFileList(event.dataTransfer.files);
    setDraggingOver(false);
  };

  // Settings
  let uploadSettings: UploadSettings = {
    optimiseVideosForStreaming: true
  };

  return (
    <div
      onDrop={(event) => event.preventDefault() } // This is here just in case the user misses the drop window and drops on the edge instead
      class={`absolute flex justify-center items-center self-center backdrop-blur-[2px] w-[100%] h-[100%] z-10 backdrop-brightness-90`}
      style={`${!visibilityGetter() && "display: none;"}`}
    >
      <input type="file" id="prompt-select-files" style="display: none;" /> {/* This is used to prompt the user to select files for uploading */}
      <div
        class={`flex flex-col rounded-xl bg-zinc-100 border-solid border-2 border-zinc-500 w-[60%] max-w-[600px] aspect-[2] z-30 items-center drop-shadow-xl`}
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
            class={`flex flex-col justify-center w-[90%] h-[100%] mb-3 border-2 border-dashed transition-all
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
              onClick={() => {
                const prompt = document.getElementById("prompt-file-select-input");

                if (prompt != undefined)
                  prompt.click();
              }}
            >
              <DesktopIcon class="w-[30px] h-[30px] mr-1" />
              <h1 class="font-SpaceGrotesk font-semibold text-xl text-blue-600 self-center pointer-events-none select-none">Browse computer</h1>
            </button>
          </div>
        ) : (
          <div class="flex flex-row justify-between w-[90%] h-[100%] mb-3">
            <div class="flex flex-col w-[65%] h-[100%] mr-2 bg-zinc-200 rounded-md overflow-y-auto">
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
            <div class="flex flex-col w-[35%] h-[100%] rounded-md border-blue-200 border-dashed">
              <CheckboxSetting
                settingCallback={(value: boolean) => uploadSettings.optimiseVideosForStreaming = value}
                defaultValue={uploadSettings.optimiseVideosForStreaming}
                nameText="Optimise videos for streaming"
              />
            </div>
          </div>
        )}
        <span class="space-x-2">
          <button
            type="submit"
            onClick={() => {
              const data: UploadFileEntry[] = entriesData();
              setEntriesData([]); // Clear entries
              setButtonState(SUBMIT_BUTTON_STATES.DISABLED);
              uploadCallback(data);
            }}
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

export type {
  UploadFileEntry,
  UploadFilesPopupProps
}

export {
  UploadFilesPopup
}
