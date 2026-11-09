// Mechanical extraction provenance (exact source SHA/path) is in this package's source-map.md.
// Original bodies and why-comments are preserved; host wiring stays with the consumer.
/**
 * @file Host inputs the credential tools need: vocabulary, card identity and card helpers.
 *
 * Types only. These are the contracts a second host fulfils when it wires the custom-credential
 * and saved-key tools; the host binds its values beside each old entry. Nothing here has a
 * default: every permission, id, path, namespace, app and sentence is supplied by the host.
 * @agent-note Types only; this file must keep importing nothing but `@jini-ai/core` types.
 */
import type { AgentToolDefinition, DerivedRiskByToolId, SurfaceAskThenReport, ToolMetadataById } from '@jini-ai/core';
import type { SurfaceCardApp, SurfaceCardFormSpec, SurfaceCardsPort } from '@jini-ai/core/contracts/cards';
import type { CredentialedRequestPort, SourceControlWritePort } from '@jini-ai/core/contracts/credentials';

/**
 * Who the cards belong to.
 * @agent-note `uriNamespace`: Your app's id; it appears in every card URI and is compared on answers.
 *   Keep it stable: answers to a card opened under one namespace are refused under another.
 * @agent-note `appNames`: the identity each card reports to the chat host. The values are stamped on
 *   the card unchanged, so a host that must keep saved card bytes readable supplies its old names.
 */
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
 * @agent-note `permissions.read` gates verify/list; `permissions.write` gates requests, saves and
 *   edits. Both are checked before any credential is resolved or decrypted. `entityType` is passed to
 *   the permission check; `domain` names the registrations. They may be equal; neither is assumed.
 * @agent-note `catalog` is indexed by tool name and must hold every handler's tool, with the host's
 *   own descriptions and example URLs; `metadata` is the host's reviewed approval/search policy.
 */
export interface CustomCredentialToolVocabulary {
  readonly domain: string;
  readonly entityType: string;
  readonly permissions: { readonly read: string; readonly write: string };
  readonly catalogModule: string;
  readonly metadata: ToolMetadataById;
  readonly catalog: ReadonlyMap<string, AgentToolDefinition>;
}

/** Everything a host supplies to `createCustomCredentialsRegistrations`/`createApiCredentialSaveHandlers`.
 * @agent-note Supply all vocabulary and card identity explicitly; permissions gate resolution and
 * decrypt, and the same stable namespace/app identity must be used when answering the card. */
export interface CustomCredentialToolHost {
  readonly vocabulary: CustomCredentialToolVocabulary;
  readonly cardIdentity: CredentialCardIdentity;
}

/**
 * The secret-card functions the API credential save handlers open their key cards with.
 * @agent-note Cards are typically from Jini UI: `defineSecretCardTool` from
 *   `@jini-ai/ui/mcp-ui/secret-card`, `askThenReport` from `@jini-ai/daemon/surface-exchanges`.
 *   The `surfaces.surfaceExchanges` passed beside these MUST be the SAME `SurfaceExchangeStore`
 *   instance your answer/callback route delivers to, or no answer ever reaches the card. Keystrokes
 *   travel only browser → answer route → exchange → seal; the key never enters model input or a
 *   result. `askThenReport` replaces the SAME card URI with the outcome only AFTER the save
 *   finished, never on delivery.
 */
export interface CustomCredentialSecretCards {
  readonly defineSecretCardTool: SurfaceCardsPort["defineSecretCardTool"];
  readonly askThenReport: SurfaceAskThenReport;
}

/**
 * The two credential ports `createCustomCredentialsToolRegistrations` calls instead of reaching for
 * host request or provider functions itself.
 * @agent-note Bind both over your EXISTING adapters with the same repo, sealer, guarded HTTP client,
 *   clock, audit, auth-scheme loader and provider registry your store and routes use (the host: the
 *   binders in `credential-ports.ts`). Ordering the tools rely on, which a second host's binding must
 *   not undo: `resolveTarget` never decrypts and runs before any dialog; GET/POST/PUT/PATCH call
 *   `request` immediately; a DELETE is held for the human first and `request` (the decrypt and send)
 *   runs only after approval, so a decline sends nothing. `classifyError` must return the egress
 *   refusal's `callerSafeError` without the resolved address.
 * @agent-note File writes: `build` once per call from the non-decrypting summary's saved base URL;
 *   `validateTarget` before any decrypt; then ONE `planFileWrite` and, unless the run was aborted,
 *   ONE `commitFiles` on the SAME provider object `build` returned with the EXACT plan it produced —
 *   never a rebuilt provider or a looser plan. Aborted → no commit.
 */
export interface CustomCredentialToolPorts {
  readonly credentialedRequest: CredentialedRequestPort;
  readonly sourceControlWrite: SourceControlWritePort;
}

/**
 * The project-key operations the saved-key card uses. Captured by the host for one site.
 * @agent-note `list` is read only inside the owner's human card; offer only what it returns.
 * @agent-note `permissionFor` names the permission that owns saving the chosen key; it is checked
 *   again after the human answers. `use` must re-resolve the key, refusing one revoked or deleted
 *   while the card was open. The site comes from host composition, never from submitted input.
 */
export interface CredentialCopyProjectKeysPort {
  readonly site?: { readonly name: string };
  list(required: Record<string, never>, optional?: Record<string, never>): Promise<readonly { readonly keyId: string; readonly name: string }[]>;
  permissionFor(required: { keyId: string }, optional?: Record<string, never>): Promise<string>;
  use(required: { keyId: string; use: boolean }, optional?: Record<string, never>): Promise<unknown>;
  savedResult(required: { result: unknown }, optional?: Record<string, never>): Promise<unknown>;
}

/** The saved-key card's words. Host text: no generic fallback exists.
 * @agent-note Supply every sentence, including owner/grant refusal and unexpected-field copy;
 * never reflect a secret value or widen the human-only inventory in a model-facing message. */
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
  readonly fieldLabel: string;
  readonly fieldPlaceholder: string;
  readonly newKeyLabel: string;
  readonly submitLabel: string;
  readonly cancelLabel: string;
}

/**
 * Everything a host supplies to `createCredentialCopyRegistrations`.
 * @agent-note `ownerPermission` is checked for the owner before the inventory opens and again after
 *   the human answers; `newKeyValue` is the answer value meaning "enter a new key" and must not be a
 *   possible key id. `cardPath` is the URI segment after the namespace; the exchange id follows it.
 * @agent-note `protocol.askThenReport` and `protocol.buildFormSurface` usually come from
 *   `@jini-ai/daemon/surface-exchanges` and `@jini-ai/ui/mcp-ui/surfaces`; the exchange store passed
 *   with them must be the SAME store the answer route delivers to.
 */
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
