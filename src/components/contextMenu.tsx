import { randomBytes } from "crypto";
import { createSignal, onCleanup } from "solid-js";
import { generateSecureRandomAlphaNumericString } from "../common/commonCrypto";

type Vector2D = {
	x: number,
	y: number
}

type ContextMenuFunctions = {
	setVisible?: (visible: boolean) => void,
	setPosition?: (position: Vector2D) => void,
	getPosition?: () => Vector2D,
	getSize?: () => Vector2D,
};

type ContextMenuSettings = {
	settings: ContextMenuFunctions,
	actionCallback: (action: string) => void
};

function ContextMenu(props: ContextMenuSettings) {
	// Create unique id for the context menu (prevents conflicts)
	const menuId = `context-menu-${generateSecureRandomAlphaNumericString(4)}`;

	const settings = props.settings;
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
		const menuElement = document.getElementById(menuId);

		if (!menuElement) {
			console.error(`Couldn't find context menu element with id: ${menuId}`);
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

	// Check if mouse clicked outside of menu
	const handleGlobalClick = (event: MouseEvent) => {
		const menuElement = document.getElementById(menuId);

		if (!menuElement) {
			console.error(`Couldn't find context menu element with id: ${menuId}`);
			return;
		}

		const size: Vector2D = {
			x: menuElement.clientWidth,
			y: menuElement.clientHeight
		};
		
		const pos = menuPosition();

		if (event.clientX < pos.x || event.clientX > pos.x + size.x || event.clientY < pos.y || event.clientY > pos.y + size.y) {
			setMenuVisible(false);
		}
	}

	// Add event listener
	document.addEventListener("click", handleGlobalClick);

	// Cleanup
	onCleanup(() => {
		document.removeEventListener("click", handleGlobalClick);
	});

	return (
		<div
			id={menuId}
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
	ContextMenuFunctions,
	Vector2D
}

export {
	ContextMenu
}
