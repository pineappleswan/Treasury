import { createSignal } from "solid-js";
import { argon2id } from "hash-wasm";
import { SubmitButton, SubmitButtonStates, getSubmitButtonStyle } from "../components/submitButton"
import { setLocalStorageUserCryptoInfo } from "../client/localStorage";
import { decryptBuffer } from "../client/clientCrypto";
import { ed25519, x25519 } from "@noble/curves/ed25519";
import CONSTANTS from "../common/constants";
import base64js from "base64-js";

function goToClaimAccountPage() {
	window.location.pathname = "/claimaccount";
}

function showAboutPopup() {
	// TODO: allow user to config what the about popup says? otherwise just show a random message.
}

type LoginResolveInfo = {
	message: string;
	redirectLink?: string;
}

type LoginRejectInfo = {
	message: string;
	redirectLink?: string;
}

function LoginPage() {
	const [loginButtonText, setLoginButtonText] = createSignal("Login");
	const [loginButtonState, setLoginButtonState] = createSignal(SubmitButtonStates.Disabled);
	let loginBusy = false;

	const submitLogin = (username: string, rawPassword: string) => {
		// Redirect links received from the server are not processed for success messages

		// Resolves with a message string
		return new Promise<LoginResolveInfo>(async (resolve, reject: (info: LoginRejectInfo) => void) => {
			// Begin login busy text loop (TODO: sometimes the dots have some delay for some reason... fix that...)
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
				// 1. Get the user's salt
				let response = await fetch("/api/getusersalt", {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify({
						username: username
					})
				});
				
				if (!response.ok) {
					reject({ message: "Login failed!" });
					return;
				}
				
				let json = await response.json();
				
				if (!json.salt) {
					reject({ message: "Login failed!" });
					return;
				}

				const keySize = CONSTANTS.XCHACHA20_KEY_LENGTH;
				const salt = base64js.toByteArray(json.salt);

				// 2. Derive the root encryption key and authentication key from the plaintext password and the user's salt
				const derivedKeys = await argon2id({
					password: rawPassword,
					salt: salt,
					parallelism: CONSTANTS.ARGON2_SETTINGS.PARALLELISM,
					iterations: CONSTANTS.ARGON2_SETTINGS.ITERATIONS,
					memorySize: CONSTANTS.ARGON2_SETTINGS.MEMORY_SIZE,
					hashLength: keySize * 2,
					outputType: "binary"
				});

				const rootKey = derivedKeys.slice(0, keySize);
				const authKey = derivedKeys.slice(keySize, derivedKeys.byteLength);

				if (rootKey.byteLength != keySize || authKey.byteLength != keySize) {
					console.error(`rootKey or authKey size doesn't match key size!`);
					return;
				}

				// 3. Login
				response = await fetch("/api/login", {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify({
						username: username,
						authKey: base64js.fromByteArray(authKey)
					})
				});
				
				if (!response.ok) {
					reject({ message: "Login failed!" });
					return;
				}
				
				json = await response.json();
				
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

				// Redirect to treasury page
				window.location.pathname = "/treasury";
				resolve({ message: "Success!" });
			} catch (error) {
				console.error(`Failed to login: ${error}`);
				reject({ message: "INTERNAL ERROR!" });
			}
		});
	};

	async function onFormSubmit(event: any) {
		event.preventDefault();
		const username = event.target.username.value;
		const rawPassword = event.target.password.value;

		if (loginBusy)
			return;

		if (username.length == 0 || rawPassword.length == 0) {
			return;
		}

		// Submit login form
		setLoginButtonState(SubmitButtonStates.Disabled);
		loginBusy = true;

		let redirectLink: string | undefined;

		try {
			const resolveInfo = await submitLogin(username, rawPassword);
			redirectLink = resolveInfo.redirectLink;
			setLoginButtonText(resolveInfo.message);
			setLoginButtonState(SubmitButtonStates.Success);
		} catch (error) {
			const info = error as LoginRejectInfo;
			redirectLink = info.redirectLink;

			setLoginButtonText(info.message);
			setLoginButtonState(SubmitButtonStates.Error);
		}
		
		loginBusy = false;
		
		// Reset after 1 second
		setTimeout(() => {
			// If a redirect link was provided, then redirect here
			if (redirectLink)
				window.location.pathname = redirectLink;

			setLoginButtonText("Login");
			setLoginButtonState(SubmitButtonStates.Enabled);
		}, 1000);

		// console.log(`Success: ${success} Message: ${message}`)
	}

	// TEMPORARY! auto login  
	const autoLoginTestTest = async () => {
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
				setLoginButtonState(SubmitButtonStates.Disabled);
			} else if (!loginBusy) {
				setLoginButtonState(SubmitButtonStates.Enabled);
			}
		}

		return (
			<form class="flex flex-col items-center self-center w-[80%] h-full" onSubmit={props.onSubmit}>
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
					disabled={loginButtonState() != SubmitButtonStates.Enabled}
					class={`${getSubmitButtonStyle(loginButtonState())} mb-5`}>{loginButtonText()}
				</button>
			</form>
		);
	}

	return (
		<div class="flex justify-center items-center flex-col bg-slate-600 w-screen min-w-max h-screen min-h-[800px]">
			<div class="flex flex-col justify-items-center bg-white drop-shadow-[0px_5px_7px_rgba(0,0,0,0.25)] border-solid rounded-2xl border-slate-900 border-2">
				<span class="w-full py-1 my-2 pb-3 font-SpaceMono font-regular text-center align-middle text-4xl">Treasury</span>
				<LoginForm onSubmit={onFormSubmit} />
			</div>
			<span>
				<SubmitButton type="text" onClick={showAboutPopup}>About</SubmitButton>
				<SubmitButton type="text" onClick={goToClaimAccountPage}>Claim account</SubmitButton>
				<SubmitButton type="text" onClick={autoLoginTestTest}>auto login (DEBUG)</SubmitButton>
			</span>
		</div>
	);
}

export default LoginPage;
