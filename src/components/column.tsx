type ColumnProps = {
	width: number;
	noShrink?: boolean;
	children?: any;
};

const Column = (props: ColumnProps) => {
	return (
		<div
			style={`width: ${props.width}%;`}
			class={`flex ${props.noShrink && "flex-shrink-0"} items-center h-full truncate`}
		>
			{props.children}
		</div>
	);
};

type ColumnTextProps = {
	marginSize?: number;
	textSize?: string; // must be a CSS size, e.g "0.875em"
	bold?: boolean;
	semibold?: boolean;
	ellipsis?: boolean;
	matchParentWidth?: boolean;
	text: string;
	style?: string; // Optional extra CSS style
};

const ColumnText = (props: ColumnTextProps) => {
	const classValue = `
		${props.marginSize ? `ml-${props.marginSize}` : "ml-2"} font-SpaceGrotesk text-zinc-900 text-[0.825em]
		${props.bold == true ? "font-bold" : (props.semibold ? "font-semibold" : "font-normal")}
		${props.matchParentWidth && "w-0 min-w-full"}
		${props.ellipsis && "text-ellipsis overflow-x-hidden pr-2"}
		bg-transparent
		select-none
	`;

	return (
		<span
			class={classValue}
			style={`${props.style} ${props.textSize && `font-size: ${props.textSize}`}`}
		>{props.text}</span>
	);
};

export {
	Column,
	ColumnText
}
