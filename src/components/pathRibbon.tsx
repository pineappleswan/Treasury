import { For, createSignal } from "solid-js";
import { UserFilesystem } from "../client/userFilesystem";
import { isHandleTheRootDirectory } from "../common/commonUtils";
import CONSTANTS from "../common/constants";
import FileFolderIcon from "../assets/icons/svg/files/file-folder.svg?component-solid";
import RightAngleArrowIcon from "../assets/icons/svg/right-angle-arrow.svg?component-solid";

type PathRibbonContext = {
	setPath?: (newDirectoryHandle: string) => void;
	getPath?: () => string;
}

type PathRibbonSetPathCallback = (newDirectoryHandle: string) => void;

type PathRibbonProps = {
	context: PathRibbonContext;
	userFilesystem: UserFilesystem;
	setPathCallback: PathRibbonSetPathCallback; // When the user sets the path via the path ribbon, this will get called
}

type PathSegment = {
	handle: string;
	text: string;
	isRoot: boolean,
	isTail: boolean
}

type PathSegmentProps = {
	parentRibbonProps: PathRibbonProps;
	segment: PathSegment;
}

function PathRibbonSegment(props: PathSegmentProps) {
	const { parentRibbonProps, segment } = props;

	return (
		<div 
			class={`flex flex-row items-center px-1 h-6 rounded-md
						hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300`}
			onClick={(event) => {
				event.stopPropagation();
				parentRibbonProps.setPathCallback(segment.handle);
			}}
		>
			{segment.isRoot ? (
				<FileFolderIcon class="w-6 h-6" />
			) : (
				<span class="font-SpaceGrotesk text-sm select-none whitespace-nowrap">{segment.text}</span>
			)}
			{!segment.isTail && (
				<RightAngleArrowIcon class="w-5 h-5 rotate-90 ml-0.5 mr-[-6px]" />
			)}
		</div>
	)
}

function PathRibbon(props: PathRibbonProps) {
	const { userFilesystem } = props;
	const [ pathSegments, setPathSegments ] = createSignal<PathSegment[]>([]);
	
	const setPath = (newDirectoryHandle: string) => {
		// Recursively build path
		const pathHandles: string[] = [];
		let currentDirectoryHandle = newDirectoryHandle;

		while (true) {
			if (isHandleTheRootDirectory(currentDirectoryHandle)) {
				break;
			}

			const directoryEntry = userFilesystem.getFileEntryFromHandle(currentDirectoryHandle);

			if (!directoryEntry) {
				console.error("currentDirectoryHandle points to nothing!");
				return;
			} else if (!directoryEntry.isFolder) {
				console.error("currentDirectoryHandle points to a file and not a folder!");
				return;
			}

			pathHandles.push(currentDirectoryHandle);
			currentDirectoryHandle = directoryEntry.parentHandle;
		}

		// Add root directory
		pathHandles.push(CONSTANTS.ROOT_DIRECTORY_HANDLE);

		// Reverse so the root directory comes first
		pathHandles.reverse();

		const rootSegment: PathSegment = { handle: CONSTANTS.ROOT_DIRECTORY_HANDLE, text: "root", isRoot: true, isTail: pathHandles.length == 1 };
		const segments: PathSegment[] = [ rootSegment ];

		for (let i = 0; i < pathHandles.length; i++) {
			const handle = pathHandles[i];

			if (handle.length == 0)
				return;

			if (isHandleTheRootDirectory(handle))
				continue;

			const directoryEntry = userFilesystem.getFileEntryFromHandle(handle);
			const isTail = i == pathHandles.length - 1;

			if (directoryEntry == null) {
				console.error(`Path ribbon path contains directory handle that doesn't exist! Handle: ${handle}`);

				// Error segment that redirects the user to the root directory. ".text" contains forward slashes which are banned so user knows something is wrong.
				segments.push({ handle: CONSTANTS.ROOT_DIRECTORY_HANDLE, text: "/ERROR/", isTail: false, isRoot: false });
			} else {
				segments.push({ handle: handle, text: directoryEntry.name, isTail: isTail, isRoot: false });
			}
		};

		setPathSegments(segments);
	}

	props.context.setPath = setPath;
	setPath(CONSTANTS.ROOT_DIRECTORY_HANDLE);

	return (
		<div
			class="flex flex-row items-center w-full px-2 py-0.5 overflow-x-auto"
			style={`
				scrollbar-width: thin;
			`}
			onClick={() => {
				console.log("the path bar thingy");
			}}
		>
			<For each={pathSegments()}>
				{(segment) => (
					<PathRibbonSegment
						parentRibbonProps={props}
						segment={segment}
					/>
				)}
			</For>
		</div>
	)
}

export type {
	PathRibbonContext,
	PathRibbonSetPathCallback,
	PathRibbonProps
}

export {
	PathRibbon
}
