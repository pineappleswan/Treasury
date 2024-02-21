const SUBMIT_BUTTON_STATES = {
	ENABLED: 0,
	DISABLED: 1,
	ERROR: 2,
	SUCCESS: 3
}

function getSubmitButtonStyle(state) {
	if (state == SUBMIT_BUTTON_STATES.ENABLED) {
		return "border-solid border-slate-900 border-2 px-2 w-fit font-SpaceMono text-nowrap text-black hover:bg-slate-400 active:bg-slate-500 rounded";
	} else if (state == SUBMIT_BUTTON_STATES.DISABLED) {
		return "border-solid border-slate-400 border-2 px-2 w-fit font-SpaceMono text-nowrap text-slate-400 rounded";
	} else if (state == SUBMIT_BUTTON_STATES.ERROR) {
		return "border-solid border-red-500 border-2 px-2 w-fit font-SpaceMono text-nowrap text-red-600 rounded";
	} else if (state == SUBMIT_BUTTON_STATES.SUCCESS) {
		return "border-solid border-green-500 border-2 px-2 w-fit font-SpaceMono text-nowrap text-green-600 rounded";
	}
}

function SubmitButton(props) {
	return (
		<button
			type={props.type}
			id={props.id}
			name={props.name}
			placeholder={props.placeholder}
			onClick={props.onClick}
			class="border-solid border-slate-500 border-2 rounded mr-2 mt-6 px-2 w-fit font-SpaceMono
			       text-nowrap text-slate-200 hover:bg-slate-700 active:bg-slate-800">{props.children}
		</button>
	);
}

export { SubmitButton, getSubmitButtonStyle, SUBMIT_BUTTON_STATES }
