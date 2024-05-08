import { createSignal, For } from "solid-js";
import { Vector2D } from "../client/vectors";
import { FilesystemEntry } from "./fileExplorer";
import CONSTANTS from "../common/constants";

enum ContextMenuWidgetRoundingMode {
	None,
	Both,
	Top,
	Bottom
};

enum ContextMenuWidgetMode {
	Normal,
	Bolded,
	Disabled // When disabled, the entry text appears fainted and the user can't click it
};

type ContextMenuWidgetProps = {
	widgetInfo: ContextMenuWidgetInfo;
};

type ContextMenuWidgetInfo = {
	actionName: string;
	text: string;
	tipText: string;
	mode: ContextMenuWidgetMode;
	roundingMode: ContextMenuWidgetRoundingMode;
};

type ContextMenuContext = {
	fileEntries: FilesystemEntry[];

	// Functions
	show?: (directoryHandle: string) => void;
	hide?: () => void;
	setPosition?: (position: Vector2D) => void;
	getPosition?: () => Vector2D;
	getSize?: () => Vector2D;
	getHtmlElement?: () => HTMLDivElement | undefined;
	isVisible?: () => boolean;

	clearMenuWidgets?: () => void;
	appendMenuWidget?: (actionName: string, text: string, tipText: string, mode: ContextMenuWidgetMode) => void;
};

type ContextMenuProps = {
	context: ContextMenuContext;
	actionCallback: (action: string, directoryHandle: string) => void;
};

function ContextMenu(props: ContextMenuProps) {
	const { context } = props;
	const [ menuVisible, setMenuVisible ] = createSignal(false);
	const [ menuPosition, setMenuPosition ] = createSignal<Vector2D>({ x: 0, y: 0 });
	const [ menuEntries, setMenuEntries ] = createSignal<ContextMenuWidgetInfo[]>([]);
	let openedParentDirectory: string = CONSTANTS.ROOT_DIRECTORY_HANDLE;

	let menuHtmlElement: HTMLDivElement | undefined;

	context.show = (directoryHandle: string) => {
		setMenuVisible(true);
		openedParentDirectory = directoryHandle;
	};

	context.hide = () => {
		setMenuVisible(false);
	}

	context.setPosition = (position: Vector2D) => {
		setMenuPosition(position);
	}

	context.getPosition = () => {
		return menuPosition();
	}

	context.getSize = () => {
		if (!menuHtmlElement) {
			console.error(`Context menu html element is undefined!`);
			return { x: 0, y: 0 };
		}
		
		return {
			x: menuHtmlElement.clientWidth,
			y: menuHtmlElement.clientHeight
		};
	}

	context.getHtmlElement = () => {
		return menuHtmlElement;
	}

	context.isVisible = () => {
		return menuVisible();
	}

	context.clearMenuWidgets = () => {
		setMenuEntries([]);
	}

	context.appendMenuWidget = (actionName: string, text: string, tipText: string, mode: ContextMenuWidgetMode) => {
		const newEntry: ContextMenuWidgetInfo = {
			actionName: actionName,
			text: text,
			tipText: tipText,
			mode: mode,
			roundingMode: ContextMenuWidgetRoundingMode.None
		}

		const newEntries = [...menuEntries(), newEntry];
		setMenuEntries([]); // This is needed or else there is an issue where all entries below the first one will have a rounding mode equivalent to Bottom

		// Update rounding modes
		if (newEntries.length == 1) {
			newEntries[0].roundingMode = ContextMenuWidgetRoundingMode.Both;
		} else {
			newEntries.forEach((entry, index) => {
				if (index == 0) {
					entry.roundingMode = ContextMenuWidgetRoundingMode.Top;
				} else if (index == newEntries.length - 1) {
					entry.roundingMode = ContextMenuWidgetRoundingMode.Bottom;
				} else {
					entry.roundingMode = ContextMenuWidgetRoundingMode.None;
				}
			});
		}

		setMenuEntries(newEntries);
	};

	const getRoundingModeStyle = (roundingMode: ContextMenuWidgetRoundingMode) => {
		switch (roundingMode) {
			case ContextMenuWidgetRoundingMode.None   : return "";
			case ContextMenuWidgetRoundingMode.Both   : return "rounded-md";
			case ContextMenuWidgetRoundingMode.Top    : return "rounded-t-md";
			case ContextMenuWidgetRoundingMode.Bottom : return "rounded-b-md";
			default: return "";
		};
	};

	const MenuWidget = (menuProps: ContextMenuWidgetProps) => {
		const { widgetInfo } = menuProps;

		const handleClick = () => {
			if (widgetInfo.mode == ContextMenuWidgetMode.Disabled)
				return;

			props.actionCallback(widgetInfo.actionName, openedParentDirectory); // Call action callback
			setMenuVisible(false);
		}

		const handleTouchStart = (event: TouchEvent) => {
			event.stopImmediatePropagation();
		}

		return (
			<div
				class={`
					flex justify-between items-center h-[26px]
					${getRoundingModeStyle(widgetInfo.roundingMode)}
					${widgetInfo.mode != ContextMenuWidgetMode.Disabled && "hover:bg-zinc-200 active:bg-zinc-300 hover:cursor-pointer"}
				`}
				onClick={handleClick}
				onTouchStart={handleTouchStart}
			>
				<span
					class={`
						ml-2 font-SpaceGrotesk text-sm select-none
						${widgetInfo.mode == ContextMenuWidgetMode.Disabled ? "text-zinc-400" : "text-zinc-950"}
						${widgetInfo.mode == ContextMenuWidgetMode.Bolded ? "font-medium" : "font-normal"}
					`}
				>{widgetInfo.text}</span>
				<span class="mr-2 font-SpaceGrotesk text-xs text-zinc-500 select-none">{widgetInfo.tipText}</span>
			</div>
		);
	}

	// TODO: enums for actions???

	return (
		<div
			ref={menuHtmlElement}
			onContextMenu={(event) => { event.preventDefault(); }} // Disable default context menu on context menu buttons
			class="absolute flex flex-col w-40 bg-zinc-100 border-zinc-400 border-[1px] rounded-md drop-shadow-[0px_2px_4px_rgba(0,0,0,0.2)] z-10"
			style={`left: ${menuPosition().x}px; top: ${menuPosition().y}px; ${!menuVisible() && "visibility: hidden;"}`}
		>
			<For each={menuEntries()}>
				{(entryInfo) => (
					<MenuWidget widgetInfo={entryInfo} />
				)}
			</For>
		</div>
	);
}

export type {
	ContextMenuContext,
	ContextMenuProps,
	Vector2D
}

export {
	ContextMenuWidgetMode,
	ContextMenu
}
