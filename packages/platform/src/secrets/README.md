# Secret sealing

Import production primitives from `@jini-ai/platform/secrets`, credential contracts from
`@jini-ai/platform/secrets/credential-sets`, and memory adapters from
`@jini-ai/platform/secrets/testing`. These subpaths use Node builtins; the package root and
the browser-safe fetch subpath keep their existing exports.

```ts
import { AesGcmSecretSealer, EnvOrFileKeyring, formatAad } from "@jini-ai/platform/secrets";

const keyring = new EnvOrFileKeyring({
  env: { read: ({ name }) => process.env[name] },
  allowFileFallback: true,
  allowFileAutoGenerate: false,
  envVarName: "MY_APP_ROOT_KEY",
  keyFilePath: "/path/chosen/by/the/host/site-key.hex",
  hkdfSalt: "my-app-site-key-hkdf-v1",
});
const sealer = new AesGcmSecretSealer({ keyring });
const aad = formatAad({ kind: "vendor-credential-set", version: "v1", parts: ["ws-1", "github", "cred-1"] });
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
`inspectSiteKeyMaterial` and `revealSiteKeyMaterial` require the same env port and read fresh
state without caching or generating files.
`generateFileSiteKey({ keyFilePath })` creates a 32-byte key with an exclusive file write and
never overwrites an existing path. `revealSiteKeyMaterial` and generation return raw key material;
callers control disclosure and must not log it.

Root-key source ordering, runtime-mode path policy, durable database adapters, and composition
belong to the host. Hosts with their own ordered source resolver can pass validated material to
`FixedSiteKeyKeyring({ hex, hkdfSalt }, { keyId })`. `InMemoryKeyring({ hkdfSalt, keyId })` uses a fresh
ephemeral key with the same derivation. `formatAad` preserves colon-separated formats without
escaping: hosts own the identifier constraints of each lineage.

## Legacy owner store

`@jini-ai/platform/secrets/legacy-owner` (Node) decodes the passphrase backup an old owner store wrote
(`readLegacyOwnerBackup`) and holds the policy that reads its `owner.db` rows: the legacy keyring (env
`OWNER_STORE_KEY`, salt `jini-owner-store-v1`, key file fallback on, generation off), an `authorize`
callback that allows only the owner workspace, no principal and a copyable kind, and one decrypt per
row whose every failure is the fixed `OwnerStoreRecoveryError`. It takes a `VaultRepoPort`; the SQL
lives in `@jini-ai/db/owner-store`. Nothing here writes, migrates or generates a key.

## Legacy vault codecs

`@jini-ai/platform/secrets/legacy-codecs` (Node) pins the historical AAD formats of the pre-vault
credential tables and normalizes their payloads into vault records, for recovery and boot migration
only. Feature reads use `buildVaultAad`, never these builders. Unknown tables or AAD versions fail
closed with `VaultError({ code: "context" })` instead of trying candidate AADs.

## Wiring

- `legacyVaultAad` needs `formerCustomOwnerKey`: the host's own vault owner key, under which the former
  custom vault sealed. `normalizeLegacyVaultPayload` / `legacyTargetProvider` need the host's
  `LegacyVaultPolicy` (`legacyPublishCredential`, `tokenField`).
