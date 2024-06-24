import { Suspense, createEffect, createResource, createSignal, getOwner, onCleanup, onMount, runWithOwner } from "solid-js";
import { FileExplorerWindow, FilesystemEntry, FileExplorerContext } from "../components/fileExplorer";
import { TransferListWindow, TransferStatus, TransferListWindowContext } from "../components/transferList";
import { SettingsMenuContext, SettingsMenuWindow } from "../components/settingsMenu";
import { UploadFileRequest } from "../components/uploadFilesPopup";
import { TransferListMenuEntry, TransfersMenuEntryContext } from "../components/transferMenuEntry";
import { clearLocalStorageAuthenticationData, getLocalStorageUserCryptoInfo } from "../client/localStorage";
import { UserFilesystem } from "../client/userFilesystem";
import { showSaveFilePicker } from "native-file-system-adapter";
import { getDefaultUserSettings, getTimeOffsetInMinutesFromTimezoneName, UserSettings } from "../client/userSettings";
import { Vector2D } from "../client/clientEnumsAndTypes";
import { deduplicateFileEntryName } from "../utility/fileNames";
import { AppServices } from "../client/appServices";
import { WindowType } from "../client/clientEnumsAndTypes";
import cryptoRandomString from "crypto-random-string";
import UserBar from "../components/userBar";
import CONSTANTS from "../client/constants";

import {
  FilesystemMenuEntry,
  LogoutMenuEntry,
  QuotaMenuEntry,
  SettingsMenuEntry,
  SharedMenuEntry,
  TrashMenuEntry
} from "../components/navBarMenuEntries";

import {
  TransferType,
  ClientDownloadManager,
  ClientUploadManager,
  UploadFinishCallback,
  UploadFailCallback,
  DownloadFileContext,
  DownloadFileMethod,
  UploadSettings
} from "../client/transfers";

type TreasuryPageAsyncProps = {
  username: string;
  userFilesystem: UserFilesystem;
  userSettings: UserSettings;
};

function Logout() {
  fetch("/api/logout", { method: "POST" })
  .then((response) => {
    if (response.ok) { // When server responds with 200, redirect user to login page
      clearLocalStorageAuthenticationData();
      window.location.pathname = "/login";
    }
  });
}

