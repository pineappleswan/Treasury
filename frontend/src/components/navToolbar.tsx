import { createEffect, createSignal } from "solid-js";
import { UserFilesystem } from "../client/userFilesystem";
import { isRootDirectory } from "../utility/commonUtils";
import CONSTANTS from "../client/constants";

// Icons
import EscapeDirectoryIcon from "../assets/icons/svg/escape-directory-arrow.svg?component-solid";

type NavToolbarUpdateFunction = (newDirectoryHandle: string) => void;
type NavToolbarNavigateCallback = (newDirectoryHandle: string) => boolean; // Return true, if navigation succeeded

type NavToolbarContext = {
  // Called to update the nav toolbar with any new directory handles the user browsed to
  update?: NavToolbarUpdateFunction;
}

type NavToolbarProps = {
  context: NavToolbarContext;
  userFilesystem: UserFilesystem;

  // Called by the navigation toolbar component when the user interacts with it
  navigateCallback: NavToolbarNavigateCallback;
}

function NavToolbar(props: NavToolbarProps) {
  const { context, userFilesystem, navigateCallback } = props;

  // An array of handles to directories that the user has visited
  const history: string[] = [ CONSTANTS.ROOT_DIRECTORY_HANDLE ];
  const [ navIndex, setNavIndex ] = createSignal<number>(0);
  const [ parentHandle, setParentHandle ] = createSignal<string | null>(null);

  const [ canGoBack, setCanGoBack ] = createSignal(false);
  const [ canGoForward, setCanGoForward ] = createSignal(false);
  const [ canEscapeDirectory, setCanEscapeDirectory ] = createSignal(false);

  let ignoreNextHistoryUpdate = false;

  context.update = (newDirectoryHandle: string) => {
    if (ignoreNextHistoryUpdate == false) {
      // If not ignore next history update, then this was navigated to by the user without using the navigation toolbar
      history.splice(navIndex() + 1);
      history.push(newDirectoryHandle);
      setNavIndex(history.length - 1);
    }

    ignoreNextHistoryUpdate = false;

    if (isRootDirectory(newDirectoryHandle)) {
      setParentHandle(null);
      return;
    }

    const currentDirEntry = userFilesystem.getFileEntryFromHandle(newDirectoryHandle);

    if (currentDirEntry == null) {
      console.error("currentDirEntry is null!");
      return;
    }

    /*
    xhr abort PLEASE do the image viewing cancel thing you know AND with the big videos unoptimised!
    progress bar unoptimised! :)
    */
    
    setParentHandle(currentDirEntry.parentHandle);
  }

  const goBackward = () => {
    if (navIndex() > 0) {
      ignoreNextHistoryUpdate = true;
      
      setNavIndex(navIndex() - 1);
      navigateCallback(history[navIndex()]);
    }
  }

  const goForward = () => {
    if (navIndex() < history.length - 1) {
      ignoreNextHistoryUpdate = true;
      
      setNavIndex(navIndex() + 1);
      navigateCallback(history[navIndex()]);
    }
  }

  const escapeDirectory = () => {
    if (!canEscapeDirectory())
      return;
    
    if (parentHandle() == null) {
      console.error("Tried escaping directory when parent handle is null!");
      return;
    }

    navigateCallback(parentHandle()!);
  }
  
  createEffect(() => {
    setCanGoBack(navIndex() > 0);
    setCanGoForward(navIndex() < history.length - 1);
    setCanEscapeDirectory(parentHandle() != null);
  });

  return (
    <div class="flex flex-row">
      <div
        class={`
                rounded-md w-6 h-6 mr-1.5
                ${canGoBack() ? `hover:bg-zinc-300 hover:cursor-pointer active:bg-zinc-400 text-zinc-700` : `text-zinc-400`}
              `}
        onClick={goBackward}
      >
        <EscapeDirectoryIcon class={`aspect-square w-6 h-6 -rotate-90`} />    
      </div>
      <div
        class={`
                rounded-md w-6 h-6 mr-1.5
                ${canGoForward() ? `hover:bg-zinc-300 hover:cursor-pointer active:bg-zinc-400 text-zinc-700` : `text-zinc-400`}
              `}
        onClick={goForward}
      >
        <EscapeDirectoryIcon class={`aspect-square w-6 h-6 rotate-90`} />    
      </div>
      <div
        class={`
                rounded-md w-6 h-6 mr-1.5
                ${canEscapeDirectory() ? `hover:bg-zinc-300 hover:cursor-pointer active:bg-zinc-400 text-zinc-700` : `text-zinc-400`}
              `}
        onClick={escapeDirectory}
      >
        <EscapeDirectoryIcon class={`aspect-square w-6 h-6`} />    
      </div>
    </div>
  )
}

export type {
  NavToolbarUpdateFunction,
  NavToolbarNavigateCallback,
  NavToolbarContext,
  NavToolbarProps
}

export {
  NavToolbar
}
