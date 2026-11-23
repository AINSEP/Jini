---
"@jini-ai/admin": minor
---

Security root key: `createHttpRootKey` takes an optional second argument `{ path?, importField? }` so a host can keep an existing server wire byte for byte (for example `{ path: '/system/site-key', importField: 'siteKey' }`); the defaults keep the stock `/system/site-token` wire with `{ token }`. `RootKeyStatus` gains optional `envVarName` and `reason` (`'empty' | 'not-hex' | 'odd-length' | 'too-short'`), which the HTTP status projection now keeps; any other server extra, including key material, is still dropped.
