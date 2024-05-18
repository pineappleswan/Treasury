import { createSignal } from "solid-js";
import { Vector2D } from "../client/clientEnumsAndTypes";

type DragContextTipContext = {
	setVisible?: (visible: boolean) => void;
	setPosition?: (position: Vector2D) => void;
	setTipText?: (text: string) => void;
	getSize?: () => Vector2D;
};

type DragContextTipProps = {
	context: DragContextTipContext;
};

const DragContextTip = (props: DragContextTipProps) => {
	const [ isVisible, setVisible ] = createSignal(false);
	const [ position, setPosition ] = createSignal<Vector2D>({ x: 0, y: 0 });
	const [ tipText, setTipText ] = createSignal("");
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
		if (!htmlElement) {
			return { x: 0, y: 0 };
		}

		return { x: htmlElement.clientWidth, y: htmlElement.clientHeight }
	};

	return (
		<div
			ref={htmlElement}
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
	DragContextTipContext,
	DragContextTipProps
}

export {
	DragContextTip
}
