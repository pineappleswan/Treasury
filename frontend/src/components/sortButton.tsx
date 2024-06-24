import { createSignal, Accessor } from "solid-js";
import { FileExplorerFilterSettings } from "./fileExplorer";
import RightAngleArrowIcon from "../assets/icons/svg/right-angle-arrow.svg?component-solid";

type SortButtonOnClickCallbackData = {
  sortMode: any;
  sortAscending: boolean;
};

type SortButtonProps = {
  sortMode: any;
  sortAscending: boolean;

  // These are accessor types so that solidjs will re-render the sort button components when these values change
  globalFilterSettingsGetter: Accessor<FileExplorerFilterSettings>;

  // Callbacks
  onClick: (data: SortButtonOnClickCallbackData) => void; // Will be called when the user clicks on the sort button
};

const SortButton = (props: SortButtonProps) => {
  const { globalFilterSettingsGetter } = props;
  let sortAscending = props.sortAscending;

  //const [ sortAscending, setSortAscending ] = createSignal(props.sortAscending);
  const [ rotation, setRotation ] = createSignal(sortAscending ? 0 : 180);

  // Signal to force the button to be visible even if the current sort mode doesn't correspond to this sort button
  const [ forceVisible, setForceVisible ] = createSignal(false);

  return (
    <RightAngleArrowIcon
      style={`opacity: ${(forceVisible() || globalFilterSettingsGetter().sortMode == props.sortMode) ? 100 : 0}%`}
      class={`aspect-square w-5 h-5 ml-1 rounded-full hover:cursor-pointer hover:bg-zinc-300 rotate-${rotation()}`}
      onClick={() => {
        // Flip sort ascending only when the current global sort mode is the same as the button's sort mode
        if (globalFilterSettingsGetter().sortMode == props.sortMode) {
          sortAscending = !sortAscending;
        }
        
        // Update rotation
        setRotation(sortAscending ? 0 : 180);
        
        // Call onClick callback
        props.onClick({
          sortMode: props.sortMode,
          sortAscending: sortAscending
        });
      }}

      // Make button visible when hovering over it while it's invisible by default (if its not of the current sort type)
      onmouseenter={() => setForceVisible(true) }
      onmouseleave={() => setForceVisible(false) }
    />
  );
};

export type {
  SortButtonOnClickCallbackData
}

export {
  SortButton
}
