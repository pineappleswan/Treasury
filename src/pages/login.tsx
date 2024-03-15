import { createSignal } from "solid-js";
import { argon2id } from "hash-wasm";
import { SubmitButton, SubmitButtonStates, getSubmitButtonStyle } from "../components/submitButton"
import { setLocalStorageMasterKeyFromUint8Array } from "../common/clientCrypto";
import CONSTANTS from "../common/constants";

function goToClaimAccountPage() {
  window.location.pathname = "/claimaccount";
}

function showAboutPopup() {
  // TODO: allow user to config what the about popup says? otherwise just show a random message.
}

function LoginPage() {
  const [loginButtonText, setLoginButtonText] = createSignal("Login");
  const [loginButtonState, setLoginButtonState] = createSignal(SubmitButtonStates.DISABLED);
  let loginBusy = false;

  const submitLogin = (username: string, password: string) => {
    const promise: Promise<{ success: boolean, message: string }> = new Promise(async (resolve, reject) => {
      function finish(success: boolean, message: string) {
        resolve({ success: success, message: message });
      }
      
      // Begin login busy text loop
      function loggingInBusyTextLoop(counter: number) {
        if (!loginBusy)
          return;
  
        let dots = ".".repeat(counter % 4);
        setLoginButtonText(`Logging in${dots}`);
        setTimeout(loggingInBusyTextLoop, 600, counter + 1);
      }
      
      loggingInBusyTextLoop(0);
  
      // Begin login sequence
      try {
        // 1. Obtain the requested user's password's public salt by logging in with an empty password
        //    The empty password indicates to the server that we are requesting the user's public salt
        let response = await fetch("/api/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username: username,
            password: ""
          })
        });

        let json = await response.json();

        if (!response.ok) {
          finish(false, json.message);
          return;
        }
        
        // 2. Hash the password with the user's public salt
        let publicSalt = json.publicSalt;

        let passwordHash = await argon2id({
          password: password,
          salt: publicSalt,
          parallelism: CONSTANTS.PASSWORD_HASH_SETTINGS.PARALLELISM,
          iterations: CONSTANTS.PASSWORD_HASH_SETTINGS.ITERATIONS,
          memorySize: CONSTANTS.PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
          hashLength: CONSTANTS.PASSWORD_HASH_SETTINGS.HASH_LENGTH,
          outputType: "hex"
        });
  
        // a. Sanity check
        if (passwordHash.length != CONSTANTS.PASSWORD_HASH_SETTINGS.HASH_LENGTH * 2) { // * 2 because hash is HEX which takes 2 characters to represent a byte
          throw new Error("Password hash length does not match config setting!");
        }
  
        // 3. Send the password hash to the server for authentication
        response = await fetch("/api/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username: username,
            password: passwordHash
          })
        });
  
        json = await response.json();

        if (!response.ok) {
          finish(false, json.message);
          return;
        }
  
        // a. Derive master key from password
        let masterKey = await argon2id({
          password: password,
          salt: json.masterKeySalt,
          parallelism: CONSTANTS.PASSWORD_HASH_SETTINGS.PARALLELISM,
          iterations: CONSTANTS.PASSWORD_HASH_SETTINGS.ITERATIONS,
          memorySize: CONSTANTS.PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
          hashLength: CONSTANTS.PASSWORD_HASH_SETTINGS.HASH_LENGTH,
          outputType: "binary"
        });
        
        // console.log(`real pw: ${password}`);
        // console.log(`Master key salt: ${data.masterKeySalt}`);
        // console.log(`Master key: ${masterKey}`);

        // Store master key in local storage as hex string
        setLocalStorageMasterKeyFromUint8Array(masterKey);

        // console.log(`Master key hex string: ${masterKeyHexString}`);

        window.location.pathname = "/treasury";
        finish(true, "Success!");
      } catch (error) {
        console.error(`Failed to login: ${error}`);
        finish(false, "INTERNAL ERROR");
      }
    });

    return promise;
  };

  async function onFormSubmit(event: any) {
    event.preventDefault();
    const username = event.target.username.value;
    const password = event.target.password.value;

    if (loginBusy)
      return;

    if (username.length == 0 || password.length == 0) {
      return;
    }

    // Submit login form
    setLoginButtonState(SubmitButtonStates.DISABLED);
    loginBusy = true;
    const { success, message } = await submitLogin(username, password);
    loginBusy = false;
    
    // Set login button feedback
    setLoginButtonText(message);
    setLoginButtonState(success ? SubmitButtonStates.SUCCESS : SubmitButtonStates.ERROR);
    
    // Reset button after 1 second
    setTimeout(() => {
      setLoginButtonText("Login");
      setLoginButtonState(SubmitButtonStates.ENABLED);
    }, 1000);

    // console.log(`Success: ${success} Message: ${message}`)
  }

  // TEMPORARY! auto login  
  const autoLoginTestTest = () => {
    onFormSubmit({
      preventDefault: () => {},
      target: {
        username: { value: "test" },
        password: { value: "test" }
      }
    });
  };

  // Components
  function InputField(props: any) {
    return (
      <input
        type={props.type}
        id={props.id}
        name={props.name}
        placeholder={props.placeholder}
        onInput={props.onInput}
        class="aspect-[8] w-80 mx-10 border-2 border-solid border-slate-700 outline-none drop-shadow-md 
               px-2 mb-6 rounded-md font-SpaceMono text-black focus:border-dashed focus:bg-slate-200"
      />
    );
  }
  
  function LoginForm(props: any) {
    // This function determines the style of the login button and whether its enabled/disabled
    function inputChange(event: any) {
      const form = event.target.form;
      const username = form.elements.username.value;
      const password = form.elements.password.value;
      
      if (username.length == 0 || password.length == 0) {
        setLoginButtonState(SubmitButtonStates.DISABLED);
      } else if (!loginBusy) {
        setLoginButtonState(SubmitButtonStates.ENABLED);
      }
    }

    return (
      <form id="login-info-container" class="flex flex-col items-center self-center w-[80%] h-[100%]" onSubmit={props.onSubmit}>
        <InputField
          type="text"
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
        <button
          type="submit"
          disabled={loginButtonState() != SubmitButtonStates.ENABLED}
          class={`${getSubmitButtonStyle(loginButtonState())} mb-5`}>{loginButtonText()}
        </button>
      </form>
    );
  }

  return (
    <div class="flex justify-center items-center flex-col bg-slate-600 w-screen min-w-max h-screen min-h-[800px]"> {/* Background */}
      <div class="flex flex-col justify-items-center bg-white drop-shadow-[0px_5px_7px_rgba(0,0,0,0.25)] border-solid rounded-2xl border-slate-900 border-2"> {/* Container */}
        <h1 class="w-[100%] py-1 my-2 pb-3 font-SpaceMono font-regular text-center align-middle text-4xl">Treasury</h1>
        <LoginForm onSubmit={onFormSubmit} />
      </div>
      <span>
        <SubmitButton type="text" id="show-about" onClick={showAboutPopup}>About</SubmitButton>
        <SubmitButton type="text" id="claim-account-button" onClick={goToClaimAccountPage}>Claim account</SubmitButton>
        <SubmitButton type="text" onClick={autoLoginTestTest}>auto login (DEBUG)</SubmitButton>
      </span>
    </div>
  );
}

export default LoginPage;
