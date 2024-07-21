import { createSignal } from "solid-js";
import { SubmitButton, SubmitButtonStates, getSubmitButtonStyle } from "../components/submitButton"
import { setLocalStorageUserCryptoInfo } from "../client/localStorage";
import { decryptBuffer, hashRawPasswordToComponents } from "../client/crypto";
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { getSaltFromServer } from "../client/utils";
import CONSTANTS from "../client/constants";
import base64js from "base64-js";

function goToClaimAccountPage() {
  window.location.pathname = "/claimaccount";
}

type LoginFormData = {
  username: string,
  password: string
}

enum LoginFormType {
  Login,
  TwoFactorCode
}

function LoginPage() {
  const [loginButtonText, setLoginButtonText] = createSignal("Login");
  const [loginButtonState, setLoginButtonState] = createSignal(SubmitButtonStates.Disabled);
  const [formType, setFormType] = createSignal<LoginFormType>(LoginFormType.Login);
  let loginBusy = false;

  // Store the last submitted login form's data for the two factor authentication code where it 
  // will need the login form's username and password
  let loginFormData: LoginFormData = {
    username: "",
    password: ""
  };

  const loggingInBusyTextLoop = (counter: number) => {
    if (!loginBusy)
      return;

    let dots = ".".repeat(counter % 4);
    setLoginButtonText(`Logging in${dots}`);
    setTimeout(loggingInBusyTextLoop, 600, counter + 1);
  };

  const submitLogin = (username: string, rawPassword: string, authCode: string | null) => {
    if (loginBusy)
      return;

    if (username.length == 0 || rawPassword.length == 0) {
      console.error("Username or password is empty when submitting login!");
      return;
    }
    
    // Resolves with a message string
    return new Promise<void>(async (resolve, reject: () => void) => {
      // Begin login sequence
      try {
        // Start login button loading loop
        loginBusy = true;
        loggingInBusyTextLoop(0);

        // Set button state
        setLoginButtonState(SubmitButtonStates.Disabled);

        // 1. Get the user's salt
        const salt = await getSaltFromServer(username);
        
        // 2. Derive the root encryption key and authentication key from the plaintext password and the user's salt
        const [ rootKey, authKey ] = await hashRawPasswordToComponents(rawPassword, salt);

        // 3. Login
        const response = await fetch("/api/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username: username,
            authKey: base64js.fromByteArray(authKey),
            twoFactorCode: authCode
          })
        });
        
        if (!response.ok) {
          if (response.status == 429) {
            setLoginButtonText("Too many requests!");
          } else {
            setLoginButtonText("Login failed!");
          }

          setLoginButtonState(SubmitButtonStates.Error);
          reject();

          return;
        }
        
        const json = await response.json();

        // 4. Check if server wants two factor authentication code
        if (json.requiresTwoFactorCode === true) {
          setFormType(LoginFormType.TwoFactorCode);
          setLoginButtonText("Confirm");
          setLoginButtonState(SubmitButtonStates.Disabled);
          resolve();
          return;
        }
        
        // Decrypt master key
        const masterKey = decryptBuffer(base64js.toByteArray(json.encryptedMasterKey), rootKey);

        // Decrypt keypairs
        const ed25519PrivateKey = decryptBuffer(base64js.toByteArray(json.encryptedEd25519PrivateKey), masterKey);
        const x25519PrivateKey = decryptBuffer(base64js.toByteArray(json.encryptedX25519PrivateKey), masterKey);

        // Get public keys
        const ed25519PublicKey = ed25519.getPublicKey(ed25519PrivateKey);
        const x25519PublicKey = x25519.getPublicKey(x25519PrivateKey);

        // Store master key in local storage as hex string
        setLocalStorageUserCryptoInfo({
          masterKey: masterKey,
          ed25519PrivateKey: ed25519PrivateKey,
          ed25519PublicKey: ed25519PublicKey,
          x25519PrivateKey: x25519PrivateKey,
          x25519PublicKey: x25519PublicKey,
        });

        // Redirect to home page
        window.location.pathname = "/home";

        setLoginButtonText("Logged in!");
        setLoginButtonState(SubmitButtonStates.Success);
        resolve();
      } catch (error) {
        console.error(`Failed to login: ${error}`);

        setLoginButtonText("INTERNAL ERROR");
        setLoginButtonState(SubmitButtonStates.Error);
        reject();
      } finally {
        loginBusy = false;

        // Reset button state after one second
        if (formType() == LoginFormType.Login) {
          setTimeout(() => {
            setLoginButtonText("Login");
            setLoginButtonState(SubmitButtonStates.Enabled);
          }, 1000);
        } else {
          setTimeout(() => {
            setLoginButtonText("Confirm");

            if (authCode !== null) {
              setLoginButtonState(SubmitButtonStates.Enabled);
            }
          }, 1000);
        }
      }
    });
  };

  // TODO: TEMPORARY! auto login  
  const autoLoginTestTest = async () => {
    loginFormData.username = "test";
    loginFormData.password = "test";

    try {
      submitLogin("test", "test", null);
    } catch {
      console.log("Failed login attempt.");
    }
  };

  // Components
  const InputField = (props: any) => {
    return (
      <input
        type={props.type}
        name={props.name}
        placeholder={props.placeholder}
        onInput={props.onInput}
        class="aspect-[8] w-full mx-10 border-2 border-solid border-slate-700 outline-none drop-shadow-md 
               px-2 mb-6 rounded-md font-SpaceMono text-black focus:border-dashed focus:bg-slate-200"
      />
    );
  };
  
  const loginFormInputChangeEvent = (event: any) => {
    const form = event.target.form;
    const username = form.elements.username.value;
    const password = form.elements.password.value;
    
    if (username.length == 0 || password.length == 0) {
      setLoginButtonState(SubmitButtonStates.Disabled);
    } else if (!loginBusy) {
      setLoginButtonState(SubmitButtonStates.Enabled);
    }
  };

  const LoginForm = () => {
    const onSubmit = async (event: any) => {
      event.preventDefault();
      const username = event.target.username.value;
      const rawPassword = event.target.password.value;

      loginFormData.username = username;
      loginFormData.password = rawPassword;
      
      try {
        submitLogin(username, rawPassword, null);
      } catch {
        console.log("Failed login attempt.");
      }
    };

    return (
      <form class="w-80 h-42 flex flex-col items-center self-center" onSubmit={onSubmit}>
        <InputField type="text" name="username" placeholder="Username" onInput={loginFormInputChangeEvent} />
        <InputField type="password" name="password" placeholder="Password" onInput={loginFormInputChangeEvent} />
        <button
          type="submit"
          disabled={loginButtonState() != SubmitButtonStates.Enabled}
          class={`${getSubmitButtonStyle(loginButtonState())} mb-5`}>{loginButtonText()}
        </button>
      </form>
    );
  };

  const twoFactorAuthFormInputChangeEvent = (event: any) => {
    const form = event.target.form;
    const code = form.elements.code.value;

    if (code.length == CONSTANTS.TWO_FACTOR_AUTH_CODE_LENGTH) {
      setLoginButtonState(SubmitButtonStates.Enabled);
    } else if (!loginBusy) {
      setLoginButtonState(SubmitButtonStates.Disabled);
    }
  };

  const TwoFactorAuthCodeForm = () => {
    const onSubmit = async (event: any) => {
      event.preventDefault();
      const code = event.target.code.value;

      try {
        submitLogin(loginFormData.username, loginFormData.password, code);
      } catch {
        console.log("Failed login attempt.");
      }
    };

    const onCancel = () => {
      loginFormData.username = "";
      loginFormData.password = "";
      setFormType(LoginFormType.Login);
      setLoginButtonText("Login");
      setLoginButtonState(SubmitButtonStates.Enabled);
    };

    return (
      <form class="w-80 h-42 flex flex-col items-center self-center" onSubmit={onSubmit}>
        <InputField type="text" name="code" placeholder="Enter 6-digit code" onInput={twoFactorAuthFormInputChangeEvent} />
        <div class="flex flex-row">
          <button
            type="reset"
            disabled={false}
            class={`${getSubmitButtonStyle(SubmitButtonStates.Enabled)} mb-5 mr-2`}
            onClick={onCancel}
          >
            {"Back"}
          </button>
          <button
            type="submit"
            disabled={loginButtonState() != SubmitButtonStates.Enabled}
            class={`${getSubmitButtonStyle(loginButtonState())} mb-5`}
          >
            {loginButtonText()}
          </button>
        </div>
      </form>
    );
  };

  return (
    <div class="flex justify-center items-center flex-col bg-slate-600 w-screen h-screen">
      <div class="px-10 bg-white drop-shadow-[0px_5px_7px_rgba(0,0,0,0.25)] border-solid rounded-2xl border-slate-900 border-2">
        <div class={`flex flex-col justify-center ${formType() != LoginFormType.Login && "hidden"}`}>
          <span class="w-full py-1 my-2 pb-3 font-SpaceMono font-regular text-center align-middle text-4xl">Treasury</span>
          <LoginForm />
        </div>
        <div class={`flex flex-col justify-center ${formType() != LoginFormType.TwoFactorCode && "hidden"}`}>
          <span class="w-full py-1 my-2 pb-3 font-SpaceMono font-regular text-center align-middle text-3xl">Enter 2FA code</span>
          <TwoFactorAuthCodeForm />
        </div>
      </div>
      <span>
        <SubmitButton type="text" onClick={goToClaimAccountPage}>Claim account</SubmitButton>
        <SubmitButton type="text" onClick={autoLoginTestTest}>auto login (DEBUG)</SubmitButton>
      </span>
    </div>
  );
}

export default LoginPage;
