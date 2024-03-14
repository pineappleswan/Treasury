import { createSignal } from "solid-js";
import { Vector2D } from "../utility/vectors";
import { FilesystemEntry } from "./fileExplorer";

type ContextMenuFileEntry = {
	fileEntry: FilesystemEntry,
	//entryHtmlId: string // TODO: if never used, then rid of this,
};

type ContextMenuSettings = {
	fileEntries: ContextMenuFileEntry[],

	// Functions
	setVisible?: (visible: boolean) => void,
	setPosition?: (position: Vector2D) => void,
	getPosition?: () => Vector2D,
	getSize?: () => Vector2D,
};

type ContextMenuProps = {
	settings: ContextMenuSettings,
	htmlId: string,
	actionCallback: (action: string, fileEntries: ContextMenuFileEntry[]) => void
};

enum ContextMenuEntryRoundingMode {
	None,
	Both,
	Top,
	Bottom
};

type ContextMenuEntryProps = {
	actionName: string,
	text: string,
	bolded?: boolean,
	roundingMode: ContextMenuEntryRoundingMode
};

function ContextMenu(props: ContextMenuProps) {
	const { settings, htmlId } = props;
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
			props.actionCallback(menuProps.actionName, props.settings.fileEntries); // Call action callback with the action name
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

	// TODO: enums for actions???

	return (
		<div
			id={htmlId}
			onContextMenu={(event) => { event.preventDefault(); }} // Disable default context menu on context menu buttons
			class="absolute flex flex-col w-40 bg-zinc-100 border-zinc-400 border-[1px] rounded-md drop-shadow-[0px_2px_4px_rgba(0,0,0,0.2)] z-10"
			style={`left: ${menuPosition().x}px; top: ${menuPosition().y}px; ${!menuVisible() && "visibility: hidden;"}`}
		>
			<MenuButton actionName="open" text="Open" bolded roundingMode={ContextMenuEntryRoundingMode.Top} />
			<MenuButton actionName="rename" text="Rename" roundingMode={ContextMenuEntryRoundingMode.None} />
			<MenuButton actionName="download" text="Download" roundingMode={ContextMenuEntryRoundingMode.None} />
			<MenuButton actionName="shareLink" text="Share link" roundingMode={ContextMenuEntryRoundingMode.None} />
			<MenuButton actionName="shareLinkAsQrCode" text="Share link as QR code" roundingMode={ContextMenuEntryRoundingMode.Bottom} />
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
	ContextMenu
}
