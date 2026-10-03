# Secret sealing

Import production primitives from `@jini-ai/platform/secrets`, credential contracts from
`@jini-ai/platform/secrets/credential-sets`, and memory adapters from
`@jini-ai/platform/secrets/testing`. These subpaths use Node builtins; the package root and
the browser-safe fetch subpath keep their existing exports.

```ts
import { AesGcmSecretSealer, EnvOrFileKeyring } from "@jini-ai/platform/secrets";
import { buildVendorCredentialAad } from "@jini-ai/platform/secrets/credential-sets";

const keyring = new EnvOrFileKeyring({
  env: { read: ({ name }) => process.env[name] },
  allowFileFallback: true,
  allowFileAutoGenerate: false,
  envVarName: "MY_APP_ROOT_KEY",
  keyFilePath: "/path/chosen/by/the/host/root-key.hex",
  hkdfSalt: "my-app-root-key-hkdf-v1",
});
const sealer = new AesGcmSecretSealer({ keyring });
const aad = buildVendorCredentialAad({ workspaceId: "ws-1", vendorId: "github", id: "cred-1" });
const sealed = await sealer.seal({ plaintext: "example-only", key: await keyring.activeKey({}), aad });
const plaintext = await sealer.open({ sealed }, { aad });
```

Keep the salt and AAD byte-identical when adopting existing ciphertext. The envelope contains
`keyId`, base64 `ciphertext || tag`, base64 `nonce`, and `alg: "aes-256-gcm"`. The IV is 12 bytes
and the authentication tag is 16 bytes. The AES derivation uses info
`secret-sealer.v1:secret-sealer:<keyId>`, with SHA-256 HKDF producing 32 bytes.

`seal` requires an AAD string at both type and runtime boundaries. `open` accepts absent AAD
for historical unbound records. Reconstruct the same AAD from trusted record context when opening.

`EnvOrFileKeyring` requires an injected `env.read({ name })` port and explicit boolean
`allowFileFallback` / `allowFileAutoGenerate` permissions in its first object. Missing or
non-boolean permissions throw at construction, before any key file can be created. It selects
env material first and caches that selection. `allowFileFallback: false` requires env material;
file reads require `true`, and file creation additionally requires `allowFileAutoGenerate: true`.
`inspectRootKeyMaterial` and `revealRootKeyMaterial` require the same env port and read fresh
state without caching or generating files.
`generateFileRootKey({ keyFilePath })` creates a 32-byte key with an exclusive file write and
never overwrites an existing path. `revealRootKeyMaterial` and generation return raw key material;
callers control disclosure and must not log it.

Root-key source ordering, runtime-mode path policy, durable database adapters, and composition
belong to the host. Hosts with their own ordered source resolver can pass validated material to
`FixedRootKeyKeyring(hex, { hkdfSalt, keyId })`. `InMemoryKeyring({ hkdfSalt, keyId })` uses a fresh
ephemeral key with the same derivation. `formatAad` preserves colon-separated formats without
escaping: hosts own the identifier constraints of each lineage.
