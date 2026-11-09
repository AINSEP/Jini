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

/** @agent-note The store keyring as credential-set hosts supply it (zero-argument `activeKey`, so
 *  both historical keyring shapes satisfy it). Only key handles cross this port, never key bytes. */
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