async function TreasuryPageAsync(props: TreasuryPageAsyncProps) {
  // Get user crypto info
  const userLocalCryptoInfo = getLocalStorageUserCryptoInfo();

  if (userLocalCryptoInfo === null) {
    console.error(`userLocalCryptoInfo is null!`);
    return;
  }

  const { userFilesystem } = props;
  const [ currentWindow, setCurrentWindow ] = createSignal(WindowType.Filesystem); // Default is filesystem view
  const [ userSettings, updateUserSettings ] = createSignal(props.userSettings);
  let leftSideNavBar: HTMLDivElement | undefined;

  // Contexts
  const fileExplorerWindowContext: FileExplorerContext = {};
  const settingsMenuWindowContext: SettingsMenuContext = {};
  const uploadTransferListContext: TransferListWindowContext = {};
  const downloadTransferListContext: TransferListWindowContext = {};

  // Download manager
  const downloadManager = new ClientDownloadManager();

  // Upload manager
  const uploadFinishCallback: UploadFinishCallback = (progressCallbackHandle: string, newFilesystemEntries: FilesystemEntry[]) => {
    newFilesystemEntries.forEach(entry => userFilesystem.addNewFileEntryLocally(entry, entry.parentHandle));
    fileExplorerWindowContext.reactAndUpdate?.(); // Refresh the file explorer
  };
  
  const uploadFailCallback: UploadFailCallback = (progressCallbackHandle: string) => {
    uploadTransferListContext.progressCallback?.(progressCallbackHandle, TransferType.Uploads, TransferStatus.Failed, undefined, undefined, undefined, undefined, "");
  };

  const uploadSettings: UploadSettings = {
    optimiseVideosForStreaming: false
  };

  const uploadManager: ClientUploadManager = new ClientUploadManager(
    uploadFinishCallback,
    uploadFailCallback,
    uploadSettings
  );

  // These callbacks are called from any child components of the treasury page
  const uploadFilesService = (entries: UploadFileRequest[]) => {
    uploadsMenuEntrySettings.notify!();
    // setCurrentWindow(WindowType.Uploads);

    entries.forEach(entry => {
      // Deduplicate the file name
      const deduplicatedName = deduplicateFileEntryName(entry.fileName, entry.parentHandle, userFilesystem);
      
      // TODO: show user popup with all the deduplicated names as a warning! User should confirm/deny.
      if (entry.fileName != deduplicatedName) {
        console.log("Deduplicated file entry name!");
      }

      entry.fileName = deduplicatedName;

      uploadManager.addToUploadQueue(entry);
    });
  };

  const downloadFilesService = (entries: FilesystemEntry[]) => {
    downloadsMenuEntrySettings.notify!();

    entries.forEach(async (entry) => {
      if (entry.isFolder) {
        console.log("Download folder is not implemented yet!"); // TODO: folder download support
        return;
      }

      const progressCallbackHandle = cryptoRandomString({ length: CONSTANTS.PROGRESS_CALLBACK_HANDLE_LENGTH, type: "alphanumeric" });

      try {
        // Open output file
        const outputFileHandle = await showSaveFilePicker({
          suggestedName: entry.name
        });

        const outputWritableStream = await outputFileHandle.createWritable();

        const downloadContext: DownloadFileContext = {
          method: DownloadFileMethod.WritableStream,
          writableStream: outputWritableStream
        };

        await downloadManager.downloadWholeFile(
          entry,
          downloadContext,
          undefined,
          progressCallbackHandle,
          entry.name,
          downloadTransferListContext.progressCallback
        );
      } catch (error: any) {
        if (error && error.reason) {
          const reason = error.reason;
          console.error(`Download cancelled for reason: ${reason}`);
        } else {
          console.error(`Download cancelled for error: ${error}`);
        }
      }
    });
  };

  const downloadFilesAsZipService = async (entries: FilesystemEntry[]) => {
    downloadsMenuEntrySettings.notify!();

    // Open output file
    const outputFileHandle = await showSaveFilePicker({
      suggestedName: "download.zip" // TODO: maybe include timestamp in the name?
    });

    const outputWritableStream = await outputFileHandle.createWritable();

    const downloadContext: DownloadFileContext = {
      method: DownloadFileMethod.WritableStream,
      writableStream: outputWritableStream
    };

    const result = await downloadManager.downloadFilesAsZip(entries, downloadContext, undefined, downloadTransferListContext.progressCallback);
    console.log(result);
  };

  const appServices: AppServices = {
    uploadFiles: uploadFilesService,
    downloadFiles: downloadFilesService,
    downloadFilesAsZip: downloadFilesAsZipService,
  };

  // These are needed for the notify functions inside them
  const uploadsMenuEntrySettings: TransfersMenuEntryContext = {};
  const downloadsMenuEntrySettings: TransfersMenuEntryContext = {};

  const [ navbarVisible, setNavbarVisible ] = createSignal(true);

  const checkScreenFit = () => {
    const documentSize: Vector2D = { x: document.body.clientWidth, y: document.body.clientHeight };

    if (documentSize.x < 800) { // TODO: show controls at bottom of screen + ONLY check screen fit for mobile plz, detect mobile device
      setNavbarVisible(false);
    } else {
      setNavbarVisible(true);
    }
  }

  // Settings menu callbacks
  const userSettingsUpdateCallback = (settings: UserSettings) => {
    updateUserSettings(settings);
    fileExplorerWindowContext.reactAndUpdate?.();

    return true;
  };
  
  // Event listeners
  window.addEventListener("resize", checkScreenFit);

  createEffect(() => {
    if (currentWindow() != WindowType.Settings) {
      settingsMenuWindowContext.close!();
    }
  });

  onMount(() => {
    checkScreenFit();

    // Initialise file explorer
    fileExplorerWindowContext.openDirectory?.(CONSTANTS.ROOT_DIRECTORY_HANDLE);

    // Set callback
    const infoListCallback = uploadTransferListContext.progressCallback;

    if (infoListCallback !== undefined) {
      uploadManager.setInfoListCallback(infoListCallback);
    } else {
      console.error("Upload transfer list context progressCallback is undefined!");
    }
  });

  onCleanup(() => {
    window.removeEventListener("resize", checkScreenFit);
  });

  const jsx = (
    <div class="flex flex-row w-screen h-screen bg-zinc-50 overflow-hidden">
      <div
        ref={leftSideNavBar}
        class={`flex flex-col min-w-[240px] w-[240px] items-center justify-between h-screen border-r-2 border-solid border-[#] bg-[#fcfcfc]`}
        style={`${!navbarVisible() && "display: none;"}`}
      >
        <UserBar username={props.username} />
        <div class="flex flex-col items-center w-full">
          {/* Transfers section */}
          <div class="flex flex-col mt-4 w-[95%]">
            <span class="mb-1 pl-1 font-SpaceGrotesk font-medium text-sm text-zinc-600">Transfers</span>
            <TransferListMenuEntry
              transferType={TransferType.Uploads}
              context={uploadsMenuEntrySettings}
              getTransferSpeed={uploadTransferListContext.transferSpeedCalculator!.getSpeedGetter}
              userSettings={userSettings}
              currentWindowGetter={currentWindow}
              currentWindowSetter={setCurrentWindow}
            />
            <TransferListMenuEntry
              transferType={TransferType.Downloads}
              context={downloadsMenuEntrySettings}
              getTransferSpeed={downloadTransferListContext.transferSpeedCalculator!.getSpeedGetter}
              userSettings={userSettings}
              currentWindowGetter={currentWindow}
              currentWindowSetter={setCurrentWindow}
            />
          </div>

          {/* Filesystem section */}
          <div class="flex flex-col mt-4 w-[95%]"> 
            <span class="mb-0 pl-1 font-SpaceGrotesk font-medium text-sm text-zinc-600">Filesystem</span>
            <FilesystemMenuEntry currentWindowAccessor={currentWindow} currentWindowSetter={setCurrentWindow} />
            <SharedMenuEntry currentWindowAccessor={currentWindow} currentWindowSetter={setCurrentWindow} />
            <TrashMenuEntry currentWindowAccessor={currentWindow} currentWindowSetter={setCurrentWindow} />
          </div>
        </div>
        <div class="flex-grow"></div>
        <div class="flex flex-col mt-2 mb-2 w-[95%]">
          <QuotaMenuEntry
            currentWindowAccessor={currentWindow}
            currentWindowSetter={setCurrentWindow}
            userFilesystem={userFilesystem}
            userSettings={userSettings}
          />
          <SettingsMenuEntry currentWindowAccessor={currentWindow} currentWindowSetter={setCurrentWindow} />
          <LogoutMenuEntry logoutCallback={Logout} />
        </div>
      </div>
      <FileExplorerWindow
        context={fileExplorerWindowContext}
        visible={currentWindow() == WindowType.Filesystem}
        userFilesystem={props.userFilesystem}
        leftSideNavBar={leftSideNavBar}
        appServices={appServices}
        userSettings={userSettings}
        uploadSettings={uploadSettings}
        currentWindowType={currentWindow}
      />
      <TransferListWindow
        visible={currentWindow() == WindowType.Uploads}
        userSettings={userSettings}
        transferType={TransferType.Uploads}
        context={uploadTransferListContext}
        />
      <TransferListWindow
        visible={currentWindow() == WindowType.Downloads}
        userSettings={userSettings}
        transferType={TransferType.Downloads}
        context={downloadTransferListContext}
      />
      <SettingsMenuWindow
        context={settingsMenuWindowContext}
        userSettings={userSettings}
        userSettingsUpdateCallback={userSettingsUpdateCallback}
        visible={currentWindow() == WindowType.Settings}
      />
    </div>
  );

  return jsx;
}

