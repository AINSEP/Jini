import type { KeyringPort, SecretSealerPort, VaultContext, VaultErrorCode, VaultIdentity, VaultKind, VaultMeta, VaultMetaParsers, VaultQuery, VaultRepoPort } from "@jini-ai/core/contracts/vault";

/** Display hint for a stored token: its length and, for tokens of 12+ characters, the last four. */
/** @agent-note Same shape as the platform credential hint; the host's `credential.hint` produces it from an unsealed value, server-side only. */
export type HostedMcpTokenHint = { length: number; last4: string | null };

/** The vault service operations the hosted store calls: one `put` when sealing, one `get` when opening. */
/** @agent-note Fulfilled by the host's vault service (usually `SecretsVaultService` from `@jini-ai/platform`) built by `vault.createService`. It must check `authorize` before any read or write, build AAD from the record context itself, and open with no legacy-AAD fallback. */
export interface HostedMcpVaultService {
  put(input: VaultContext & { id: string; expectedRevision: number | null; provider: string | null; label: string; meta: unknown; payload: VaultMeta }): Promise<VaultIdentity>;
  get(input: VaultIdentity): Promise<{ payload: VaultMeta | null } | null>;
}

/** Everything `vault.createService` receives; built fresh for each seal/open. */
/** @agent-note Pass every field through unchanged: `metaParsers` already carries the hosted metadata policy and `authorize` refuses any foreign workspace/owner/kind/principal by throwing. */
export interface HostedMcpVaultServiceDeps {
  repo: VaultRepoPort;
  sealer: SecretSealerPort;
  keyring: KeyringPort;
  metaParsers: VaultMetaParsers;
  authorize: (input: { action: "put" | "get" | "list" | "rotate" | "delete"; context: VaultContext | VaultIdentity | VaultQuery }) => Promise<void>;
  now: () => string;
  newId: () => string;
}

/** Host-bound vault ports for the envelope module and the in-memory repository. */
/** @agent-note The host binds these ONCE. `createMemoryRepo` returns a fresh, empty in-memory vault repository on every call (no shared Map); `createService` wraps the host's real vault service; `vaultErrors.create` must return the host's real vault error class instance (same `instanceof`/`code` the rest of the host checks); `metaParsers` builds the host's per-kind parsers around the supplied `validateMeta`, which must be consulted for both `mcp-env` and `mcp-auth`. Error codes are the saved vocabulary `conflict | context | invalid-meta | invalid-record`. */
export interface HostedMcpVaultPorts {
  vault: {
    createService(deps: HostedMcpVaultServiceDeps): HostedMcpVaultService;
    createMemoryRepo(): VaultRepoPort;
  };
  vaultErrors: { create({ code }: { code: VaultErrorCode }, optionalArgs?: Record<string, never>): Error };
  metaParsers(required: { validateMeta: (input: { kind: VaultKind; meta: VaultMeta }) => VaultMeta }): VaultMetaParsers;
}

/** The error a credential rule throws: only a rule message and field, never the submitted value. */
/** @agent-note Fulfilled by the host's credential input error class; the store tests `instanceof` it and copies `message`/`field` into its own validation error. */
export type HostedMcpCredentialInputError = abstract new (...args: never[]) => Error & { readonly field: string };

/** Host-bound ports the hosted store reads on top of the per-call `repo/sealer/keyring/clock`. */
/** @agent-note The host binds these ONCE (the same values for every call). `assertFreeField` throws `credential.InputError` when a plain field looks like a secret. `credential.normalize`/`assert` apply the host token policy and throw `credential.InputError`; `messages` supplies the five user-facing credential sentences; `limit` is the token length cap. `settingsLink` names where an operator fixes a connection and is interpolated verbatim into admission/model-facing failure reasons, so it must carry no secret. */
export interface HostedMcpStorePorts extends HostedMcpVaultPorts {
  assertFreeField(required: { value: string; field: string }): void;
  credential: {
    normalize(required: { value: unknown; field?: string; hosted?: boolean }): string;
    assert(required: { value: unknown; field?: string; hosted?: boolean }): void;
    hint(required: { token: string }): HostedMcpTokenHint;
    messages: { readonly env: string; readonly ascii: string; readonly storage: string; readonly blank: string; readonly url: string };
    limit: number;
    InputError: HostedMcpCredentialInputError;
  };
  settingsLink: string;
}
