import { createSignal } from "solid-js";
import { argon2id } from "hash-wasm";
import { SubmitButton, SubmitButtonStates, getSubmitButtonStyle } from "../components/submitButton"
import { getFormattedByteSizeText, isAlphaNumericOnly } from "../common/commonUtils";
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { encryptBuffer } from "../client/clientCrypto";
import { DataSizeUnitSetting } from "../client/userSettings";
import base64js from "base64-js";
import CONSTANTS from "../common/constants";

enum FormStage {
	ProvideToken,
	ClaimAccount
};

type FormStageOneData = {
	claimCode?: string;
	passwordPublicSalt?: Uint8Array;
	masterKeySalt?: Uint8Array;
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
	const formStageOneData: FormStageOneData = {};

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
			const response = await fetch("/api/checkclaimcode", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					claimCode: claimCode
				})
			});

			if (response.ok) {
				const json = await response.json();

				if (json.isValid) {
					props.setClaimStorageQuotaSizeCallback(json.storageQuota);

					setFormStage(FormStage.ClaimAccount);
					setSubmitButtonText("Success!");
					setSubmitButtonState(SubmitButtonStates.Success);
				} else {
					setSubmitButtonText("Invalid claim code!");
					setSubmitButtonState(SubmitButtonStates.Error);
				}

				/*
				// Show the requested account's storage quota size
				formStageOneData.claimCode = claimCode;
				formStageOneData.passwordPublicSalt = passwordPublicSalt;
				formStageOneData.masterKeySalt = masterKeySalt;

				props.setClaimStorageQuotaSizeCallback(json.storageQuota);
				
				setFormStage(FormStage.ClaimAccount);
				setSubmitButtonText(json.message);
				setSubmitButtonState(SubmitButtonStates.Success);
				*/
			} else if (response.status == 429) {
				setSubmitButtonText("Too many requests!");
				setSubmitButtonState(SubmitButtonStates.Error);
			} else {
				try {
					const json = await response.json();

					setSubmitButtonText(json.message);
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
			if (!formStageOneData.claimCode || !formStageOneData.passwordPublicSalt || !formStageOneData.masterKeySalt) {
				console.error(`formStageOneData is missing data!`);
				setFormStage(FormStage.ProvideToken);
				return;
			}

			// Hash the raw password with the public salt to get the normal password
			const password = await argon2id({
				password: rawPassword,
				salt: formStageOneData.passwordPublicSalt,
				parallelism: CONSTANTS.PASSWORD_HASH_SETTINGS.PARALLELISM,
				iterations: CONSTANTS.PASSWORD_HASH_SETTINGS.ITERATIONS,
				memorySize: CONSTANTS.PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
				hashLength: CONSTANTS.PASSWORD_HASH_SETTINGS.HASH_LENGTH,
				outputType: "hex"
			});
			
			// Hash the raw password again with the master key salt to generate the user's master key.
			// This is so that the key pair data can be encrypted and uploaded to the server.
			const masterKey = await argon2id({
				password: rawPassword,
				salt: formStageOneData.masterKeySalt,
				parallelism: CONSTANTS.PASSWORD_HASH_SETTINGS.PARALLELISM,
				iterations: CONSTANTS.PASSWORD_HASH_SETTINGS.ITERATIONS,
				memorySize: CONSTANTS.PASSWORD_HASH_SETTINGS.MEMORY_SIZE,
				hashLength: CONSTANTS.PASSWORD_HASH_SETTINGS.HASH_LENGTH,
				outputType: "binary"
			});
			
			// Generate key pairs
			const ed25519PrivateKey = ed25519.utils.randomPrivateKey();
			const ed25519PublicKey = ed25519.getPublicKey(ed25519PrivateKey);
			const x25519PrivateKey = x25519.utils.randomPrivateKey();
			const x25519PublicKey = x25519.getPublicKey(x25519PrivateKey);

			// Encrypt private keys
			const ed25519PrivateKeyEncrypted = encryptBuffer(ed25519PrivateKey, masterKey);
			const x25519PrivateKeyEncrypted = encryptBuffer(x25519PrivateKey, masterKey);

			// Submit request with username, password and public password salt
			const response = await fetch("/api/claimaccount", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					claimCode: formStageOneData.claimCode,
					username: username,
					password: password,
					ed25519PrivateKeyEncryptedB64: base64js.fromByteArray(ed25519PrivateKeyEncrypted),
					ed25519PublicKeyB64: base64js.fromByteArray(ed25519PublicKey),
					x25519PrivateKeyEncryptedB64: base64js.fromByteArray(x25519PrivateKeyEncrypted),
					x25519PublicKeyB64: base64js.fromByteArray(x25519PublicKey),
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
				const json = await response.json();

				setSubmitButtonText(json.message);
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
				<InputField type="text" name="claimCode" placeholder="Access token" onInput={inputChange} />
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
