import { createSignal } from "solid-js";
import { argon2id } from "hash-wasm";
import { SubmitButton, SubmitButtonStates, getSubmitButtonStyle } from "../components/submitButton"
import { getFormattedBytesSizeText } from "../client/formatting";
import { PASSWORD_HASH_SETTINGS, containsOnlyAlphaNumericCharacters } from "../common/commonCrypto";
import zxcvbn from "zxcvbn";

type FormStageOneData = {
  claimCode: string,
  publicSalt: string
};

enum FormStage {
  ProvideToken,
  ClaimAccount
};

const PASSWORD_STRENGTH_COLORS: string[] = [
  // Using CSS style colors because tailwindcss is unresponsive unless you declare all colors in all use cases...
  // or maybe there's a better way.
  "rgb(220, 38, 38)", // ~ "red-600"
  "rgb(239, 68, 68)", // ~ "red-500"
  "rgb(238, 88, 12)", // ~ "orange-600"
  "rgb(234, 179, 8)", // ~ "yellow-500"
  "rgb(34, 197, 60)"  // ~ "green-500"
];

const PASSWORD_STRENGTH_NAMES: string[] = [
  "Guessable",
  "Poor",
  "Weak",
  "Decent",
  "Strong"
];

function ClaimAccountPage() {
  // This signal stores the size of the requested account's storage quota on the second stage of the form process.
  const [claimStorageQuotaSize, setClaimStorageQuotaSize] = createSignal(0);

  // Components
  function InputField(props: any) {
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
  
  function Form(props: any) {
    const [submitButtonText, setSubmitButtonText] = createSignal("Submit");
    const [submitButtonState, setSubmitButtonState] = createSignal(SubmitButtonStates.DISABLED);
    let [ formStage, setFormStage ] = createSignal<FormStage>(FormStage.ProvideToken);
    let formBusy = false;

    // Data used by the second stage of the form that was obtained on the first stage
    const formStageOneData: FormStageOneData = {
      claimCode: "",
      publicSalt: ""
    };
  
    async function onFormSubmit(event: any) {
      event.preventDefault();
        
      if (formBusy)
        return;
    
      // Submit form
      setSubmitButtonState(SubmitButtonStates.DISABLED);
      formBusy = true;

      // Begin busy text loop
      function busyTextLoop(counter: number) {
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
          
          if (data.success == true)
            setFormStage(FormStage.ClaimAccount);
          
          setSubmitButtonText(data.message);
          setSubmitButtonState(data.success ? SubmitButtonStates.SUCCESS : SubmitButtonStates.ERROR);
        } else if (response.status == 429) {
          setSubmitButtonText("Too many requests!");
          setSubmitButtonState(SubmitButtonStates.ERROR);
        }
      };

      const formStageTwo = async () => {
        const username = event.target.username.value;
        const password = event.target.password.value;

        // Ensure we have the public salt ready for hashing
        if (formStageOneData.publicSalt.length == 0) {
          console.error(`formStageOneData.publicSalt is not of string type! Value: ${formStageOneData.publicSalt}`);
          setFormStage(FormStage.ProvideToken);
          return;
        }

        // Hash the password with the public salt
        let passwordHash = await argon2id({
          password: password,
          salt: formStageOneData.publicSalt,
          parallelism: PASSWORD_HASH_SETTINGS.PARALLELISM,
          iterations: PASSWORD_HASH_SETTINGS.ITERATIONS,
          memorySize: PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
          hashLength: PASSWORD_HASH_SETTINGS.HASH_LENGTH,
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
          setSubmitButtonState(SubmitButtonStates.SUCCESS);

          setTimeout(() => {
            window.location.pathname = "/login";
          }, 1500);
        } else {
          setSubmitButtonText(data.message);
          setSubmitButtonState(SubmitButtonStates.ERROR);
        }
      };
      
      // Decide the stage of the form
      if (formStage() == FormStage.ClaimAccount) {
        await formStageTwo();
      } else {
        await formStageOne();
      }

      formBusy = false;

      // Reset button after 1 second
      setTimeout(() => {
        setSubmitButtonText(formStage() == FormStage.ClaimAccount ? "Claim" : "Submit");
        setSubmitButtonState(formStage() == FormStage.ProvideToken ? SubmitButtonStates.DISABLED : SubmitButtonStates.ENABLED);
      }, 1000);
    }

    // Password strength functionality
    const [ passwordScore, setPasswordScore ] = createSignal(0);

    // This function performs input validation on each stage of the form
    function inputChange(event: any) {
      const form = event.target.form;

      if (formStage() == FormStage.ClaimAccount) {
        const username = form.elements.username.value;
        const password = form.elements.password.value;
        const confirmPassword = form.elements.confirmPassword.value;
        
        if (!containsOnlyAlphaNumericCharacters(username)) {
          setSubmitButtonText("Username must be alphanumeric!");
          setSubmitButtonState(SubmitButtonStates.ERROR);
        } else if (username.length > 20) { // TODO: get password restrictions from server!!!
          setSubmitButtonText("Username is too long!");
          setSubmitButtonState(SubmitButtonStates.ERROR);
        } else if (password.length > 200) {
          setSubmitButtonText("Password is too long!");
          setSubmitButtonState(SubmitButtonStates.ERROR);
        } else if (password !== confirmPassword) {
          setSubmitButtonText("Passwords don't match!");
          setSubmitButtonState(SubmitButtonStates.ERROR);
        } else if (username.length == 0 || password.length == 0 || confirmPassword.length == 0) {
          setSubmitButtonText("Claim");
          setSubmitButtonState(SubmitButtonStates.DISABLED);
        } else {
          setSubmitButtonText("Claim");
          setSubmitButtonState(SubmitButtonStates.ENABLED);
        }
        
        // Password strength estimation
        const pwData = zxcvbn(password);
        let score: number = pwData.score;
        score = Math.min(Math.max(score, 0), 4); // Clamp between 0 and 4 just in case
        setPasswordScore(pwData.score);
      } else {
        const claimCode = form.elements.claimCode.value;
        
        if (claimCode.length == 0) {
          setSubmitButtonState(SubmitButtonStates.DISABLED);
        } else if (!formBusy) {
          setSubmitButtonState(SubmitButtonStates.ENABLED);
        }
      }
    }

    // TODO: show password eyeball icon!

    return (
      <form id="submit-info-container" class="flex flex-col items-center self-center w-[80%] h-[100%]" onSubmit={onFormSubmit}>
        {(formStage() == FormStage.ClaimAccount) ? (
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
            <div class="flex flex-col w-[90%] h-10 mb-6">
              <h1 class={`w-[100%] h-3 text-sm font-SpaceGrotesk font-semibold drop-shadow-md`}
                  style={`color: ${PASSWORD_STRENGTH_COLORS[passwordScore()]};`}>
                {`Password strength: ${PASSWORD_STRENGTH_NAMES[passwordScore()]}`}
              </h1>
              <div
                class="flex w-[100%] h-4 mt-3 rounded-sm border-2"
                style={`border-radius: 0.25rem; border-color: ${PASSWORD_STRENGTH_COLORS[passwordScore()]}`}
              >
                <div
                  class={`h-[100%]`}
                  style={`
                    width: ${(passwordScore() + 1) * 20}%; background-color: ${PASSWORD_STRENGTH_COLORS[passwordScore()]};
                  `}
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
          disabled={submitButtonState() != SubmitButtonStates.ENABLED}
          class={`${getSubmitButtonStyle(submitButtonState())} mb-5`}>{submitButtonText()}
        </button>
      </form>
    );
  }

  return (
    <div class="flex justify-center items-center flex-col bg-slate-600 w-screen min-w-max h-screen min-h-[800px]"> {/* Background */}
      <div class="flex flex-col justify-items-center bg-white drop-shadow-[0px_5px_7px_rgba(0,0,0,0.25)] border-solid rounded-2xl border-slate-900 border-2"> {/* Container */}
        <h1 class="w-[100%] mt-3 font-SpaceMono font-regular text-center align-middle text-3xl">Claim account</h1>
        {claimStorageQuotaSize() > 0 ? (
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
