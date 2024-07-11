import { createSignal } from "solid-js";
import { SubmitButton, SubmitButtonStates, getSubmitButtonStyle } from "../components/submitButton"
import CONSTANTS from "../client/constants";

function AdminLoginPage() {
  return (
    <div class="flex flex-col justify-center items-center w-screen h-screen bg-white">
      <h1 class="flex w-64 h-8 mb-1.5 font-SpaceGrotesk text-md font-medium text-black justify-center">Admin login</h1>
      <input
        class="flex w-64 h-8 pl-1 border-zinc-600 border-[1px] rounded-lg font-SpaceGrotesk text-sm text-black outline-offset-1"
        placeholder="Password"
      />
      <button class="px-2 py-[1px] mt-2 font-SpaceGrotesk text-sm font-normal text-black border-zinc-800 border-[1px] rounded-md">Login</button>
    </div>
  )
}

function AdminPage() {
  return AdminLoginPage();

  return (
    <div class="flex justify-center items-center flex-col bg-slate-600 w-screen min-w-max h-screen min-h-[800px]">
      <div class="flex flex-col justify-items-center bg-white drop-shadow-[0px_5px_7px_rgba(0,0,0,0.25)] border-solid rounded-2xl border-slate-900 border-2">
        <span class="w-full py-1 my-2 pb-3 font-SpaceMono font-regular text-center align-middle text-4xl">Admin</span>
      </div>
    </div>
  );
}

export default AdminPage;

// reset server
// store admin hash in .admin file
// if no .admin found, web ui will constantly show popup for setting up a login