// TODO: better loading page where it shows what stage it is at (username -> storage quota -> get filesystem -> processing filesystem)
let isTreasuryLoading = true;

function TreasuryLoadingPage() {
  const [ loadingText, setLoadingText ] = createSignal("");
  let dotCount = 0;

  const loadingTextLoop = () => {
    setLoadingText(`Loading your data${".".repeat(dotCount)}`)
    dotCount++;
    dotCount = dotCount % 4;
    
    if (isTreasuryLoading) {
      setTimeout(loadingTextLoop, 750);
    }
  }

  loadingTextLoop();

  return (
    <div class="flex flex-col items-center justify-center w-screen h-screen">
      <span class="font-SpaceGrotesk font-medium text-lg mb-2">
        {loadingText()}
      </span>
    </div>
  );
}

function TreasuryErrorPage() {
  return (
    <div class="flex flex-col items-center justify-center w-screen h-screen">
      <span class="font-SpaceGrotesk font-medium text-lg mb-2 text-red-600">
        Your home page failed to load. Try refreshing...
      </span>
    </div>
  );
}

function TreasuryPage() {
  const userLocalCryptoInfo = getLocalStorageUserCryptoInfo();

  if (userLocalCryptoInfo == null) {
    console.error("userLocalCryptoInfo is null!");
    Logout(); // Log out here
    return TreasuryErrorPage();
  }

  // Fixes the 'computations created outside' blah blah solidjs error
  const owner = getOwner();

  const [ page ] = createResource(async () => {
    let pageProps: TreasuryPageAsyncProps = {
      username: "???",
      userFilesystem: new UserFilesystem(),
      userSettings: getDefaultUserSettings()
    };
    
    // Load all user data
    try {
      // Get session info
      const sessionInfo = await fetch("/api/sessiondata");

      if (!sessionInfo.ok) {
        // If forbidden/unauthorised, then just redirect back to login page
        if (sessionInfo.status == 403 || sessionInfo.status == 401)
          Logout();

        throw new Error(`/api/sessiondata responded with status ${sessionInfo.status}`);
      }

      const sessionInfoJson = await sessionInfo.json();

      pageProps.username = sessionInfoJson.username;

      // Get timezone offset automatically if setting is automatic
      pageProps.userSettings.timezoneOffsetInMinutes = getTimeOffsetInMinutesFromTimezoneName(pageProps.userSettings.timezoneSetting);

      // Initialise user filesystem
      await pageProps.userFilesystem.initialise();
    } catch (error) {
      console.error(error);
      isTreasuryLoading = false;
      return TreasuryErrorPage();
    }

    isTreasuryLoading = false;

    return runWithOwner(owner, async () => {
      return await TreasuryPageAsync(pageProps);
    })
  });

  return (
    <Suspense fallback={TreasuryLoadingPage()}>
      {page()}
    </Suspense>
  )
}

export default TreasuryPage;
