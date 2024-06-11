import { createSignal } from "solid-js";
import { argon2id } from "hash-wasm";
import { SubmitButton, SubmitButtonStates, getSubmitButtonStyle } from "../components/submitButton"
import { getFormattedByteSizeText, isAlphaNumericOnly } from "../common/commonUtils";
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { encryptBuffer } from "../client/clientCrypto";
import { DataSizeUnitSetting } from "../client/userSettings";
import base64js from "base64-js";
import CONSTANTS from "../common/constants";
import { randomBytes } from "@noble/ciphers/crypto";
import { bytesToHex } from "@noble/ciphers/utils";

enum FormStage {
	ProvideToken,
	ClaimAccount
};

type FormStageOneData = {
	claimCode: string;
};

type ClaimAccountInputFieldProps = {
	type: string,
	name: string,
	placeholder?: string,
	onInput: any,
	disabled?: boolean
};

type ClaimAccountFormProps = {
	setClaimStorageQuotaSizeCallback: (quota: number) => void;
};

function InputField(props: ClaimAccountInputFieldProps) {
	return (
		<input
			type={props.type}
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

function ClaimAccountForm(props: ClaimAccountFormProps) {
	const [submitButtonText, setSubmitButtonText] = createSignal("Submit");
	const [submitButtonState, setSubmitButtonState] = createSignal(SubmitButtonStates.Disabled);
	let [ formStage, setFormStage ] = createSignal<FormStage>(FormStage.ProvideToken);
	let formBusy = false;

	// Data used by the second stage of the form that was obtained on the first stage
	const formStageOneData: FormStageOneData = {
		claimCode: ""
	};

	async function onFormSubmit(event: any) {
		event.preventDefault();
			
		if (formBusy)
			return;
	
		// Submit form
		const oldStage = formStage();
		setSubmitButtonState(SubmitButtonStates.Disabled);
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
			const response = await fetch(`/api/accounts/claimcode?code=${claimCode}`);

			if (response.ok) {
				const json = await response.json();

				if (json.isValid) {
					props.setClaimStorageQuotaSizeCallback(json.storageQuota);
					formStageOneData.claimCode = claimCode;

					setFormStage(FormStage.ClaimAccount);
					setSubmitButtonText("Success!");
					setSubmitButtonState(SubmitButtonStates.Success);
				} else {
					setSubmitButtonText("Invalid claim code!");
					setSubmitButtonState(SubmitButtonStates.Error);
				}
			} else if (response.status == 429) {
				setSubmitButtonText("Too many requests!");
				setSubmitButtonState(SubmitButtonStates.Error);
			} else {
				try {
					const text = await response.text();

					setSubmitButtonText(text.length == 0 ? "Error" : text);
					setSubmitButtonState(SubmitButtonStates.Error);
				} catch (error) {
					console.error(error);
				}
			}
		};

		const formStageTwo = async () => {
			const username = event.target.username.value;
			const rawPassword = event.target.password.value;

			// Ensure we have the data ready
			if (formStageOneData.claimCode.length == 0) {
				console.error(`formStageOneData's claim code string is empty!`);
				setFormStage(FormStage.ProvideToken);
				return;
			}

			const keySize = CONSTANTS.XCHACHA20_KEY_LENGTH;

			// Generate a random salt
			const salt = randomBytes(CONSTANTS.USER_DATA_SALT_BYTE_LENGTH);

			// Generate a random master key
			const masterKey = randomBytes(keySize);

			// Derive the root encryption key and authentication key from the plaintext password and the random salt
			const derivedKeys = await argon2id({
				password: rawPassword,
				salt: salt,
				parallelism: CONSTANTS.ARGON2_SETTINGS.PARALLELISM,
				iterations: CONSTANTS.ARGON2_SETTINGS.ITERATIONS,
				memorySize: CONSTANTS.ARGON2_SETTINGS.MEMORY_SIZE,
				hashLength: keySize * 2,
				outputType: "binary"
			});

			const rootKey = derivedKeys.slice(0, keySize); // Never sent to the server
			const authKey = derivedKeys.slice(keySize, derivedKeys.byteLength);

			if (rootKey.byteLength != keySize || authKey.byteLength != keySize) {
				console.error(`rootKey or authKey size doesn't match key size!`);
				setFormStage(FormStage.ProvideToken);
				return;
			}
			
			// Generate key pairs
			const ed25519PrivateKey = ed25519.utils.randomPrivateKey();
			const ed25519PublicKey = ed25519.getPublicKey(ed25519PrivateKey);

			const x25519PrivateKey = x25519.utils.randomPrivateKey();
			const x25519PublicKey = x25519.getPublicKey(x25519PrivateKey);

			// Encrypt private keys using the master key
			const ed25519PrivateKeyEncrypted = encryptBuffer(ed25519PrivateKey, masterKey);
			const x25519PrivateKeyEncrypted = encryptBuffer(x25519PrivateKey, masterKey);

			// Encrypt the master key using the root encryption key
			const encryptedMasterKey = encryptBuffer(masterKey, rootKey);

			// Submit request with username, password and public password salt
			const response = await fetch("/api/accounts/claim", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					claimCode: formStageOneData.claimCode,
					username: username,
					authKey: base64js.fromByteArray(authKey),
					encryptedMasterKey: base64js.fromByteArray(encryptedMasterKey),
					encryptedEd25519PrivateKey: base64js.fromByteArray(ed25519PrivateKeyEncrypted),
					encryptedX25519PrivateKey: base64js.fromByteArray(x25519PrivateKeyEncrypted),
					ed25519PublicKey: base64js.fromByteArray(ed25519PublicKey),
					x25519PublicKey: base64js.fromByteArray(x25519PublicKey),
					salt: base64js.fromByteArray(salt)
				})
			});
			
			if (response.ok) {
				console.log(`Claimed account! Redirecting to login page!`);
				
				// Redirect to login page after a short period of time so user can see success message.
				setSubmitButtonText("Success! Redirecting to login...");
				setSubmitButtonState(SubmitButtonStates.Success);
				
				setTimeout(() => {
					window.location.pathname = "/login";
				}, 1500);
			} else {
				const text = await response.text();

				setSubmitButtonText(text.length == 0 ? "Error" : text);
				setSubmitButtonState(SubmitButtonStates.Error);
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

			if (oldStage == FormStage.ProvideToken && formStage() == FormStage.ClaimAccount) {
				setSubmitButtonState(SubmitButtonStates.Disabled);
			} else {
				setSubmitButtonState(SubmitButtonStates.Enabled);
			}
		}, 1000);
	}

	// This function performs input validation on each stage of the form
	function inputChange(event: any) {
		const form = event.target.form;

		if (formStage() == FormStage.ClaimAccount) {
			const username = form.elements.username.value;
			const password = form.elements.password.value;
			const confirmPassword = form.elements.confirmPassword.value;
			
			if (!isAlphaNumericOnly(username)) {
				setSubmitButtonText("Username must be alphanumeric!");
				setSubmitButtonState(SubmitButtonStates.Error);
			} else if (username.length > CONSTANTS.MAX_USERNAME_LENGTH) {
				setSubmitButtonText("Username is too long!");
				setSubmitButtonState(SubmitButtonStates.Error);
			} else if (username.length < CONSTANTS.MIN_USERNAME_LENGTH) {
				setSubmitButtonText("Username is too short!");
				setSubmitButtonState(SubmitButtonStates.Error);
			} else if (password.length > CONSTANTS.MAX_PASSWORD_LENGTH) {
				setSubmitButtonText("Password is too long!");
				setSubmitButtonState(SubmitButtonStates.Error);
			} else if (password !== confirmPassword) {
				setSubmitButtonText("Passwords don't match!");
				setSubmitButtonState(SubmitButtonStates.Error);
			} else if (username.length == 0 || password.length == 0 || confirmPassword.length == 0) {
				setSubmitButtonText("Claim");
				setSubmitButtonState(SubmitButtonStates.Disabled);
			} else {
				setSubmitButtonText("Claim");
				setSubmitButtonState(SubmitButtonStates.Enabled);
			}
		} else {
			const claimCode = form.elements.claimCode.value;

			// TODO: since claim codes come with hyphens now, automatically add hyphens when the user types
			
			if (claimCode.length != CONSTANTS.CLAIM_ACCOUNT_CODE_LENGTH) {
				setSubmitButtonText("Incorrect code length");
				setSubmitButtonState(SubmitButtonStates.Disabled);
			} else if (!formBusy) {
				setSubmitButtonText("Submit");
				setSubmitButtonState(SubmitButtonStates.Enabled);
			}
		}
	}

	return (
		<form class="flex flex-col items-center self-center w-[80%] h-full" onSubmit={onFormSubmit}>
			{(formStage() == FormStage.ClaimAccount) ? (
				<>
					<InputField type="username" name="username" placeholder="Username" onInput={inputChange} />
					<InputField type="password" name="password" placeholder="Password" onInput={inputChange} />
					<InputField type="password" name="confirmPassword" placeholder="Confirm password" onInput={inputChange} />
				</>
			) : (
				<InputField type="text" name="claimCode" placeholder="Claim code" onInput={inputChange} />
			)}
			<button
				type="submit"
				disabled={submitButtonState() != SubmitButtonStates.Enabled}
				class={`${getSubmitButtonStyle(submitButtonState())} mb-5`}>{submitButtonText()}
			</button>
		</form>
	);
}

