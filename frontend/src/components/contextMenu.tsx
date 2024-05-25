import { createSignal, For } from "solid-js";
import { Vector2D } from "../client/clientEnumsAndTypes";
import { FileCategory, FilesystemEntry } from "./fileExplorer";
import { canMediaViewerOpenFile } from "./mediaViewerPopup";
import CONSTANTS from "../common/constants";

// An enum containing every type of action in the context menu
enum ContextMenuAction {
	OpenFolder,
	NewFolder,
	Rename,
	Download,
	DownloadAsZip,
	Cut,
	Paste,
	Share,
	ViewImage,
	PlayAudio,
	PlayVideo
};

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

	// Widget management
	clearMenuWidgets?: () => void;
	appendMenuWidget?: (actionId: number, text: string, tipText: string, mode: ContextMenuWidgetMode) => void;

	// Forces the context menu to react to state changes and update the widgets
	react?: () => void;
};

type ContextMenuActionCallback = (actionId: number, directoryHandle: string) => void;
type ContextMenuOnClickCallback = (actionId: number) => void;

type ContextMenuWidgetProps = {
	widgetInfo: ContextMenuWidgetInfo;
	onClick: ContextMenuOnClickCallback;
};

type ContextMenuWidgetInfo = {
	actionId: number;
	text: string;
	tipText: string;
	mode: ContextMenuWidgetMode;
	roundingMode: ContextMenuWidgetRoundingMode;
};

type ContextMenuProps = {
	context: ContextMenuContext;
	actionCallback: ContextMenuActionCallback;
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

const ContextMenuWidget = (menuProps: ContextMenuWidgetProps) => {
	const { widgetInfo, onClick } = menuProps;

	const handleClick = () => {
		if (widgetInfo.mode == ContextMenuWidgetMode.Disabled)
			return;

		onClick(widgetInfo.actionId);
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

function ContextMenu(props: ContextMenuProps) {
	const { context, actionCallback } = props;
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

	context.appendMenuWidget = (actionId: number, text: string, tipText: string, mode: ContextMenuWidgetMode) => {
		const newEntry: ContextMenuWidgetInfo = {
			actionId: actionId,
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

	context.react = () => {
		const entries = context.fileEntries;

		// Clear entries
		context.clearMenuWidgets!();

		if (entries.length == 0) {
			context.appendMenuWidget!(ContextMenuAction.NewFolder, "New folder", "", ContextMenuWidgetMode.Normal);
			context.appendMenuWidget!(ContextMenuAction.Paste, "Paste", "Ctrl+V", ContextMenuWidgetMode.Disabled);
		} else if (entries.length == 1) {
			const entry = entries[0];

			if (canMediaViewerOpenFile!(entry)) {
				if (entry.category == FileCategory.Image) {
					context.appendMenuWidget!(ContextMenuAction.ViewImage, "View", "", ContextMenuWidgetMode.Bolded);
				} else if (entry.category == FileCategory.Audio) {
					context.appendMenuWidget!(ContextMenuAction.PlayAudio, "Play", "", ContextMenuWidgetMode.Bolded);
				} else if (entry.category == FileCategory.Video) {
					context.appendMenuWidget!(ContextMenuAction.PlayVideo, "Play", "", ContextMenuWidgetMode.Bolded);
				}
			}

			if (entry.isFolder) {
				context.appendMenuWidget!(ContextMenuAction.OpenFolder, "Open folder", "", ContextMenuWidgetMode.Bolded);
			}

			context.appendMenuWidget!(ContextMenuAction.Download, "Download", "", ContextMenuWidgetMode.Bolded);
			context.appendMenuWidget!(ContextMenuAction.Rename, "Rename", "F2", ContextMenuWidgetMode.Normal);
			context.appendMenuWidget!(ContextMenuAction.Cut, "Cut", "Ctrl+X", ContextMenuWidgetMode.Normal);
			context.appendMenuWidget!(ContextMenuAction.Share, "Share", "", ContextMenuWidgetMode.Normal);
		} else {
			context.appendMenuWidget!(ContextMenuAction.DownloadAsZip, "Download as zip", "", ContextMenuWidgetMode.Bolded);
			context.appendMenuWidget!(ContextMenuAction.Rename, "Rename", "F2", ContextMenuWidgetMode.Normal);
			context.appendMenuWidget!(ContextMenuAction.Cut, "Cut", "Ctrl+X", ContextMenuWidgetMode.Normal);
			context.appendMenuWidget!(ContextMenuAction.Share, "Share", "", ContextMenuWidgetMode.Normal);
		}
	};

	const onWidgetClick: ContextMenuOnClickCallback = (actionId: number) => {
		actionCallback(actionId, openedParentDirectory);
		setMenuVisible(false);
	};

	return (
		<div
			ref={menuHtmlElement}
			onContextMenu={(event) => { event.preventDefault(); }} // Disable default context menu on context menu buttons
			class="absolute flex flex-col w-40 bg-zinc-100 border-zinc-400 border-[1px] rounded-md drop-shadow-[0px_2px_4px_rgba(0,0,0,0.2)] z-10"
			style={`left: ${menuPosition().x}px; top: ${menuPosition().y}px; ${!menuVisible() && "visibility: hidden;"}`}
		>
			<For each={menuEntries()}>
				{(entryInfo) => (
					<ContextMenuWidget widgetInfo={entryInfo} onClick={onWidgetClick} />
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
	ContextMenuAction,
	ContextMenuWidgetMode,
	ContextMenu
}
