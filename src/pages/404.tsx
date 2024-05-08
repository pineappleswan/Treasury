import { SubmitButton } from "../components/submitButton"

function ErrorPage404() {
	return (
		<div class="flex justify-center items-center flex-col bg-slate-600 w-screen h-screen min-h-[800px]"> {/* Background */}
      <div class="flex flex-col px-14 justify-items-center h-fit bg-white drop-shadow-[0px_5px_7px_rgba(0,0,0,0.25)] border-solid rounded-2xl border-slate-900 border-2"> {/* Container */}
        <span class="w-full mt-2 font-SpaceGrotesk font-regular font-bold text-center align-middle text-red-600 text-3xl">404</span>
				<h2 class="w-full mb-3 font-SpaceGrotesk font-regular font-semibold text-center align-middle text-2xl">Page not found</h2>
      </div>
      <SubmitButton type="text" onClick={() => window.location.pathname = "/treasury"}>Return to home</SubmitButton>
    </div>
	);
}

export default ErrorPage404;
