import crypto from "crypto";

function generateSecureRandomBytesAsHexString(length: number) {
	return crypto.randomBytes(length).toString("hex");
}

function generateSecureRandomAlphaNumericString(length: number) {
	const alphaNumericSet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let code = "";

	for (let i = 0; i < length; i++) {
		const randomIndex = crypto.randomInt(alphaNumericSet.length);
		code += alphaNumericSet[randomIndex];
	}

	return code;
}

export {
	generateSecureRandomBytesAsHexString,
	generateSecureRandomAlphaNumericString
};

// Asymmetric encryption/decryption test
/*
{
	const myPrivateKey = x25519.utils.randomPrivateKey();
	const myPublicKey = x25519.getPublicKey(myPrivateKey);
	
	const theirPrivateKey = x25519.utils.randomPrivateKey();
	const theirPublicKey = x25519.getPublicKey(theirPrivateKey);
	
	console.log(`My public key: ${Buffer.from(myPublicKey).toString("hex")}`);
	console.log(`My private key: ${Buffer.from(myPrivateKey).toString("hex")}`);

	console.log(`Their public key: ${Buffer.from(theirPublicKey).toString("hex")}`);
	console.log(`Their private key: ${Buffer.from(theirPrivateKey).toString("hex")}`);

	const mySecret = x25519.getSharedSecret(myPrivateKey, theirPublicKey);
	const theirSecret = x25519.getSharedSecret(theirPrivateKey, myPublicKey);

	// Derive symmetric encryption key
	const myKey = await sha256(mySecret);
	const theirKey = await sha256(theirSecret);

	console.log(`My key: ${myKey} Len: ${myKey.length / 2}`);
	console.log(`Their key: ${theirKey} Len: ${theirKey.length / 2}`);
}
*/
