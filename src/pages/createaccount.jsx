import { createSignal, createEffect } from "solid-js";
import { argon2id } from "hash-wasm";
import VideoPlayer from "./videoplayer";
import zxcvbn from "zxcvbn";

function CreateAccountPage() {
  const [inputPassword, setInputPassword] = createSignal("");
  const passwordChangeEvent = (event) => {
    let newPassword = event.target.value;

    setInputPassword(newPassword);

    const startTime = new Date();
    let result = zxcvbn(newPassword);
    const endTime = new Date();
    const elapsedTime = endTime - startTime;
    console.log("Elapsed time: ", elapsedTime, "milliseconds");
    console.log(result.feedback.warning);
    console.log(result.score);
    console.log(result.guesses_log10);
    console.log(event.target.value);
  };

  return (
    <div class="flex justify-center items-center bg-slate-600 w-screen h-screen min-h-[800px]"> {/* Background */}
      <div class="flex flex-col justify-items-center h-[28%] aspect-[17/10] bg-white drop-shadow-2xl border-solid border-slate-900 border-2"> {/* Container */}
        <h1 class="w-[100%] py-1 my-2 pb-3 font-SpaceMono font-regular text-center align-middle text-4xl select-none">Treasury</h1>
        <form id="login-info-container" class="flex flex-col items-center self-center w-[80%] h-[100%]">
          <input type="text" id="username-entry" name="username" placeholder="Username"
            class="border-solid outline-none border-slate-900 border-2 w-[100%] h-[23%] px-2 mb-6 font-SpaceMono text-black focus:border-dashed" />
          <input type="password" id="password-entry" name="password" placeholder="Password" onInput={passwordChangeEvent}
            class="border-solid outline-none border-slate-900 border-2 w-[100%] h-[23%] px-2 mb-6 font-SpaceMono text-black focus:border-dashed" />
          <button type="submit" id="submit-login" value="Login" class="border-solid border-slate-900 border-2 w-[20%] font-SpaceMono text-black hover:bg-slate-400">Login</button>
        </form>
      </div>
    </div>
  );
}

export default CreateAccountPage;
