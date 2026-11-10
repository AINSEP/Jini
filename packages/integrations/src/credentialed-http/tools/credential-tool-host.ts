// Mechanical extraction provenance (exact source SHA/path) is in this package's source-map.md.
// Original bodies and why-comments are preserved; host wiring stays with the consumer.
/**
 * @file Host inputs the credential tools need: vocabulary, card identity and card helpers.
 *
 * Types only. These are the contracts a second host fulfils when it wires the custom-credential
 * and saved-key tools; the host binds its values beside each old entry. Nothing here has a
 * default: every permission, id, path, namespace, app and sentence is supplied by the host.
 */
import type { AgentToolDefinition, DerivedRiskByToolId, SurfaceAskThenReport, ToolMetadataById } from '@jini-ai/core';
import type { SurfaceCardApp, SurfaceCardFormSpec, SurfaceCardsPort } from '@jini-ai/core/contracts/cards';
import type { CredentialedRequestPort, SourceControlWritePort } from '@jini-ai/core/contracts/credentials';

/**
 * Who the cards belong to.
 *
 */
/** @agent-note Keep the URI namespace stable between opening and answering a card, because a namespace change rejects its answer. */
export interface CredentialCardIdentity {
  readonly uriNamespace: string;
  readonly appNames: {
    readonly create: SurfaceCardApp;
    readonly createOutcome: SurfaceCardApp;
    readonly setToken: SurfaceCardApp;
    readonly setTokenOutcome: SurfaceCardApp;
  };
}

/**
 * The registration vocabulary of the custom-credential tools.
 *
 */
/** @agent-note Read permission gates list and verify, write permission gates requests and edits, and catalog names must match operations.ids and reviewed metadata. */
export interface CustomCredentialToolVocabulary {
  readonly domain: string;
  readonly entityType: string;
  readonly permissions: { readonly read: string; readonly write: string };
  readonly catalogModule: string;
  readonly metadata: ToolMetadataById;
  /** @agent-note Catalog schemas use no input for list, label for verify, label/username for username edits, label/method/url/headers/body for requests, and label/owner/repo/branch/commitMessage/files for file writes. */
  readonly catalog: ReadonlyMap<string, AgentToolDefinition>;
}

/** Everything a host supplies to `createCredentialToolRegistrations`/`createCredentialSaveHandlers`.
 */
export interface CustomCredentialToolHost {
  readonly vocabulary: CustomCredentialToolVocabulary;
  readonly cardIdentity: CredentialCardIdentity;
}

/**
 * The secret-card functions the API credential save handlers open their key cards with.
 */
/** @agent-note Use the SAME answer-route exchange store and replace the form URI with its outcome only after persistence completes. */
export interface CustomCredentialSecretCards {
  readonly defineSecretCardTool: SurfaceCardsPort["defineSecretCardTool"];
  readonly askThenReport: SurfaceAskThenReport;
}

/**
 * The two credential ports `createCredentialToolRegistrations` calls instead of reaching for
 * host request or provider functions itself.
 *
 */
/** @agent-note resolveTarget never decrypts and runs before a dialog; file writes build once from saved metadata, validate before decrypting, and commit once on the SAME provider object with the EXACT plan, while Aborted → no commit. */
export interface CustomCredentialToolPorts {
  readonly credentialedRequest: CredentialedRequestPort;
  readonly sourceControlWrite: SourceControlWritePort;
}

/**
 * The project-key operations the saved-key card uses. Captured by the host for one site.
 *
 */
/** @agent-note Offer only the human inventory returned by listChoices, recheck the chosen key permission after the answer, and re-resolve a revoked or deleted key before use. */
export interface CredentialCopyProjectKeysPort {
  readonly site?: { readonly name: string };
  /** Every key the owner may pick, including keys saved on other sites; `locked` (plain words: why and what to do) rows are shown but never selectable. */
  listChoices(required: Record<string, never>, optional?: Record<string, never>): Promise<readonly { readonly keyId: string; readonly name: string; readonly locked?: string }[]>;
  permissionFor(required: { keyId: string }, optional?: Record<string, never>): Promise<string>;
  /** Returns the id the site now uses: a key picked from another site gets a new shared id, and that id is what the model receives. */
  use(required: { keyId: string; use: boolean }, optional?: Record<string, never>): Promise<{ readonly keyId: string }>;
  savedResult(required: { result: unknown }, optional?: Record<string, never>): Promise<unknown>;
}

/** The saved-key card's words. Host text: no generic fallback exists.
 */
/** @agent-note Messages may name rejected input keys but must never reflect submitted secret values. */
export interface CredentialCopyMessages {
  readonly ownerOnly: string;
  readonly instanceRefused: string;
  readonly unexpectedField: string;
  readonly notOffered: string;
  readonly inputNotEmpty: string;
  readonly keysUnavailable: string;
  readonly needsInteractive: string;
  readonly cardTitle: string;
  readonly siteLabel: string;
  readonly siteFallback: string;
  readonly cardDescription: string;
  /** Shown instead of `cardDescription` when no key can be picked. */
  readonly emptyCardDescription: string;
  /** Detail label naming the locked keys that share one reason; the reason is the detail value. */
  readonly lockedLabel: (required: { names: readonly string[] }) => string;
  /** Model-facing text for each `{granted:false, reason}` outcome. */
  readonly outcomes: { readonly dismissed: string; readonly interrupted: string; readonly nothingToPick: string };
  readonly fieldLabel: string;
  readonly fieldPlaceholder: string;
  readonly newKeyLabel: string;
  readonly submitLabel: string;
  readonly cancelLabel: string;
}

/**
 * Everything a host supplies to `createCredentialCopyRegistrations`.
 *
 */
/** @agent-note newKeyValue must not be a possible key id, and its protocol must use the SAME actor-bound exchange store as the answer route. */
export interface CredentialCopyToolHost<Resource = unknown> {
  readonly vocabulary: {
    readonly toolId: string;
    readonly domain: string;
    readonly catalogModule: string;
    readonly ownerPermission: string;
    readonly newKeyValue: string;
    readonly cardPath: string;
  };
  readonly cardIdentity: Pick<CredentialCardIdentity, 'uriNamespace'>;
  readonly catalog: readonly AgentToolDefinition[];
  readonly metadata: ToolMetadataById;
  readonly derivedRisk: DerivedRiskByToolId;
  readonly messages: CredentialCopyMessages;
  readonly protocol: {
    readonly askThenReport: SurfaceAskThenReport;
    readonly buildFormSurface: (spec: SurfaceCardFormSpec) => Resource;
  };
}
