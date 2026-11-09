/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/agent-plugins`. */
import type { SealedSecret, SecretSealerPort, VaultPutRecord, VaultRepoPort } from "./vault.js";



/** Extra public connection metadata, entered directly on the secure card. */
export interface PluginCredentialField {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly required?: boolean;
}


/** One plugin-declared key card, already resolved to the saved row it fills. */
export interface PluginCredentialCard {
  /** Declaring installed plugin, supplied by the trusted contribution loader. */
  readonly pluginId?: string;
  /** Provider id the assistant passes as `target` (e.g. a mail provider's id). */
  readonly providerId: string;
  /** API credential label, or the connection name for a domain-owned save. */
  readonly label: string;
  /** Explicit ownership of this API card's exact label; conflicting plugins are refused at merge. */
  readonly ownedApiLabel?: string;
  readonly category: string;
  readonly baseUrl: string;
  readonly title: string;
  readonly intro?: string;
  readonly helpUrl?: string;
  readonly helpLabel?: string;
  /** Hint under the key field, e.g. which access the key needs. */
  readonly keyHint?: string;
  /** Plain-text purposes for people and the assistant; never selects or authorizes a key in code. */
  readonly usedFor?: readonly string[];
  readonly fields?: readonly PluginCredentialField[];
  /** Optional read-only GET before sealing; absolute HTTPS on the declared baseUrl origin. */
  readonly probeUrl?: string;
  readonly additionalHosts?: readonly string[];
  /** Absent preserves the original mail/API save path. `provider-settings` saves a provider plugin's
   *  declared settings (saveTarget = that plugin's id; see provider-settings-card.ts). */
  readonly saveKind?: "api" | "publish-host" | "source-control" | "agent-plugin-token" | "oauth" | "provider-settings";
  readonly saveTarget?: string;
  /** Permissions explained on a hosted sign-in card; never grants authority itself. */
  readonly permissions?: string;
}

/*
 * Credential sets: labelled, origin-restricted API credentials stored as vault rows. Types only;
 * the store/vault logic is host-wired (it receives owner, metadata parser, error factory, scope
 * policy and messages as required inputs) and the vault itself comes from the host.
 */

/** @agent-note Types only. A safe token hint: the saved token's length and, for long tokens only,
 *  its last four characters. Computed by the vault when sealing; reading it never decrypts. */
export interface CredentialSetTokenHint {
  length: number;
  last4: string | null;
}

/** @agent-note The store keyring as credential-set hosts supply it: zero-argument `activeKey`. A keyring
 *  whose `activeKey` takes the vault port's required options argument (`KeyringPort`) does NOT
 *  satisfy it directly; the host adapts it (`activeKey: () => keyring.activeKey({})`). Only key
 *  handles cross this port, never key bytes. */
export interface CredentialSetKeyringPort {
  activeKey(): Promise<{ readonly keyId: string }>;
  deriveSigningSecret(input: { workspaceId: string; subscriptionId: string; version: number }): Promise<Uint8Array>;
  derive(input: { workspaceId: string; purpose: string; info: string }): Promise<Uint8Array>;
}

/** @agent-note The secret half a caller supplies. Only `token` is sealed; `username` is plaintext
 *  account metadata that the store keeps in row metadata, never inside the sealed payload. */
export interface CredentialSetConnectionInput {
  readonly token: string;
  readonly username?: string;
}

/**
 * @agent-note One saved credential set as the store sees it. `vaultRecord` and
 * `vaultExpectedRevision` are private adapter context: hosts MUST attach them non-enumerable
 * (`Object.defineProperty`) so they never serialize, and MUST write them back through the SAME
 * vault object with the SAME expected revision (compare-and-swap). Ownership (owner key, null
 * principal/binding/provider, stored kind and therefore the AAD) is checked against host-trusted
 * values on every read; it is never reconstructed from row data or model input.
 * `C` is the host's category id union (validated by the host's own list).
 */
export interface CredentialSetRecord<C extends string = string> {
  readonly worksFor?: readonly string[];
  /** Non-enumerable adapter context; not part of any public summary. */
  readonly vaultRecord?: VaultPutRecord;
  readonly vaultExpectedRevision?: number | null;
  readonly workspaceId: string;
  readonly id: string;
  readonly label: string;
  readonly category: C;
  readonly baseUrl: string;
  /** Normalized origins (`https://host[:port]`) beyond `baseUrl`; empty, never null. */
  readonly additionalHosts: readonly string[];
  /** Absent when the credential has no username (never `""`). */
  readonly username?: string;
  readonly sealed: SealedSecret;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** @agent-note Where a row lives: the site's own vault, or a project (owner) store shared by sites. */
