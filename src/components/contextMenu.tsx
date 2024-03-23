import { createSignal, For } from "solid-js";
import { Vector2D } from "../utility/vectors";
import { FilesystemEntry } from "./fileExplorer";

enum ContextMenuEntryRoundingMode {
	None,
	Both,
	Top,
	Bottom
};

enum ContextMenuEntryMode {
	Normal,
	Bolded,
	Disabled // When disabled, the entry text appears fainted and the user can't click it
};

type ContextMenuFileEntry = {
	fileEntry: FilesystemEntry,
};

type ContextMenuEntryProps = {
	actionName: string,
	text: string,
	mode: ContextMenuEntryMode,
	roundingMode: ContextMenuEntryRoundingMode
};

type ContextMenuEntryInfo = {
	actionName: string,
	text: string,
	mode: ContextMenuEntryMode,
	roundingMode: ContextMenuEntryRoundingMode
};

type ContextMenuSettings = {
	fileEntries: ContextMenuFileEntry[],

	// Functions
	setVisible?: (visible: boolean) => void,
	setPosition?: (position: Vector2D) => void,
	getPosition?: () => Vector2D,
	getSize?: () => Vector2D,

	clearMenuEntries?: () => void,
	appendMenuEntry?: (actionName: string, text: string, mode: ContextMenuEntryMode) => void
};

type ContextMenuProps = {
	settings: ContextMenuSettings,
	htmlId: string,
	actionCallback: (action: string) => void
};

function ContextMenu(props: ContextMenuProps) {
	const { settings, htmlId } = props;
	const [ menuVisible, setMenuVisible ] = createSignal(false);
	const [ menuPosition, setMenuPosition ] = createSignal<Vector2D>({ x: 0, y: 0 });
	const [ menuEntries, setMenuEntries ] = createSignal<ContextMenuEntryInfo[]>([]);

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
		const menuElement = document.getElementById(htmlId);

		if (!menuElement) {
			console.error(`Couldn't find context menu element with id: ${htmlId}`);
			return { x: 0, y: 0 };
		}

		return {
			x: menuElement.clientWidth,
			y: menuElement.clientHeight
		};
	};

	settings.clearMenuEntries = () => {
		setMenuEntries([]);
	};

	settings.appendMenuEntry = (actionName: string, text: string, mode: ContextMenuEntryMode) => {
		const newEntry: ContextMenuEntryInfo = {
			actionName: actionName,
			text: text,
			mode: mode,
			roundingMode: ContextMenuEntryRoundingMode.None
		}

		const newEntries = [...menuEntries(), newEntry];
		
		// Update rounding modes
		newEntries.forEach((entry, index) => {
			if (index == 0) {
				entry.roundingMode = ContextMenuEntryRoundingMode.Top;
			} else if (index == newEntries.length - 1) {
				entry.roundingMode = ContextMenuEntryRoundingMode.Bottom;
			} else {
				entry.roundingMode = ContextMenuEntryRoundingMode.None;
			}
		});

		setMenuEntries(newEntries);
	};

	const getRoundingModeStyle = (roundingMode: ContextMenuEntryRoundingMode) => {
		switch (roundingMode) {
			case ContextMenuEntryRoundingMode.None   : return "";
			case ContextMenuEntryRoundingMode.Both   : return "rounded-md";
			case ContextMenuEntryRoundingMode.Top    : return "rounded-t-md";
			case ContextMenuEntryRoundingMode.Bottom : return "rounded-b-md";
			default: return "";
		};
	};

	const MenuButton = (menuProps: ContextMenuEntryProps) => {
		const handleClick = () => {
			if (menuProps.mode == ContextMenuEntryMode.Disabled)
				return;

			props.actionCallback(menuProps.actionName); // Call action callback
			setMenuVisible(false);
		};

		return (
			<div
				class={`
					flex items-center h-[26px]
					${getRoundingModeStyle(menuProps.roundingMode)}
					${menuProps.mode != ContextMenuEntryMode.Disabled && "hover:bg-zinc-200 active:bg-zinc-300 hover:cursor-pointer"}
				`}
				onClick={handleClick}
			>
				<h1
					class={`
						ml-2 font-SpaceGrotesk text-sm select-none
						${menuProps.mode == ContextMenuEntryMode.Disabled ? "text-zinc-400" : "text-zinc-950"}
						${menuProps.mode == ContextMenuEntryMode.Bolded ? "font-medium" : "font-normal"}
					`}
				>
					{menuProps.text}
				</h1>
			</div>
		);
	}

	// TODO: enums for actions???

	return (
		<div
			id={htmlId}
			onContextMenu={(event) => { event.preventDefault(); }} // Disable default context menu on context menu buttons
			class="absolute flex flex-col w-40 bg-zinc-100 border-zinc-400 border-[1px] rounded-md drop-shadow-[0px_2px_4px_rgba(0,0,0,0.2)] z-10"
			style={`left: ${menuPosition().x}px; top: ${menuPosition().y}px; ${!menuVisible() && "visibility: hidden;"}`}
		>
			<For each={menuEntries()}>
				{(entryInfo) => (
					<MenuButton {...entryInfo}/>
				)}
			</For>
		</div>
	);
}

export type {
	ContextMenuFileEntry,
	ContextMenuSettings,
	ContextMenuProps,
	Vector2D
}

export {
	ContextMenuEntryMode,
	ContextMenu
}
