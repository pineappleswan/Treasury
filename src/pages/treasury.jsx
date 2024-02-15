import { createSignal, createEffect, on } from "solid-js";
import { createStore } from "solid-js/store";
import { LoginButton, LOGIN_BUTTON_STATES,getLoginButtonStyle } from "../components/LoginButton";
import DownloadArrowIcon from "../assets/icons/svg/arrow-download.svg?component-solid";
import UploadArrowIcon from "../assets/icons/svg/arrow-upload.svg?component-solid";
import GearIcon from "../assets/icons/svg/gear.svg?component-solid";
import LogoutIcon from "../assets/icons/svg/logout.svg?component-solid";
import FolderIcon from "../assets/icons/svg/folder.svg?component-solid";
import SharedLinkIcon from "../assets/icons/svg/shared-link.svg?component-solid";
import TrashIcon from "../assets/icons/svg/trash-bin.svg?component-solid";

function Logout() {
	fetch("/api/logout", { method: "POST" })
	.then((response) => {
		if (response.ok) { // When server responds with 200, redirect user to login page
			window.location.pathname = "/login";
		}
	});
}

function TreasuryPage() {
	// This object stores shared values for components in the navbar
	const navbarStore = {
		// Used for transfer speed displays in the navbar (in bytes per second). If values are -1, the speed will not be shown in the navbar.
		totalDownloadSpeed: -1,
		totalUploadSpeed: -1,
		// Stores setters mainly for navbar menu buttons.
		// The use case is mainly to set other menus to be not visibile since only one menu can be selected at once.
		setSelectedSetters: {},
		// Convenience function for automatically calling all setters registered in the above dictionary
		deselectAllMenus: () => {
			Object.entries(navbarStore.setSelectedSetters).forEach(([key, setSelectedFunc]) => {
				setSelectedFunc(false);
			});
		}
	};

	// Returns the formatted text for a number representing transfer speed in bytes/second. e.g 1,000,000 = "1 MB/s"
	function getFormattedBPSText(bps) {
		const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s", "PB/s"];
		let bytesPerSecond = speed;
		let unitIndex = 0;

		while (bytesPerSecond >= 1000 && unitIndex < units.length - 1) {
			bytesPerSecond /= 1000;
			unitIndex++;
		}

		return bytesPerSecond.toFixed(1) + " " + units[unitIndex];
	}

	function UserBar() {
		return (
			<div class="flex flex-row items-center justify-center mt-1.5 w-[100%]"> {/* User bar */}
				<div class="flex items-center py-2 w-[95%] bg-[#f1f1f1] border-solid border-[1px] border-[#dfdfdf] rounded-md">
					<div class="flex rounded-full aspect-square ml-4 mr-3 h-10 bg-slate-400"></div>
					<h1 class="font-SpaceGrotesk font-semibold text- mr-4 text-center text-slate-900 overflow-auto text-wrap break-words">AxelAnderson</h1>
				</div>
			</div>
		);
	}

	function DownloadsMenuEntry() {
		const [ speedText, setSpeedText ] = createSignal("");
		const [ speedTextVisibility, setSpeedTextVisibility ] = createSignal(false);
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.setSelectedSetters.downloads = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
		}

		// Run update loop every 1 second
		setInterval(() => {
			let speed = navbarStore.totalDownloadSpeed;

			if (speed == -1) {
				setSpeedTextVisibility(false);
			} else {
				setSpeedText(getFormattedBPSText(speed));
				setSpeedTextVisibility(true);
			}
		}, 1000);

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 pl-0.5 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-6 border-solid border-2 border-[#11bf22]">
					<DownloadArrowIcon class="aspect-square h-5 rotate-180" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Downloads</h1>
				<div class={`flex items-center justify-center font bg-[#f4f4f4] px-1.5 h-6 mr-1.5 rounded-md border-solid border-[1px] border-[#dfdfdf]
										${speedTextVisibility() == true ? "visible" : "invisible"}`}>
					<h1 class="font-SpaceGrotesk font-medium text-sm text-zinc-600 select-none">{speedText}</h1>
				</div>
			</div>
		);
	}

	function UploadsMenuEntry() {
		const [ speedText, setSpeedText ] = createSignal("");
		const [ speedTextVisibility, setSpeedTextVisibility ] = createSignal(false);
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.setSelectedSetters.uploads = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
		}

		// Run update loop every 1 second
		setInterval(() => {
			let speed = navbarStore.totalUploadSpeed;

			if (speed == -1) {
				setSpeedTextVisibility(false);
			} else {
				setSpeedText(getFormattedBPSText(speed));
				setSpeedTextVisibility(true);
			}
		}, 1000);

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 pl-0.5 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-6 border-solid border-2 border-[#33bbee]">
					<UploadArrowIcon class="aspect-square h-5" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Uploads</h1>
				<div class={`flex items-center justify-center font bg-[#f4f4f4] px-1.5 h-6 mr-1.5 rounded-md border-solid border-[1px] border-[#dfdfdf]
										${speedTextVisibility() == true ? "visible" : "invisible"}`}>
					<h1 class="font-SpaceGrotesk font-medium text-sm text-zinc-600 select-none">{speedText}</h1>
				</div>
			</div>
		);
	}

	function FilesystemMenuEntry() {
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.setSelectedSetters.filesystem = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<FolderIcon class="aspect-square h-[26px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Filesystem</h1>
			</div>
		);
	}

	function SharedLinkEntry() {
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.setSelectedSetters.shared = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<SharedLinkIcon class="aspect-square h-[24px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Shared</h1>
			</div>
		);
	}

	function TrashMenuEntry() {
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.setSelectedSetters.trash = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-0.5 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<TrashIcon class="aspect-square h-[28px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Trash</h1>
			</div>
		);
	}

	function SettingsMenuEntry() {
		const [ isSelected, setSelected ] = createSignal(false);
		navbarStore.setSelectedSetters.settings = setSelected;

		function handleClick() {
			navbarStore.deselectAllMenus();

			// Set current menu to be visible
			setSelected(!isSelected());
		}

		return (
			<div class={`flex flex-row w-[100%] items-center mr-2 mt-1 py-1 rounded-md hover:drop-shadow-sm hover:cursor-pointer
								  ${isSelected() ? "bg-neutral-200 active:bg-neutral-300" : "hover:bg-white active:bg-neutral-200"}`}
					 onClick={handleClick}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<GearIcon class="aspect-square h-[22px] invert-[20%]" />
				</div>
				<h1 class="flex-grow mr-2 font-SpaceGrotesk font-medium text-md text-zinc-700 select-none">Settings</h1>
			</div>
		);
	}

	function LogoutMenuEntry() {
		return (
			<div class="flex flex-row items-center mt-1 py-1 rounded-md drop-shadow-sm hover:bg-red-100 hover:cursor-pointer active:bg-red-200"
					 onClick={Logout}>
				<div class="flex items-center justify-center aspect-square rounded-full ml-2 mr-2 w-7">
					<LogoutIcon class="aspect-square h-[24px] invert-[20%]" />
				</div>
				<h1 class="flex-grow font-SpaceGrotesk font-medium text-md text-red-500 select-none">Log out</h1>
			</div>
		);
	};

	return (
		<div class="flex flex-row w-screen h-screen bg-[#eeeeee]"> {/* Background */}
			<div class="flex flex-col w-[250px] items-center justify-between h-screen border-r-2 border-solid border-[#] bg-[#fcfcfc]"> {/* Nav bar */}
				<UserBar />
				<div class="flex flex-col items-center w-[100%]"> {/* Content */}
					<div class="flex flex-col mt-4 w-[95%]"> {/* Transfers section */}
						<h1 class="mb-1 pl-1 font-SpaceGrotesk font-medium text-sm text-zinc-600">Transfers</h1> {/* Title of section */}
						<DownloadsMenuEntry />
						<UploadsMenuEntry />
					</div>
					<div class="flex flex-col mt-4 w-[95%]"> {/* Filesystem section */}
						<h1 class="mb-0 pl-1 font-SpaceGrotesk font-medium text-sm text-zinc-600">Filesystem</h1> {/* Title of section */}
						<FilesystemMenuEntry />
						<SharedLinkEntry />
						<TrashMenuEntry />
					</div>
				</div>
				<div class="flex-grow"> {/* Filler section */}

				</div>
				<div class="flex flex-col justify-center mt-2 mb-2 w-[95%]"> {/* Bottom section */}
					<SettingsMenuEntry />
					<LogoutMenuEntry />
				</div>
			</div>
		</div>
	);
}

export default TreasuryPage;
