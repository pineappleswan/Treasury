// TODO: big fat documentation of why server also uses this code amongst other things

/*
{
	const key = crypto.randomBytes(32);
	const nonce = crypto.randomBytes(24);
	const chacha = xchacha20poly1305(key, nonce);
	const data = utf8ToBytes("greetings, friend");
	const cipherText = chacha.encrypt(data);

	//cipherText[4] = 123; // tamper with ciphertext as a test

	try {
		const plainText = chacha.decrypt(cipherText);

		console.log(cipherText);
		console.log(plainText);
	} catch (error) {
		if (error.message.includes("invalid tag")) {
				console.error("Failed to decrypt! Data was corrupted!");
		}
	}
}
*/

// File header structure: 1. Magic (4B -> 9B 4F E7 05)
//                        2. Chunk count (4B -> signed 32 bit integer)
// Chunk structure: 1. Magic (4B -> 82 7A 3D E3) (verifies the beginning of a chunk)
//                  2. Chunk id 
//                  2. Chunk size (4B -> signed 32 bit integer) (the number of bytes from the start of the magic of one chunk to the start of the magic of the next chunk)
//                  3. Data (max ~2 GB)
//                  4. Nonce (24B)

// TODO: transfers need approval (returns randomly generated 256 bit handle to user who requested the handle and store metadata about it on the server like the max file size), then user can finalise it

// 8 MiB chunks when uploading normal files so when a single chunk fails to upload, it's no problem.
// Videos optimised for streaming will have variable chunks sizes, so this isn't a strict value to adhere to.
const ENCRYPTED_FILE_CHUNK_SIZE = 16;

// Returns important information about stored encrypted files in the treasury's file format
// {
//		1. File is valid? (matches the magic number)
//		2. Chunk count
//		3. Chunk size
// }

const encryptedFileMagicNumber = [0x9B, 0x4F, 0xE7, 0x05];
const encryptedFileChunkMagicNumber = [0x82, 0x7A, 0x3D, 0xE3];

function ParseEncryptedFileStats() {


	return {
		isValid: isValid,
		chunkCount: chunkCount,
		chunkSize: chunkSize
	}
}

function EncodeSignedIntAsFourBytes(number) {
	return [
		(number >> 24) & 255,
		(number >> 16) & 255,
		(number >> 8) & 255,
		number & 255
	];
}

function ConvertFourBytesToSignedInt(fourBytes) {
	return (fourBytes[0] << 24) | (fourBytes[1] << 16) | (fourBytes[2] << 8) | fourBytes[3];
}

/*
let encoded = EncodeSignedIntAsFourBytes(1438753862);
console.log(encoded);
console.log(ConvertFourBytesToSignedInt(encoded));
*/

export {
  ENCRYPTED_FILE_CHUNK_SIZE
};
