import { UPLOAD_FILES_COLUMN_WIDTHS } from "../utility/enums";
import { getFormattedBytesSizeText } from "../utility/formatting";
import { Column, ColumnText } from "./Column";

function CreateUploadFileEntryInfo(fileName, sizeInBytes) {
  return {
    fileName: fileName,
    sizeInBytes: sizeInBytes
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
  const { entriesInfo, uploadCallback } = props;
  
  if (entriesInfo == undefined) {
    throw new Error("entriesInfo is undefined!");
  }
  
  if (uploadCallback == undefined) {
    throw new Error("uploadCallback is undefined!");
  }

  return (
    <div
      class={`flex flex-col rounded-xl bg-zinc-100 border-solid border-2 border-zinc-500 w-[60%] max-w-[600px] aspect-[1.5] z-30 items-center drop-shadow-xl`}
    >
      <h1 class="font-SpaceGrotesk font-semibold text-2xl text-zinc-900 mb-2 mt-2">Upload files</h1>
      <div class="flex flex-col flex-grow w-[90%] bg-zinc-200 rounded-md mb-6">
        {/* Top bar */}
        <div class="flex flex-row flex-nowrap flex-shrink-0 w-[100%] h-7 border-b-[1px] border-zinc-400 bg-zinc-300 rounded-t-md">
          <Column width={UPLOAD_FILES_COLUMN_WIDTHS.NAME}>
            <ColumnText text="Name" semibold/>
          </Column>
          <Column width={UPLOAD_FILES_COLUMN_WIDTHS.UPLOAD}>
            <ColumnText text="Size" semibold/>
          </Column>
        </div>
        <For each={entriesInfo}>
          {(entryInfo, index) => (
            <UploadEntry
              {...entryInfo}
            />
          )}
        </For>
      </div>
      <button
        class="w-10 h-6 bg-zinc-600"
        onClick={() => uploadCallback(entriesInfo)}
      >
        Upload
      </button>
    </div>
  );
}

export {
  UploadFilesPopup,
  CreateUploadFileEntryInfo
}
