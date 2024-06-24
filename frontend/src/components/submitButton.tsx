enum SubmitButtonStates {
  Enabled,
  Disabled,
  Error,
  Success
}

type SubmitButtonProps = {
  type?: any;
  name?: any;
  onClick?: any;
  children?: any;
};

function getSubmitButtonStyle(state: SubmitButtonStates) {
  if (state == SubmitButtonStates.Enabled) {
    return "border-solid border-slate-900 border-2 px-2 w-fit font-SpaceMono text-nowrap text-black hover:bg-slate-400 active:bg-slate-500 rounded";
  } else if (state == SubmitButtonStates.Disabled) {
    return "border-solid border-slate-400 border-2 px-2 w-fit font-SpaceMono text-nowrap text-slate-400 rounded";
  } else if (state == SubmitButtonStates.Error) {
    return "border-solid border-red-500 border-2 px-2 w-fit font-SpaceMono text-nowrap text-red-600 rounded";
  } else if (state == SubmitButtonStates.Success) {
    return "border-solid border-green-500 border-2 px-2 w-fit font-SpaceMono text-nowrap text-green-600 rounded";
  }
}

function SubmitButton(props: SubmitButtonProps) {
  return (
    <button
      type={props.type}
      name={props.name}
      onClick={props.onClick}
      class="border-solid border-slate-500 border-2 rounded mr-2 mt-6 px-2 w-fit font-SpaceMono
             text-nowrap text-slate-200 hover:bg-slate-700 active:bg-slate-800">{props.children}
    </button>
  );
}

export {
  SubmitButton,
  getSubmitButtonStyle,
  SubmitButtonStates
}
