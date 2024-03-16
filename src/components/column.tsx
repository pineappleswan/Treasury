type ColumnProps = {
  width: number,
  noShrink?: boolean,
  children?: any
};

const Column = (props: ColumnProps) => {
  return (
    <div
      style={`width: ${props.width}%;`}
      class={`flex ${props.noShrink && "flex-shrink-0"} items-center h-[100%] truncate`}
    >
      {props.children}
    </div>
  );
};

type ColumnTextProps = {
  marginSize?: number,
  textSize?: string, // must be a CSS size, e.g "0.875em"
  bold?: boolean,
  semibold?: boolean,
  ellipsis?: boolean,
  matchParentWidth?: boolean,
  text: string,
  style?: string // Optional extra CSS style
};

const ColumnText = (props: ColumnTextProps) => {
  return (
    <h1
      class={`
        ${props.marginSize != undefined ? `ml-${props.marginSize}` : "ml-2"} font-SpaceGrotesk text-zinc-900 text-[0.825em]
        ${props.bold ? "font-bold" : (props.semibold ? "font-semibold" : "font-normal")}
        select-none
        ${props.matchParentWidth && "w-0 min-w-[100%]"}
        ${props.ellipsis && "text-ellipsis pr-2 overflow-clip"}
      `}
      style={`${props.style} ${props.textSize && `font-size: ${props.textSize}`}`}
    >{props.text}</h1>
  );
};

export {
  Column,
  ColumnText
}
