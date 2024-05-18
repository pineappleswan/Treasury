## Encrypted file metadata buffer format
```
1. Nonce (24 bytes)
2. Encrypted JSON string with this structure:
  key    value
  fn  |  file name (name is padded for obfuscation)
  da  |  date added (as UTC time in seconds)
  if  |  is folder (boolean)
3. poly1305 authentication tag (16B)
```
