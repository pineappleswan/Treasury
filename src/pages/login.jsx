import { createSignal, createEffect } from "solid-js";
import { argon2id } from "hash-wasm";
import { SubmitButton, SUBMIT_BUTTON_STATES, getSubmitButtonStyle } from "../components/SubmitButton"
import { utf8ToBytes } from '@noble/ciphers/utils';
import { uint8ArrayToHexString } from "../common/commonCrypto.js";

function goToClaimAccountPage() {
  window.location.pathname = "/claimaccount";
}

function showAboutPopup() {
  // TODO: allow user to config what the about popup says? otherwise just show a random message.
}

function LoginPage() {
  const [loginButtonText, setLoginButtonText] = createSignal("Login");
  const [loginButtonState, setLoginButtonState] = createSignal(SUBMIT_BUTTON_STATES.DISABLED);
  let loginBusy = false;

  var submitLogin = (username, password) => {
    return new Promise(async (resolve, reject) => {
      function finish(success, message) {
        resolve({ success: success, message: message });
      }
      
      // Begin login busy text loop
      function loggingInBusyTextLoop(counter) {
        if (!loginBusy)
          return;
  
        let dots = ".".repeat(counter % 4);
        setLoginButtonText(`Logging in${dots}`);
        setTimeout(loggingInBusyTextLoop, 600, counter + 1);
      }
      
      loggingInBusyTextLoop(0);
  
      // Begin login sequence
      try {
        // 0. Request password hash settings
        let passwordHashSettings = await fetch("/api/getpasswordhashsettings");

        if (!passwordHashSettings.ok)
          throw new Error("Server did not return password hash settings!");

        passwordHashSettings = await passwordHashSettings.json();

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
  
        if (response.status == 429) {
          finish(false, "Too many requests!");
          return;
        } else if (response.status == 403) { // Forbidden response = already logged in
          window.location.pathname = "/treasury";
          finish(false, "Already logged in!");
          return;
        } else if (!response.ok) {
          throw new Error(`Server returned status code of ${response.status}`);
        }
  
        let data = await response.json();
        
        if (!data.success) {
          finish(false, data.message);
          return;
        }
        
        // 2. Hash the password with the user's public salt
        let publicSalt = data.publicSalt;

        let passwordHash = await argon2id({
            password: password,
            salt: publicSalt,
            parallelism: passwordHashSettings.parallelism,
            iterations: passwordHashSettings.iterations,
            memorySize: passwordHashSettings.memorySize,
            hashLength: passwordHashSettings.hashLength,
            outputType: "hex"
        });
  
        // a. Sanity check
        if (passwordHash.length != passwordHashSettings.hashLength * 2) { // * 2 because hash is HEX which takes 2 characters to represent a byte
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
  
        if (!response.ok) {
          throw new Error(`Server returned status code of ${response.status}`);
        }
  
        data = await response.json();
        
        if (!data.success) {
          finish(false, data.message);
          return;
        }
  
        // a. Derive master key from password
        let masterKey = await argon2id({
          password: password,
          salt: data.masterKeySalt,
          parallelism: passwordHashSettings.parallelism,
          iterations: passwordHashSettings.iterations,
          memorySize: passwordHashSettings.memorySize,
          hashLength: passwordHashSettings.hashLength,
          outputType: "binary"
        });
        
        console.log(`real pw: ${password}`);
        console.log(`Master key salt: ${data.masterKeySalt}`);
        console.log(`Master key: ${masterKey}`);

        // Store master key in local storage as hex string
        const masterKeyHexString = uint8ArrayToHexString(masterKey);
        localStorage.setItem("masterKey", masterKeyHexString);

        console.log(`Master key hex string: ${masterKeyHexString}`);

        window.location.pathname = "/treasury";
        finish(true, "Success!");
      } catch (error) {
        console.error(`Failed to login: ${error}`);
        finish(false, "INTERNAL ERROR");
      }
    });
  };

  async function onFormSubmit(event) {
    event.preventDefault();
    const username = event.target.username.value;
    const password = event.target.password.value;

    if (loginBusy)
      return;

    if (username.length == 0 || password.length == 0) {
      return;
    }

    // Submit login form
    setLoginButtonState(SUBMIT_BUTTON_STATES.DISABLED);
    loginBusy = true;
    const { success, message } = await submitLogin(username, password);
    loginBusy = false;
    
    // Set login button feedback
    setLoginButtonText(message);
    setLoginButtonState(success ? SUBMIT_BUTTON_STATES.SUCCESS : SUBMIT_BUTTON_STATES.ERROR);
    
    // Reset button after 1 second
    setTimeout(() => {
      setLoginButtonText("Login");
      setLoginButtonState(SUBMIT_BUTTON_STATES.ENABLED);
    }, 1000);

    // console.log(`Success: ${success} Message: ${message}`)
  }

  // TEMPORARY! auto login
  console.log("AUTO LOGGING IN!");

  onFormSubmit({
    preventDefault: () => {},
    target: {
      username: { value: "test" },
      password: { value: "test" }
    }
  });

  // Components
  function InputField(props) {
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
  
  function LoginForm(props) {
    // This function determines the style of the login button and whether its enabled/disabled
    function inputChange(event) {
      const form = event.target.form;
      const username = form.elements.username.value;
      const password = form.elements.password.value;
      
      if (username.length == 0 || password.length == 0) {
        setLoginButtonState(SUBMIT_BUTTON_STATES.DISABLED);
      } else if (!loginBusy) {
        setLoginButtonState(SUBMIT_BUTTON_STATES.ENABLED);
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
          disabled={loginButtonState() != SUBMIT_BUTTON_STATES.ENABLED}
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
      </span>
    </div>
  );
}

export default LoginPage;
