import { createSignal } from "solid-js";
import { Vector2D } from "../client/vector";
import BackIcon from "../assets/icons/svg/back.svg?component-solid";

type DragToolTipContext = {
  setVisible?: (visible: boolean) => void;
  setPosition?: (position: Vector2D) => void;
  setTipText?: (text: string) => void;
  getSize?: () => Vector2D;
  setDropIconEnabled?: (enabled: boolean) => void;
};

type DragToolTipProps = {
  context: DragToolTipContext;
};

const DragToolTip = (props: DragToolTipProps) => {
  const [ isVisible, setVisible ] = createSignal(false);
  const [ position, setPosition ] = createSignal<Vector2D>(Vector2D.zero);
  const [ tipText, setTipText ] = createSignal<string>("");
  const [ dropIconEnabled, setDropIconEnabled ] = createSignal<boolean>(false);
  let htmlElement: HTMLDivElement | undefined;

  // Set settings functions
  props.context.setVisible = (state: boolean) => setVisible(state);
  
  props.context.setPosition = (pos: Vector2D) => {
    setPosition({
      x: pos.x,
      y: pos.y
    });
  };
  
  props.context.setTipText = (text: string) => setTipText(text);

  props.context.getSize = () => {
    if (!htmlElement)
      return Vector2D.zero;

    return { x: htmlElement.clientWidth, y: htmlElement.clientHeight }
  };

  props.context.setDropIconEnabled = (enabled: boolean) => setDropIconEnabled(enabled);

  return (
    <div
      ref={htmlElement}
      class="absolute z-10"
      style={`
        left: ${position().x}px; top: ${position().y}px;
        ${!isVisible() && "display: none;"}
      `}
    >
      <div
        class="
          flex flex-col max-w-[300px] h-6 select-none absolute
          bg-zinc-100 border-zinc-400 border-[1px] rounded-md drop-shadow-[0px_2px_4px_rgba(0,0,0,0.2)]
          left-[25px]
        "
      >
        <span
          class="font-SpaceGrotesk text-sm px-2 whitespace-nowrap overflow-hidden text-ellipsis"
        >
          {tipText()}
        </span>
      </div>
      <BackIcon
        class={`
          absolute
          w-5 h-5 shrink-0 text-blue-800 mt-[-8px] ml-[5px]
          ${dropIconEnabled() ? "" : "hidden"}
        `}
      />
    </div>
  )
}

export type {
  DragToolTipContext,
  DragToolTipProps
}

export {
  DragToolTip
}
