import { createSignal } from "solid-js";
import { Vector2D } from "../utility/vectors";

type DragContextTipSettings = {
	setVisible?: (visible: boolean) => void,
	setPosition?: (position: Vector2D) => void,
	setTipText?: (text: string) => void,
};

type DragContextTipProps = {
	settings: DragContextTipSettings,
};

const DragContextTip = (props: DragContextTipProps) => {
	const settings = props.settings;
	const [ isVisible, setVisible ] = createSignal(false);
	const [ position, setPosition ] = createSignal<Vector2D>({ x: 0, y: 0 });
  const [ tipText, setTipText ] = createSignal("");

  // Add an offset to the drag position because the mouse takes up room and can block the view of the tip
  const dragTipOffset: Vector2D = { x: 20, y: 0 };

  // Set settings functions
  settings.setVisible = (state: boolean) => setVisible(state);
  
  settings.setPosition = (pos: Vector2D) => {
    setPosition({
      x: pos.x + dragTipOffset.x,
      y: pos.y + dragTipOffset.y
    });
  };
  
  settings.setTipText = (text: string) => setTipText(text);

	return (
		<div
			class="absolute flex max-w-[300px] h-6 bg-zinc-100 border-zinc-400 border-[1px] rounded-md drop-shadow-[0px_2px_4px_rgba(0,0,0,0.2)] z-10"
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
