import { Accessor, createEffect, createSignal } from "solid-js";
import { TransferListEntryData, TransferStatus } from "./transferList";
import { UserSettings } from "../client/userSettings";
import { getFormattedByteSizeText } from "../common/commonUtils";
import { getFileExtensionFromName } from "../utility/fileNames";
import { TransferType } from "../client/transfers";
import { getFileIconFromExtension } from "../client/fileTypes";
import { TRANSFER_LIST_COLUMN_WIDTHS } from "../client/columnWidths";
import { Column, ColumnText } from "./column";

// Icons
import FinishedTransferTick from "../assets/icons/svg/finished-transfer-tick.svg?component-solid";
import SimpleArrowIcon from "../assets/icons/svg/simple-arrow.svg?component-solid";
import DashIcon from "../assets/icons/svg/dash.svg?component-solid";
import FailedTransferCrossIcon from "../assets/icons/svg/failed-transfer-cross.svg?component-solid";

type TransferListEntryProps = {
	transferListEntryData: Accessor<TransferListEntryData>;
	userSettings: Accessor<UserSettings>;
}

const TransferListEntry = (props: TransferListEntryProps) => {
	const SIZE_TEXT_PRECISION = 2;

	const { transferListEntryData, userSettings } = props;
	const [ status, setStatus ] = createSignal(TransferStatus.Waiting);
	const [ statusText, setStatusText ] = createSignal("Waiting...");
	const [ statusTextBold, setStatusTextBold ] = createSignal(false);
	const [ progressPercentage, setProgressPercentage ] = createSignal(0);
	const userSettingsDataSizeUnit = userSettings().dataSizeUnit;
	const [ transferredBytesText, setTransferredBytesText ] = createSignal(getFormattedByteSizeText(0, userSettingsDataSizeUnit));
	const [ transferSizeText, setTransferSizeText ] = createSignal("");

	setTransferSizeText("/ " + getFormattedByteSizeText(transferListEntryData().transferSize, userSettingsDataSizeUnit, SIZE_TEXT_PRECISION));

	const fileName = transferListEntryData().fileName;
	const fileExtension = getFileExtensionFromName(fileName);

	// Listen for property changes periodically whilst the transfer status is not finished or failed
	createEffect(() => {
		const entry = transferListEntryData();
		
		const currentStatus = entry.status;
		setStatus(currentStatus);

		const progressPercentage = Math.min((entry.transferredBytes / entry.transferSize), 1);
		setProgressPercentage(progressPercentage);

		if (currentStatus == TransferStatus.Waiting) {
			setStatusText(entry.statusText.length > 0 ? entry.statusText : "Waiting...");
			setStatusTextBold(false);
		} else if (currentStatus == TransferStatus.Finished) {
			setTransferredBytesText("");
			setStatusText(entry.statusText);
			setTransferSizeText(getFormattedByteSizeText(entry.transferSize, userSettingsDataSizeUnit, SIZE_TEXT_PRECISION));
		} else if (currentStatus == TransferStatus.Failed) {
			setTransferredBytesText("");
			setStatusText(entry.statusText);
			setTransferSizeText(getFormattedByteSizeText(entry.transferSize, userSettingsDataSizeUnit, SIZE_TEXT_PRECISION));
		} else {
			setTransferredBytesText(getFormattedByteSizeText(entry.transferredBytes, userSettingsDataSizeUnit, SIZE_TEXT_PRECISION));
			setStatusTextBold(true);
			
			if (entry.transferType == TransferType.Uploads) {
				setStatusText(entry.statusText.length > 0 ? entry.statusText : "Uploading...");
			} else if (entry.transferType == TransferType.Downloads) {
				setStatusText(entry.statusText.length > 0 ? entry.statusText : "Downloading...");
			}
		}
	});

	return (
		<div class="flex flex-row flex-nowrap flex-start flex-shrink-0 items-center overflow-x-hidden w-full h-8 border-b-[1px] bg-zinc-100">
			<div class={`flex justify-center items-center h-full aspect-[1.2]`}>
				{ getFileIconFromExtension(fileExtension) }
			</div>
			<Column width={TRANSFER_LIST_COLUMN_WIDTHS.NAME} noShrink>
				<ColumnText text={fileName} matchParentWidth ellipsis/>
			</Column>
			<Column width={TRANSFER_LIST_COLUMN_WIDTHS.PROGRESS} noShrink>
				<div class="w-0 min-w-[40%] h-[5px] bg-zinc-300 rounded-full ml-2 mr-1">
					<div
						class={`
							h-full rounded-full
							${status() == TransferStatus.Finished ? "bg-green-400" : (status() == TransferStatus.Failed ? "bg-red-500" : "bg-sky-400")}
						`}
						style={`width: ${progressPercentage() * 100}%`}
					></div>
				</div>
				<ColumnText text={transferredBytesText()}/>
				<ColumnText text={transferSizeText()} marginSize={(status() == TransferStatus.Finished || status() == TransferStatus.Failed) ? 0 : 1} bold/>
			</Column>
			<Column width={TRANSFER_LIST_COLUMN_WIDTHS.STATUS}>
				{() => status() == TransferStatus.Transferring && transferListEntryData().transferType == TransferType.Uploads && (
					<SimpleArrowIcon class="w-5 h-5 ml-1 flex-shrink-0 text-sky-400"/>
				)}
				{() => status() == TransferStatus.Transferring && transferListEntryData().transferType == TransferType.Downloads && (
					<SimpleArrowIcon class="w-5 h-5 ml-1 flex-shrink-0 rotate-180 text-green-500"/>
				)}
				{() => status() == TransferStatus.Finished && (
					<FinishedTransferTick class="w-4 h-4 flex-shrink-0 ml-1.5 text-green-500"/>
				)}
				{() => status() == TransferStatus.Failed && (
					<FailedTransferCrossIcon class="w-5 h-5 flex-shrink-0 ml-1 text-red-500"/>
				)}
				{() => status() == TransferStatus.Waiting && (
					<DashIcon class="w-4 h-4 flex-shrink-0 ml-1 text-sky-400"/>
				)}
				<ColumnText semibold={statusTextBold()} text={statusText()}/>
			</Column>
		</div>
	);
}

export type {
  TransferListEntryProps
}

export {
  TransferListEntry
}
