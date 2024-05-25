import { createSignal } from "solid-js";
import qrcode from "qrcode";

type QRCodePopupContext = {
	createPopup?: (data: string) => void;
};

type QRCodePopupProps = {
	context: QRCodePopupContext;
};

function QRCodePopup(props: QRCodePopupProps) {
	const [ isVisible, setVisible ] = createSignal(false);
	const [ imageSource, setImageSource ] = createSignal("");

	props.context.createPopup = async (data: string) => {
		setVisible(true);

		const result = qrcode.toDataURL(data, {
			errorCorrectionLevel: "medium",
			color: {
				light: "ffffffff",
				dark: "000000ff"
			},
			margin: 2
		});

		const imageData = await result;
		//window.open(imageData, "_blank");
		setImageSource(imageData);
	};

	// TODO: suspense because the server needs to accept the share info

	return (
		<div
			class={`absolute flex shrink-0 justify-center items-center self-center backdrop-blur-[2px] w-full h-full z-10 backdrop-brightness-90`}
			style={`${!isVisible() && "display: none;"}`}
		>
			<div class="flex flex-col items-center border-[1px] border-zinc-400 bg-zinc-100 rounded-2xl px-6 pb-6 pt-2">
				<span class="font-SpaceGrotesk font-medium text-xl pb-4">Your share link</span>
				<img src={imageSource()} alt="" />
			</div>
		</div>
	)
}

export type {
	QRCodePopupContext
}

export {
	QRCodePopup
}
