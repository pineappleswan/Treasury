## Treasury encrypted file format (.tef)
When users upload files to be stored on the server, they are stored in this format.
```
HEADER:
	1. Magic number (4 bytes -> 2E 54 45 46) (.TEF)

CHUNK:
	1. Nonce (24 bytes)
	2. Encrypted chunk data (max ~2.147 GB for safety reasons)
	  a. Chunk id (4 bytes -> big endian)
	  b. Chunk data
	3. poly1305 authentication tag (16 bytes)
```
