import { createSignal } from "solid-js";
import { Vector2D } from "../utility/vectors";

type ContextMenuSettings = {
	// Values
	fileHandle?: string,
	fileName?: string,
	fileChunkCount?: number,
	fileEntryHtmlId?: string,
	
	// Functions
	setVisible?: (visible: boolean) => void,
	setPosition?: (position: Vector2D) => void,
	getPosition?: () => Vector2D,
	getSize?: () => Vector2D,
};

type ContextMenuProps = {
	settings: ContextMenuSettings,
	htmlElementId: string,
	actionCallback: (action: string) => void
};

function ContextMenu(props: ContextMenuProps) {
	const { settings, htmlElementId } = props;
	const [ menuVisible, setMenuVisible ] = createSignal(false);
	const [ menuPosition, setMenuPosition ] = createSignal<Vector2D>({ x: 0, y: 0 });

	settings.setVisible = (visible: boolean) => {
		setMenuVisible(visible);
	};

	settings.setPosition = (position: Vector2D) => {
		setMenuPosition(position);
	};

	settings.getPosition = () => {
		return menuPosition();
	};

	settings.getSize = () => {
		const menuElement = document.getElementById(htmlElementId);

		if (!menuElement) {
			console.error(`Couldn't find context menu element with id: ${htmlElementId}`);
			return { x: 0, y: 0 };
		}

		return {
			x: menuElement.clientWidth,
			y: menuElement.clientHeight
		};
	};

	enum MenuEntryRoundingMode {
		None,
		Both,
		Top,
		Bottom
	};

	type MenuButtonProps = {
		actionName: string,
		text: string,
		bolded?: boolean,
		roundingMode: MenuEntryRoundingMode
	};

	const getRoundingModeStyle = (roundingMode: MenuEntryRoundingMode) => {
		switch (roundingMode) {
			case MenuEntryRoundingMode.None   : return "";
			case MenuEntryRoundingMode.Both   : return "rounded-md";
			case MenuEntryRoundingMode.Top    : return "rounded-t-md";
			case MenuEntryRoundingMode.Bottom : return "rounded-b-md";
			default: return "";
		};
	};

	const MenuButton = (menuProps: MenuButtonProps) => {
		const handleClick = () => {
			props.actionCallback(menuProps.actionName); // Call action callback with the action name
			setMenuVisible(false);
		};

		return (
			<div
				class={`
					flex items-center h-[26px]
					${getRoundingModeStyle(menuProps.roundingMode)}
					hover:bg-zinc-200 active:bg-zinc-300
					hover:cursor-pointer
				`}
				onClick={handleClick}
			>
				<h1
					class={`
						ml-2 font-SpaceGrotesk text-sm select-none
						${menuProps.bolded ? "font-medium" : "font-normal"}
					`}
				>
					{menuProps.text}
				</h1>
			</div>
		);
	}

	return (
		<div
			id={htmlElementId}
			onContextMenu={(event) => { event.preventDefault(); }} // Disable default context menu on context menu buttons
			class="absolute flex flex-col w-40 bg-zinc-100 border-zinc-400 border-[1px] rounded-md drop-shadow-[0px_2px_4px_rgba(0,0,0,0.2)] z-10"
			style={`left: ${menuPosition().x}px; top: ${menuPosition().y}px; ${!menuVisible() && "visibility: hidden;"}`}
		>
			<MenuButton actionName="open" text="Open" bolded roundingMode={MenuEntryRoundingMode.Top} />
			<MenuButton actionName="rename" text="Rename" roundingMode={MenuEntryRoundingMode.None} />
			<MenuButton actionName="download" text="Download" roundingMode={MenuEntryRoundingMode.Bottom} />
		</div>
	);
}

export type {
	ContextMenuSettings,
	ContextMenuProps,
	Vector2D
}

export {
	ContextMenu
}
