import { createSignal } from "solid-js";
import { Vector2D } from "../utility/vectors";
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";

type DragContextTipSettings = {
	setVisible?: (visible: boolean) => void,
	setPosition?: (position: Vector2D) => void,
	setTipText?: (text: string) => void,
  getSize?: () => Vector2D
};

type DragContextTipProps = {
	settings: DragContextTipSettings,
};

const DragContextTip = (props: DragContextTipProps) => {
  const htmlElementId = `drag-context-tip-${generateSecureRandomAlphaNumericString(8)}`;
	const [ isVisible, setVisible ] = createSignal(false);
	const [ position, setPosition ] = createSignal<Vector2D>({ x: 0, y: 0 });
  const [ tipText, setTipText ] = createSignal("");

  // Set settings functions
  props.settings.setVisible = (state: boolean) => setVisible(state);
  
  props.settings.setPosition = (pos: Vector2D) => {
    setPosition({
      x: pos.x,
      y: pos.y
    });
  };
  
  props.settings.setTipText = (text: string) => setTipText(text);

  props.settings.getSize = () => {
    const element = document.getElementById(htmlElementId);

    if (!element) {
      return { x: 0, y: 0 };
    }

    return { x: element.clientWidth, y: element.clientHeight }
  };

	return (
		<div
      id={htmlElementId}
			class="absolute flex max-w-[300px] h-6 bg-zinc-100 border-zinc-400 border-[1px] rounded-md drop-shadow-[0px_2px_4px_rgba(0,0,0,0.2)] z-10 select-none"
      style={`
        left: ${position().x}px; top: ${position().y}px;
        ${!isVisible() && "display: none;"}
      `}
		>
      <span
        class="font-SpaceGrotesk text-sm px-2 whitespace-nowrap overflow-hidden text-ellipsis"
      >
        {tipText()}
      </span>
		</div>
	)
}

export type {
  DragContextTipSettings,
  DragContextTipProps
}

export {
  DragContextTip
}
