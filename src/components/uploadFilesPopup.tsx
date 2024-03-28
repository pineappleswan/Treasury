import { createSignal, For } from "solid-js";
import { UPLOAD_FILES_COLUMN_WIDTHS } from "../client/columnWidths";
import { getFormattedBytesSizeText } from "../common/commonUtils";
import { Column, ColumnText } from "./column";
import { SubmitButtonStates, getSubmitButtonStyle } from "./submitButton";
import { UploadFileEntry } from "../client/transfers";
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";
import CONSTANTS from "../common/constants";

// Icons
import CloseButton from "../assets/icons/svg/close.svg?component-solid";
import DesktopIcon from "../assets/icons/svg/desktop-icon.svg?component-solid";
import CheckboxTickIcon from "../assets/icons/svg/checkbox-tick.svg?component-solid";
import AlertTriangle from "../assets/icons/svg/alert-triangle.svg?component-solid";

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
  uploadCallback: (entries: UploadFileEntry[]) => void, // TODO: type checking for functions???
  closeCallback: () => void,
  isVisibleGetter: () => boolean
};

function UploadFilesPopup(props: UploadFilesPopupProps) {
  const { uploadCallback, closeCallback, isVisibleGetter } = props;
  const [ entriesData, setEntriesData ] = createSignal<UploadFileEntry[]>([]);
  const [ isDraggingOver, setDraggingOver ] = createSignal(false);
  const [ buttonState, setButtonState ] = createSignal(SubmitButtonStates.DISABLED);

  const updateEntriesFromFileList = (fileList?: FileList | null) => {
    if (fileList == undefined || fileList == null) {
      setEntriesData([]);
      return;
    }

    // Every character as zeroes in the file handle points to the root directory
    const uploadParentHandle = "0".repeat(CONSTANTS.FILE_HANDLE_LENGTH); 
    let newUploadEntries: UploadFileEntry[] = [];

    // Convert files in the file list to upload entries
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      newUploadEntries.push({
        fileName: file.name,
        fileSize: file.size,
        file: file,
        parentHandle: uploadParentHandle,
        progressCallbackHandle: generateSecureRandomAlphaNumericString(CONSTANTS.PROGRESS_CALLBACK_HANDLE_LENGTH)
      });
    }
    
    // Sort
    newUploadEntries.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" }));

    setEntriesData(newUploadEntries);
    setButtonState(SubmitButtonStates.ENABLED);
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

  // Upload settings
  let uploadSettings: UploadSettings = {
    optimiseVideosForStreaming: false
  };

  return (
    <div
      onDrop={(event) => event.preventDefault() } // This is here just in case the user misses the drop window and drops on the edge instead
      class={`absolute flex justify-center items-center self-center backdrop-blur-[2px] w-[100%] h-[100%] z-10 backdrop-brightness-[0.85]`}
      style={`${!isVisibleGetter() && "display: none;"}`}
    >
      <input type="file" id="prompt-select-files" style="display: none;" /> {/* This is used to prompt the user to select files for uploading */}
      <div
        class={`flex flex-col rounded-xl bg-zinc-100 border-solid border-2 border-zinc-500 w-[90%] max-w-[700px] aspect-[2] z-30 items-center drop-shadow-xl`}
      >
        <CloseButton
          class="absolute w-8 h-8 self-end mr-2 mt-1 rounded-lg hover:bg-zinc-300 active:bg-zinc-400 hover:cursor-pointer"
          onClick={() => {
            closeCallback();
            setEntriesData([]); // Clear entries
            setButtonState(SubmitButtonStates.DISABLED);
          }}
        />
        <h1 class="font-SpaceGrotesk font-semibold text-2xl text-zinc-900 mb-2 mt-2">Upload files</h1>
        {(buttonState() == SubmitButtonStates.DISABLED) ? (
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
              // This input exists so the .click() function can be called, prompting the user to select files for upload
              id="prompt-file-select-input"
              type="file"
              onInput={(e) => updateEntriesFromFileList(e.target.files)}
              multiple
              hidden
            />
            <button
              class="flex flex-row self-center rounded-md px-1 py-0.5 hover:cursor-pointer hover:bg-blue-200 active:bg-blue-300"
              onClick={async () => {
                const prompt = document.getElementById("prompt-file-select-input");

                if (prompt != undefined) {
                  /*
                  let fileHandles: FileSystemFileHandle[] = [];
                  let files: File[] = [];

                  try {
                    fileHandles = await showOpenFilePicker({
                      multiple: true,
                    });

                    let promises = [];

                    fileHandles.forEach(async (handle) => {
                      files.push(await handle.getFile());
                    });
                  } catch (error) {
                    console.error(`showOpenFilePicker() failed with error: ${error}`)
                  }
                  */

                  prompt.click(); // TODO: possibly use showOpenFilePicker()
                } else {
                  console.error("Couldn't find element 'prompt-file-select-input'!");
                }
              }}
            >
              <DesktopIcon class="w-[30px] h-[30px] mr-1" />
              <h1 class="font-SpaceGrotesk font-semibold text-xl text-blue-600 self-center pointer-events-none select-none">Browse computer</h1>
            </button>
          </div>
        ) : (
          <div class="flex flex-row justify-between w-[93%] h-[100%] mb-3 ml-[5%] mr-[3%]">
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
                {(entryInfo) => (
                  <UploadEntry name={entryInfo.fileName} size={entryInfo.fileSize} />
                )}
              </For>
            </div>
            <div class="flex flex-col w-[35%] h-[100%] rounded-md border-blue-200 border-dashed">
              <CheckboxSetting
                settingCallback={(value: boolean) => uploadSettings.optimiseVideosForStreaming = value}
                defaultValue={uploadSettings.optimiseVideosForStreaming}
                nameText="Optimise videos for streaming"
              />
              <span class="flex flex-row font-SpaceGrotesk text-medium text-xs text-red-600 px-2 py-6">
                <AlertTriangle class="shrink-0 mr-2 ml-0.5" />
                Optimising videos for streaming will modify the file and use more RAM
              </span>
            </div>
          </div>
        )}
        <span class="space-x-2">
          <button
            type="submit"
            class={`${getSubmitButtonStyle(buttonState())} mb-3`}
            disabled={buttonState() == SubmitButtonStates.DISABLED}
            onClick={() => {
              const data: UploadFileEntry[] = entriesData();
              setEntriesData([]); // Clear gui entries
              setButtonState(SubmitButtonStates.DISABLED);
              uploadCallback(data);
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
  UploadFileEntry,
  UploadFilesPopupProps
}

export {
  UploadFilesPopup
}