export type CredentialSetScope = "site" | "project";

/**
 * @agent-note Safe read model. Built from metadata only: listing/describing NEVER opens a sealed
 * envelope and has no field able to carry a token, `sealed` or private context. `scope` appears only
 * where the host attached a project store.
 */
export interface CredentialSetSummary<C extends string = string> {
  readonly credentialType: "custom";
  readonly worksFor: string[];
  readonly tokenHint?: CredentialSetTokenHint | null;
  readonly id: string;
  readonly label: string;
  readonly category: C;
  readonly baseUrl: string;
  readonly additionalHosts: readonly string[];
  /** Omitted entirely (never `""`) when the credential has no saved username. */
  readonly username?: string;
  readonly configured: true;
  readonly scope?: CredentialSetScope;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * @agent-note The project half of a store, attached only by the host's composition root. Sites read
 * their own rows first and fall back to explicitly granted project rows (site rows of the same label
 * override). `replaceRepo` is for a trusted human replacement only and must recheck the site grant at
 * commit; `inventoryRepo` is owner-session metadata inventory that cannot resolve, open or mutate;
 * `createRepo` is a create-only owner port. Project rows open only with this half's own sealer/keyring.
 */
export interface CredentialSetProjectScope<C extends string = string> {
  readonly workspaceId: string;
  readonly repo: CredentialSetRepoPort<C>;
  /** Trusted human replacement retains the site-grant boundary. */
  readonly replaceRepo?: CredentialSetRepoPort<C>;
  /** Owner-session inventory only; cannot resolve, open or mutate a credential. */
  readonly inventoryRepo?: Pick<CredentialSetRepoPort<C>, "listByWorkspace">;
  readonly createRepo?: CredentialSetRepoPort<C>;
  readonly sealer: SecretSealerPort;
  readonly keyring: CredentialSetKeyringPort;
}

/**
 * @agent-note Workspace-scoped persistence for credential-set records. Writes are compare-and-swap
 * on the record's private vault context and must join the host transaction where the adapter
 * supports one; a failed write publishes nothing. `findByLabel`, when present, must be an indexed
 * lookup that keeps the same authorization as `findById` (it replaces a metadata scan, never widens
 * it). `vault`, when present, is the exact vault object the rows were read from.
 */
export interface CredentialSetRepoPort<C extends string = string> {
  readonly vault?: VaultRepoPort;
  /** The project store this site's rows fall back to; absent = site only. */
  readonly project?: CredentialSetProjectScope<C>;
  insert(record: CredentialSetRecord<C>): Promise<void>;
  /** Full-row replace by `(workspaceId, id)`. */
  update(record: CredentialSetRecord<C>): Promise<void>;
  findByLabel?(input: { workspaceId: string; label: string }): Promise<CredentialSetRecord<C> | null>;
  findById(input: { workspaceId: string; id: string }): Promise<CredentialSetRecord<C> | null>;
  listByWorkspace(input: { workspaceId: string }): Promise<CredentialSetRecord<C>[]>;
  /** Idempotent: no-op when no row exists for `(workspaceId, id)`. */
  delete(input: { workspaceId: string; id: string }): Promise<void>;
}

/*
 * Credentialed requests and source-control file writes: the two ports a credential tool host binds
 * over its OWN guarded HTTP client, credential store, audit sink, auth-scheme registry and installed
 * source-control providers. Types only; the request service implementation usually comes from
 * `@jini-ai/integrations/credentialed-http`, wrapped by the host's own adapter, and the providers
 * from the host's installed source-control plugins.
 */

/** @agent-note Authentication facts about a 401/403, never the token, header or username value.
 *  `hint` is a hedged hypothesis; `remedyToolId` is a tool id the HOST registered. */
export interface CredentialAuthFailureDiagnostic {
  readonly schemeSent: string;
  readonly usernameStored: boolean;
  readonly hint?: string;
  readonly remedyToolId?: string;
}

/** @agent-note One request that was actually sent. Headers and body are already redacted of every
 *  form of the credential; a declined confirmation is the caller's own result, never this one. */
export interface CredentialedRequestResult {
  readonly executed: true;
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly bodyText: string;
  readonly authDiagnostic?: CredentialAuthFailureDiagnostic;
}

/** Transport failure is "unreachable", never "invalid": it says nothing about the credential. */
export type CredentialCheckStatus = "valid" | "invalid" | "unreachable";

export interface CredentialVerification {
  readonly status: CredentialCheckStatus;
  readonly message: string;
  readonly checkedAt: string;
  readonly authDiagnostic?: CredentialAuthFailureDiagnostic;
}

/** A refusal means only that this GET was refused, not that the key is invalid. */
export type CredentialProbeStatus = "ok" | "refused" | "unavailable";

/** A trusted self-describing token scheme rule (e.g. an installed plugin's). */
export interface CredentialAuthSchemeRule {
  readonly id: string;
  readonly prefix: string;
  readonly scheme: string;
}

/** @agent-note `url` is TRUSTED and already resolved by the host against the saved base origin;
 *  never pass a model-supplied URL here. `connection` is plaintext and stays in-process. */
export interface CredentialProbeInput {
  readonly connection: CredentialSetConnectionInput;
  readonly url: string;
  readonly schemes: readonly CredentialAuthSchemeRule[];
  readonly method?: "GET";
}

/** Who and what: the label, verb and URL a tool handler already read as strings. */
export interface CredentialedRequestRequired {
  readonly workspaceId: string;
  readonly label: string;
  readonly method: string;
  readonly url: string;
}

/** @agent-note `headers`/`body` are untrusted caller fields; the port validates them (no
 *  credential/host override, bounded body). Never pre-trust or pre-serialize them. */
export interface CredentialedRequestOptional {
  readonly headers?: unknown;
  readonly body?: unknown;
}

/** A request target checked against the credential's saved hosts, WITHOUT decrypting it. */
export interface CredentialedRequestTarget {
  readonly label: string;
  readonly url: URL;
}

export type CredentialedRequestErrorCategory = "validation" | "transport" | "egress-refused" | "not-found" | "unknown";

/**
 * @agent-note `error` is the SAME object that was thrown (identity, class and message unchanged).
 * Only `callerSafeMessage`/`callerSafeError` may reach a model:
 * - validation: the caller's own shape/host refusal; schema-decorate it.
 * - egress-refused: `error.message` may name a resolved internal address — keep it in the server
 *   audit only. Rethrow `callerSafeError` (same class, address-free message) BEFORE any decoration
 *   reads `.message`, then schema-decorate.
 * - not-found / transport / unknown: never schema-decorated; transport text is raw (addresses), so
 *   it carries no caller-safe field. Unknown errors pass through unchanged.
 */
export type CredentialedRequestErrorClass =
  | { readonly category: "validation"; readonly error: Error; readonly callerSafeMessage: string }
  | { readonly category: "egress-refused"; readonly error: Error; readonly callerSafeMessage: string; readonly callerSafeError: Error }
  | { readonly category: "not-found"; readonly error: Error; readonly callerSafeMessage: string }
  | { readonly category: "transport"; readonly error: Error }
  | { readonly category: "unknown"; readonly error: unknown };

/**
 * Authenticated requests through a saved, origin-restricted credential.
 * @agent-note Bind each method to ONE call of your existing guarded request adapter (request,
 * target resolution, verification, connection probe) with the SAME repo, sealer, guarded HTTP client, clock, audit and auth-scheme loader your store
 * uses — never by calling a lower-level request function that skips your audit/diagnostic policy.
 * Ordering rules a host must keep:
 * - `resolveTarget` never decrypts; run it before any confirmation dialog or decrypt.
 * - GET/POST/PUT/PATCH may call `request` directly once permitted. DELETE must be held for a human
 *   answer first; a decline sends nothing and decrypts nothing. The port itself never confirms.
 * - Results and errors never carry the token, Authorization header or username value.
 */
export interface CredentialedRequestPort {
  request(required: CredentialedRequestRequired, optional?: CredentialedRequestOptional): Promise<CredentialedRequestResult>;
  resolveTarget(required: { readonly workspaceId: string; readonly label: string; readonly url: string }, optional?: Record<string, never>): Promise<CredentialedRequestTarget>;
  verify(required: { readonly workspaceId: string; readonly label: string }, optional?: Record<string, never>): Promise<CredentialVerification>;
  probe(required: CredentialProbeInput, optional?: Record<string, never>): Promise<CredentialProbeStatus>;
  classifyError(required: { readonly error: unknown }, optional?: Record<string, never>): CredentialedRequestErrorClass;
}

/** A repository named by owner and name, before anything is sent. */
export interface SourceControlRepositoryTarget {
  readonly owner: string;
  readonly repo: string;
}

/** Where a credentialed write goes: the credential's API base plus a ready-made Authorization value. */
export interface SourceControlCredentialedTarget extends SourceControlRepositoryTarget {
  readonly baseUrl: string;
  readonly authorization: string;
}

export interface SourceControlWriteFile {
  readonly path: string;
  readonly content: string;
}

export interface SourceControlFileWriteState {
  readonly path: string;
  readonly exists: boolean;
}

/** @agent-note Read-only reconnaissance: the commit must land on exactly this parent/tree. */
export interface SourceControlFileWritePlan {
  readonly parentCommitSha: string;
  readonly baseTreeSha: string;
  readonly fileStates: readonly SourceControlFileWriteState[];
}

/** @agent-note `logDetail` is for the server log only, never model-facing. */
export type SourceControlProviderCallFailure =
  | { ok: false; code: "provider-error"; message: string }
  | { ok: false; code: "network-unreachable"; message: string; logDetail: string };

export type SourceControlFileWritePlanResult =
  | { ok: true; plan: SourceControlFileWritePlan }
  | { ok: false; code: "branch-not-found"; message: string }
  | SourceControlProviderCallFailure;

export type SourceControlCommitFilesResult =
  | { ok: true; commitSha: string; commitUrl: string }
  | { ok: false; code: "diverged"; message: string }
  | SourceControlProviderCallFailure;

/** The provider operations a file write uses; a host's richer provider object satisfies this. */
export interface SourceControlFileWriter {
  readonly validateTarget?: (target: SourceControlRepositoryTarget) => string | null;
  planFileWrite(input: SourceControlCredentialedTarget & { readonly branch: string; readonly files: readonly SourceControlWriteFile[] }): Promise<SourceControlFileWritePlanResult>;
  commitFiles(
    input: SourceControlCredentialedTarget & { readonly branch: string; readonly commitMessage: string; readonly files: readonly SourceControlWriteFile[] },
    plan: SourceControlFileWritePlan,
  ): Promise<SourceControlCommitFilesResult>;
}

export type SourceControlWriterBuildResult =
  | { readonly ok: true; readonly provider: SourceControlFileWriter }
  | { readonly ok: false; readonly message: string; readonly refusals: readonly string[] };

/**
 * Validated file writes to a git host through a saved credential.
 * @agent-note Order: `build` from the credential's plaintext base URL (no decrypt) → `validateTarget`
 * on THAT provider (still no decrypt) → decrypt → `planFileWrite` (read-only) → stop if aborted →
 * `commitFiles` on the SAME provider object with the EXACT plan returned. Never rebuild the provider
 * or re-plan between plan and commit; the provider owns freshness checks and atomic commit.
 * `build` uses the host's current provider registry, guarded HTTP client and observability.
 * `validateTarget` throws the host's validation error (caller-safe text naming the field).
 * Whole-site export commits are a separate contract; this port adds no file-write confirmation.
 */
export interface SourceControlWritePort {
  build(required: { readonly workspaceId: string; readonly baseUrl: string }, optional?: Record<string, never>): Promise<SourceControlWriterBuildResult>;
  validateTarget(required: { readonly provider: SourceControlFileWriter; readonly target: { readonly owner: unknown; readonly repo: unknown } }, optional?: Record<string, never>): SourceControlRepositoryTarget;
  planFileWrite(required: { readonly provider: SourceControlFileWriter; readonly input: SourceControlCredentialedTarget & { readonly branch: string; readonly files: readonly SourceControlWriteFile[] } }, optional?: Record<string, never>): Promise<SourceControlFileWritePlanResult>;
  commitFiles(required: {
    readonly provider: SourceControlFileWriter;
    readonly input: SourceControlCredentialedTarget & { readonly branch: string; readonly commitMessage: string; readonly files: readonly SourceControlWriteFile[] };
    readonly plan: SourceControlFileWritePlan;
  }, optional?: Record<string, never>): Promise<SourceControlCommitFilesResult>;
}