function ClaimAccountPage() {
	// This signal stores the size of the requested account's storage quota on the second stage of the form process.
	const [claimStorageQuotaSize, setClaimStorageQuotaSize] = createSignal(0);

	return (
		<div class="flex justify-center items-center flex-col bg-slate-600 w-screen min-w-max h-screen min-h-[800px]"> {/* Background */}
			<div class="flex flex-col justify-items-center bg-white drop-shadow-[0px_5px_7px_rgba(0,0,0,0.25)] border-solid rounded-2xl border-slate-900 border-2"> {/* Container */}
				<span class="w-full mt-3 font-SpaceMono font-regular text-center align-middle text-3xl">Claim account</span>
				{claimStorageQuotaSize() > 0 ? (
					<h2 class="w-full pb-5 font-SpaceMono font-regular text-center text-zinc-600 align-middle text-md">
						{`Storage: ${ getFormattedByteSizeText(claimStorageQuotaSize(), DataSizeUnitSetting.Base10) }`}
					</h2>
				) : (
					<div class="py-2.5"></div>
				)}
				<ClaimAccountForm setClaimStorageQuotaSizeCallback={setClaimStorageQuotaSize} />
			</div>
			<span>
				<SubmitButton type="text" onClick={() => window.location.pathname = "/login" }>Return to login</SubmitButton>
			</span>
		</div>
	);
}

export default ClaimAccountPage;
