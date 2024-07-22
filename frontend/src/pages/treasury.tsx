import { Suspense, createEffect, createResource, createSignal, getOwner, onCleanup, onMount, runWithOwner } from "solid-js";
import { FileExplorerWindow, FilesystemEntry, FileExplorerContext } from "../components/fileExplorer";
import { TransferListWindow, TransferStatus, TransferListWindowContext } from "../components/transferList";
import { SettingsMenuContext, SettingsMenuWindow } from "../components/settingsMenu";
import { UploadFileRequest } from "../components/popups/uploadFilesPopup";
import { TransferListMenuEntry, TransfersMenuEntryContext } from "../components/transferMenuEntry";
import { clearLocalStorageAuthenticationData, getLocalStorageUserCryptoInfo } from "../client/localStorage";
import { UserFilesystem } from "../client/userFilesystem";
import { showSaveFilePicker } from "native-file-system-adapter";
import { getDefaultUserSettings, getTimeOffsetInMinutesFromTimezoneName, UserSettings } from "../client/userSettings";
import { WebSocketSyncCallbacks, WebSocketSyncManager } from "../client/websocketSync";
import { Vector2D } from "../client/enumsAndTypes";
import { deduplicateFileEntryName } from "../utility/fileNames";
import { AppServices } from "../client/appServices";
import { WindowType } from "../client/enumsAndTypes";
import { UserProfileCard, UserProfileCardContext } from "../components/userProfileCard";
import cryptoRandomString from "crypto-random-string";
import CONSTANTS from "../client/constants";

