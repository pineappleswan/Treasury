import { createSignal, createEffect } from "solid-js";
import { argon2id } from "hash-wasm";
import { SubmitButton, SUBMIT_BUTTON_STATES, getSubmitButtonStyle } from "../components/SubmitButton"
import { getFormattedBytesSizeText } from "../utility/formatting";
import { utf8ToBytes } from '@noble/ciphers/utils';
import zxcvbn from "zxcvbn";

function GenerateSecureRandomHexString(byteLength) {
  let buffer = new Uint8Array(byteLength);
  window.crypto.getRandomValues(buffer);
  
  return Array.from(buffer).map(i => i.toString(16).padStart(2, "0")).join("");
}

function ClaimAccountPage() {
  // This signal stores the size of the requested account's storage quota on the second stage of the form process.
  const [claimStorageQuotaSize, setClaimStorageQuotaSize] = createSignal(0);

  // Components
  function InputField(props) {
    return (
      <input
        type={props.type}
        id={props.id}
        name={props.name}
        placeholder={props.placeholder}
        onInput={props.onInput}
        disabled={props.disabled}
        class={
          `aspect-[8] w-80 mx-10 border-2 outline-none drop-shadow-md 
          px-2 mb-6 rounded-md font-SpaceMono focus:border-dashed focus:bg-slate-200
          ${props.disabled ? "border-dashed border-slate-400 text-gray-400" : "border-solid border-slate-700 text-black"}
        `}
      />
    );
  }
  
  function Form(props) {
    const [submitButtonText, setSubmitButtonText] = createSignal("Submit");
    const [submitButtonState, setSubmitButtonState] = createSignal(SUBMIT_BUTTON_STATES.DISABLED);
    let formBusy = false;

    // 0 = send claim code 1 = send username and password and claim account
    // ATM this is only used to set the submit button state
    let formStage = 0;

    // If false, that means the user is still on the first stage of the form. i.e submitting a valid account claim code.
    // When true, the username and password input fields appear
    let [ canClaimAccount, setCanClaimAccount ] = createSignal(false);

    // Data used by the second stage of the form that was obtained on the first stage
    let formStageOneData = {};
  
    async function onFormSubmit(event) {
      event.preventDefault();
        
      if (formBusy)
        return;
    
      // Submit form
      setSubmitButtonState(SUBMIT_BUTTON_STATES.DISABLED);
      formBusy = true;

      // Begin busy text loop
      function busyTextLoop(counter) {
        if (!formBusy)
          return;
  
        let dots = ".".repeat(counter % 4);
        setSubmitButtonText(`Please wait${dots}`);
        setTimeout(busyTextLoop, 600, counter + 1);
      }
      
      busyTextLoop(0);

      // Form stages
      const formStageOne = async () => {
        const claimCode = event.target.claimCode.value;

        // Check if code is valid
        const response = await fetch("/api/claimaccount", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            claimCode: claimCode
          })
        });

        if (response.ok) {
          const data = await response.json();

          // Show the requested account's storage quota size
          if (data.success && data.storageQuota) {
            formStageOneData.claimCode = claimCode;
            formStageOneData.publicSalt = data.publicSalt;
            setClaimStorageQuotaSize(data.storageQuota);
          }
          
          setCanClaimAccount(data.success);
          setSubmitButtonText(data.message);
          setSubmitButtonState(data.success ? SUBMIT_BUTTON_STATES.SUCCESS : SUBMIT_BUTTON_STATES.ERROR);
        } else if (response.status == 429) {
          setSubmitButtonText("Too many requests!");
          setSubmitButtonState(SUBMIT_BUTTON_STATES.ERROR);
        }
      };

      const formStageTwo = async () => {
        const username = event.target.username.value;
        const password = event.target.password.value;

        // Get password hash settings
        let passwordHashSettings = await fetch("/api/getpasswordhashsettings");

        if (!passwordHashSettings.ok)
          throw new Error("Server did not return password hash settings!");

        passwordHashSettings = await passwordHashSettings.json();
        
        // Ensure we have the public salt ready for hashing
        if (typeof(formStageOneData.publicSalt) != "string") {
          console.log(`formStageOneData.publicSalt is not of string type! Value: ${formStageOneData.publicSalt}`);
        }

        console.log(`publicSalt: ${formStageOneData.publicSalt}`);

        // Hash the password with the public salt
        let passwordHash = await argon2id({
          password: password,
          salt: formStageOneData.publicSalt,
          parallelism: passwordHashSettings.parallelism,
          iterations: passwordHashSettings.iterations,
          memorySize: passwordHashSettings.memorySize,
          hashLength: passwordHashSettings.hashLength,
          outputType: "hex"
        });

        // Submit request with username, password and public password salt
        const response = await fetch("/api/claimaccount", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            claimCode: formStageOneData.claimCode,
            username: username,
            password: passwordHash
          })
        });

        const data = await response.json();

        if (data.success) {
          console.log(`Claimed account! Redirecting to login page!`);

          // Redirect to login page after a short period of time so user can see success message.
          setSubmitButtonText("Success! Redirecting to login...");
          setSubmitButtonState(SUBMIT_BUTTON_STATES.SUCCESS);

          setTimeout(() => {
            window.location.pathname = "/login";
          }, 1500);
        } else {
          setSubmitButtonText(data.message);
          setSubmitButtonState(SUBMIT_BUTTON_STATES.ERROR);
        }
      };
      
      // Decide the stage of the form
      if (canClaimAccount()) {
        await formStageTwo();
      } else {
        await formStageOne();
      }

      formBusy = false;

      // Reset button after 1 second
      setTimeout(() => {
        setSubmitButtonText(canClaimAccount() ? "Claim" : "Submit");
        setSubmitButtonState(formStage == 0 && canClaimAccount() ? SUBMIT_BUTTON_STATES.DISABLED : SUBMIT_BUTTON_STATES.ENABLED);
        formStage = (canClaimAccount() ? 1 : 0);
      }, 1000);
    }

    // Password strength functionality
    const [ passwordScore, setPasswordScore ] = createSignal(0);

    const PASSWORD_STRENGTH_COLORS = {
      // Must use CSS colors, not tailwind!
      0: "rgb(220, 38, 38)",
      1: "rgb(239, 68, 68)",
      2: "rgb(238, 88, 12)",
      3: "rgb(234, 179, 8)",
      4: "rgb(34, 197, 60)",
    };

    const PASSWORD_STRENGTH_NAMES = {
      0: "Guessable",
      1: "Poor",
      2: "Weak",
      3: "Decent",
      4: "Strong"
    }

    // This function determines the appearance of the submit button and whether it's enabled or disabled
    function inputChange(event) {
      const form = event.target.form;

      if (canClaimAccount()) {
        const username = form.elements.username.value;
        const password = form.elements.password.value;
        const confirmPassword = form.elements.confirmPassword.value;

        if (username.length == 0 || password.length == 0 || confirmPassword.length == 0) {
          setSubmitButtonText("Claim");
          setSubmitButtonState(SUBMIT_BUTTON_STATES.DISABLED);
        } else if (password !== confirmPassword) {
          setSubmitButtonText("Passwords don't match!");
          setSubmitButtonState(SUBMIT_BUTTON_STATES.ERROR);
        } else {
          setSubmitButtonText("Claim");
          setSubmitButtonState(SUBMIT_BUTTON_STATES.ENABLED);
        }
        
        // Password strength estimation
        const pwData = zxcvbn(password);
        let score = pwData.score;
        score = Math.min(Math.max(score, 0), 4); // Clamp between 0 and 4 just in case
        setPasswordScore(pwData.score);
      } else {
        const claimCode = form.elements.claimCode.value;
        
        if (claimCode.length == 0) {
          setSubmitButtonState(SUBMIT_BUTTON_STATES.DISABLED);
        } else if (!formBusy) {
          setSubmitButtonState(SUBMIT_BUTTON_STATES.ENABLED);
        }
      }
    }

    return (
      <form id="submit-info-container" class="flex flex-col items-center self-center w-[80%] h-[100%]" onSubmit={onFormSubmit}>
        {() => canClaimAccount() ? (
          <>
            <InputField
              type="username"
              name="username"
              placeholder="Username"
              onInput={inputChange}
            />
            <InputField
              type="password"
              name="password"
              placeholder="Password"
              onInput={inputChange}
            />
            <InputField
              type="password"
              name="confirmPassword"
              placeholder="Confirm password"
              onInput={inputChange}
            />
            <div class="flex flex-col w-[90%] h-10 mb-4">
              <h1 class={`w-[100%] h-3 text-sm font-SpaceGrotesk font-semibold drop-shadow-md`}
                  style={`color: ${PASSWORD_STRENGTH_COLORS[passwordScore()]};`}>
                {`Password strength: ${PASSWORD_STRENGTH_NAMES[passwordScore()]}`}
              </h1>
              <div class="flex w-[100%] h-2 mt-3 rounded-full bg-zinc-300 drop-shadow-md">
                <div
                  class={`h-[100%] rounded-full`}
                  style={`width: ${(passwordScore() + 1) * 20}%; background-color: ${PASSWORD_STRENGTH_COLORS[passwordScore()]};`}
                ></div>
              </div>
            </div>
          </>
        ) : (
          <InputField
            type="text"
            name="claimCode"
            placeholder="Access token" 
            onInput={inputChange}
          />
        )}
        <button
          type="submit"
          disabled={submitButtonState() != SUBMIT_BUTTON_STATES.ENABLED}
          class={`${getSubmitButtonStyle(submitButtonState())} mb-5`}>{submitButtonText()}
        </button>
      </form>
    );
  }

  return (
    <div class="flex justify-center items-center flex-col bg-slate-600 w-screen min-w-max h-screen min-h-[800px]"> {/* Background */}
      <div class="flex flex-col justify-items-center bg-white drop-shadow-[0px_5px_7px_rgba(0,0,0,0.25)] border-solid rounded-2xl border-slate-900 border-2"> {/* Container */}
        <h1 class="w-[100%] mt-3 font-SpaceMono font-regular text-center align-middle text-3xl">Claim account</h1>
        {() => claimStorageQuotaSize() > 0 ? (
          <h2 class="w-[100%] pb-5 font-SpaceMono font-regular text-center text-zinc-600 align-middle text-md">
            {`Storage: ${ getFormattedBytesSizeText(claimStorageQuotaSize()) }`}
          </h2>
        ) : (
          <div class="py-2.5"></div>
        )}
        <Form />
      </div>
      <span>
        <SubmitButton type="text" id="return-login" onClick={() => window.location.pathname = "/login" }>Return to login</SubmitButton>
      </span>
    </div>
  );
}

export default ClaimAccountPage;
