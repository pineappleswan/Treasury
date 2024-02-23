const Column = (props) => {
  return (
    <div style={`width: ${props.width}%;`}
          class={`flex items-center h-[100%]`}>
      {props.children}
    </div>
  );
};

const ColumnText = (props) => {
  `text-xs text-sm text-base text-lg text-xl text-2xl`;

  return (
    <h1
      class={`
        ${props.marginSize != undefined ? `ml-${props.marginSize}` : "ml-2"} font-SpaceGrotesk text-zinc-900 overflow-ellipsis
        text-${props.textSize ? props.textSize : "[0.825em]"}
        ${props.bold ? "font-bold" : (props.semibold ? "font-semibold" : "font-normal")}
        whitespace-nowrap select-none
      `}
    >{props.text}</h1>
  );
};

export {
  Column,
  ColumnText
}