import {
  FilesystemMenuEntry,
  LogoutMenuEntry,
  QuotaMenuEntryContext,
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

// Icons
import EscapeDirectoryIcon from "../assets/icons/svg/escape-directory-arrow.svg?component-solid";
import MenuIcon from "../assets/icons/svg/menu.svg?component-solid";

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

type MenuSectionTitleProps = {
  text: string;
}

function MenuSectionTitle(props: MenuSectionTitleProps) {
  return <span class="mb-0.5 pl-1 font-SpaceGrotesk font-semibold text-sm text-zinc-700">{props.text}</span>
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
  let leftSideNavBarRef: HTMLDivElement | undefined;

  // Contexts
  const fileExplorerWindowContext: FileExplorerContext = {};
  const settingsMenuWindowContext: SettingsMenuContext = {};
  const uploadTransferListContext: TransferListWindowContext = {};
  const downloadTransferListContext: TransferListWindowContext = {};
  const uploadsMenuEntryContext: TransfersMenuEntryContext = {};
  const downloadsMenuEntryContext: TransfersMenuEntryContext = {};
  const userProfileCardContext: UserProfileCardContext = {};

  // Websockets
  const wsCallbacks: WebSocketSyncCallbacks = {
    onMessageCallback: (event: MessageEvent) => {
      let message = event.data as string;

      // Parse message by splitting the message by the separator then processing the events inside.
      let parts = message.split("|");

      if (parts.length % 2 == 1) {
        console.error(`Received web socket message but it splits into an odd number of parts! Message: ${message}`);
      }

      for (let i = 0; i < parts.length / 2; i++) {
        let messageType = parts[i * 2];
        let dataStr = parts[i * 2 + 1];

        if (messageType == "syncFile") {
          try {
            // The data string for this type of event is the handle of the file that was created.
            userFilesystem.syncFile(dataStr)
            .then(() => {
              // Tell file explorer to react and update
              fileExplorerWindowContext.reactAndUpdate?.();
  
              // Tell path ribbon inside file explorer to react and update
              fileExplorerWindowContext.reactAndUpdatePathRibbon?.();
            });
          } catch (error) {
            console.error(`Failed to sync file in web socket sync. Error: ${error}`);
          }
        } else if (message = "sync2FA") {
          settingsMenuWindowContext.sync2FA?.();
        }
      }
    },
    onCloseCallback: () => {
      console.log("Web socket closed.");
    }
  };

  const wsSyncManager = new WebSocketSyncManager(wsCallbacks);

  // Download manager
  const downloadManager = new ClientDownloadManager();

  // Upload manager
  const uploadFinishCallback: UploadFinishCallback = (progressCallbackHandle: string, newFilesystemEntries: FilesystemEntry[]) => {
   // If the web socket is not open, then synchronisation from the server isn't possble so 
   // locally add the newly uploaded files here in the finish callback instead of in the 
   // web socket callbacks.
    if (!wsSyncManager.isOpen()) {
      newFilesystemEntries.forEach(entry => userFilesystem.addNewFileEntryLocally(entry, entry.parentHandle));
      fileExplorerWindowContext.reactAndUpdate?.(); // Refresh the file explorer
    }
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
    uploadsMenuEntryContext.notify!();
    // setCurrentWindow(WindowType.Uploads);

    entries.forEach(entry => {
      // Deduplicate the file name
      const deduplicatedName = deduplicateFileEntryName(entry.fileName, entry.parentHandle, userFilesystem);
      
      // TODO: show user popup with all the deduplicated names as a warning! User should confirm/deny.
      if (entry.fileName != deduplicatedName) {
        console.log("Deduplicated file entry name!");
      }

      entry.fileName = deduplicatedName;

      uploadManager.upload(entry);
    });
  };

  const downloadFilesService = (entries: FilesystemEntry[]) => {
    downloadsMenuEntryContext.notify!();

    entries.forEach(async (entry) => {
      if (entry.isFolder) {
        console.log("Download folder is not implemented yet!"); // TODO: folder download support
        return;
      }

      // Generate a random progress callback handle
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
    downloadsMenuEntryContext.notify!();

    // Open output file
    const outputFileHandle = await showSaveFilePicker({
      // TODO: include timestamp in the name
      suggestedName: "download.zip"
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

  // Window setter
  const setWindowType = (windowType: WindowType) => {
    console.log(windowType);

    setCurrentWindow(windowType);
  };

  // These are needed for the notify functions inside them
  const [ smallScreen, setSmallScreen ] = createSignal(false);

  const reactToScreenSize = () => {
    const windowSize: Vector2D = { x: window.innerWidth, y: window.innerHeight };

    setSmallScreen(windowSize.x < CONSTANTS.SMALL_SCREEN_WIDTH_THRESHOLD);
    
    if (smallScreen()) {
      setCurrentWindow(WindowType.None);
    } else if (currentWindow() == WindowType.None) {
      setCurrentWindow(WindowType.Filesystem);
    }
  };

  const goBackToLeftNavBar = () => {
    setCurrentWindow(WindowType.None);
  };

  // Settings menu callbacks
  const userSettingsUpdateCallback = (settings: UserSettings) => {
    updateUserSettings(settings);
    fileExplorerWindowContext.reactAndUpdate?.();

    // Refresh quota UI because user might have changed a setting that affects it.
    userProfileCardContext.setStorageQuota?.(userFilesystem.getStorageQuota());

    return true;
  };
  
  // Event listeners
  window.addEventListener("resize", reactToScreenSize);

  createEffect(() => {
    if (currentWindow() != WindowType.Settings) {
      settingsMenuWindowContext.close!();
    }
  });

  // Once initial rendering is complete, perform some important tasks
  onMount(() => {
    reactToScreenSize();

    // Initialise file explorer
    fileExplorerWindowContext.openDirectory?.(CONSTANTS.ROOT_DIRECTORY_HANDLE);

    // Set callback
    const infoListCallback = uploadTransferListContext.progressCallback;

    if (infoListCallback !== undefined) {
      uploadManager.setInfoListCallback(infoListCallback);
    } else {
      console.error("Upload transfer list context progressCallback is undefined!");
    }

    // Refresh storage quota UI
    userProfileCardContext.setStorageQuota?.(userFilesystem.getStorageQuota());
  });

  onCleanup(() => {
    window.removeEventListener("resize", reactToScreenSize);
  });

  const jsx = (
    <div class="flex flex-row w-screen h-screen bg-zinc-50 overflow-hidden">
      {/* Left side nav bar */}
      <div
        ref={leftSideNavBarRef}
        class={`
          flex flex-col h-screen px-1.5
          border-r-2 border-solid border-[#] bg-[#fcfcfc]
          items-center justify-between
          ${(smallScreen() && currentWindow() == WindowType.None) ? "w-full" : "min-w-[240px] w-[240px]"}
          ${smallScreen() && currentWindow() != WindowType.None ? "hidden" : ""}
        `}
      >
        <UserProfileCard
          username={props.username}
          context={userProfileCardContext}
          userSettings={userSettings}
        />

        {/* Transfers section */}
        <div class="flex flex-col mt-3 w-full">
          <MenuSectionTitle text="Transfers" />
          <div class="space-y-0.5">
            <TransferListMenuEntry
              transferType={TransferType.Uploads}
              context={uploadsMenuEntryContext}
              getTransferSpeed={uploadTransferListContext.transferSpeedCalculator!.getSpeedGetter}
              userSettings={userSettings}
              currentWindowType={currentWindow}
              setWindowType={setWindowType}
            />
            <TransferListMenuEntry
              transferType={TransferType.Downloads}
              context={downloadsMenuEntryContext}
              getTransferSpeed={downloadTransferListContext.transferSpeedCalculator!.getSpeedGetter}
              userSettings={userSettings}
              currentWindowType={currentWindow}
              setWindowType={setWindowType}
            />
          </div>
        </div>

        {/* Files section */}
        <div class="flex flex-col mt-4 w-full">
          <MenuSectionTitle text="Files" />
          <div class="space-y-0.5">
            <FilesystemMenuEntry currentWindowType={currentWindow} setWindowType={setWindowType} />
            <SharedMenuEntry currentWindowType={currentWindow} setWindowType={setWindowType} />
            <TrashMenuEntry currentWindowType={currentWindow} setWindowType={setWindowType} />
          </div>
        </div>

        {/* Spacing */}
        <div class="flex-grow"></div>

        {/* Settings and log out section */}
        <div class="flex flex-col mb-2 w-full space-y-0.5">
          <SettingsMenuEntry currentWindowType={currentWindow} setWindowType={setWindowType} />
          <LogoutMenuEntry logoutCallback={Logout} />
        </div>
      </div>

      {/* Window container */}
      <div
        class={`
          flex flex-col w-full
          ${currentWindow() == WindowType.None ? "hidden" : ""}
        `}
      >
        {/* Go back top bar used for small screens */}
        <div
          class={`
            flex flex-row shrink-0 w-full h-10 items-center bg-zinc-200 border-b-2 border-zinc-400
            ${(smallScreen() && currentWindow() != WindowType.None) ? "" : "hidden"}
          `}
        >
          <div class="flex flex-row w-full items-center">
            <div
              class={`
                flex rounded-md w-7 h-7 mr-2 ml-1.5 items-center justify-center
                hover:bg-zinc-300 hover:cursor-pointer active:bg-zinc-400 text-zinc-700
              `}
              onClick={goBackToLeftNavBar}
            >
              <EscapeDirectoryIcon class={`aspect-square w-7 h-7 -rotate-90`} />
            </div>
            <span class="flex font-SpaceGrotesk font-medium text-md text-zinc-900">
              {currentWindow()}
            </span>
          </div>
        </div>
        <FileExplorerWindow
          context={fileExplorerWindowContext}
          visible={currentWindow() == WindowType.Filesystem}
          userFilesystem={props.userFilesystem}
          webSocketSyncManager={wsSyncManager}
          leftSideNavBarRef={leftSideNavBarRef}
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
          username={props.username}
          userSettings={userSettings}
          userSettingsUpdateCallback={userSettingsUpdateCallback}
          visible={currentWindow() == WindowType.Settings}
        />
      </div>
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

      // Update storage quota
      pageProps.userFilesystem.setStorageQuota(sessionInfoJson.storageQuota);

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
