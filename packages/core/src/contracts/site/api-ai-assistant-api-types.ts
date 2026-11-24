/**
 * @file Admin wire shapes for the AI Assistant settings screen: the two stored assistant provider
 * credentials — the site's (answers anonymous visitors) and one admin's own (powers that admin's
 * execution BYOK), both write-only by design — plus the detected-agent list, the public assistant
 * switch and the visitor-tools view. The host's stores produce them and its admin client reads them.
 */
import type { CredentialTokenHint } from "./secrets-credential-token.js";

/**
 * Mirrors the host's site credential store view (`SiteAssistantCredentialView`) — the SITE's
 * provider credential, the one a DEPLOYED server uses to answer anonymous visitors.
 *
 * Write-only by design: there is no field here that could carry key material back to the browser,
 * and that is the point rather than an omission. `isSet` answers "is a key stored", `masked` answers
 * "which one" (last 4 characters behind `••••`), and neither is reversible. If a future route ever
 * needs to return the key itself, it needs its own type — do not widen this one.
 */
export interface SiteAssistantCredential {
  isSet: boolean;
  masked: string | null;
  tokenHint?: CredentialTokenHint | null;
  provider: string;
  baseUrl: string | null;
  model: string | null;
  updatedAt: string | null;
}

/** PUT body for the site credential. Every field is optional and OMITTED MEANS "leave alone" — an
 *  absent `apiKey` preserves the stored key, which is what lets a caller persist a model or base-URL
 *  change without re-sending the secret. An empty-string `apiKey` is REJECTED by the server (400);
 *  clearing the key is the host's delete call, not an empty PUT. */
export interface SiteAssistantCredentialPatch {
  apiKey?: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Mirrors the host's execution credential store view (`AdminExecutionCredentialView`) — the
 * ADMIN's OWN BYOK credential, scoped to `(workspace, this admin)`. A DIFFERENT credential from
 * {@link SiteAssistantCredential} (that one is per-workspace and answers anonymous visitors; this
 * one is per-admin and only ever powers this admin's own dock/Execution-mode BYOK). The host's
 * execution credential store documents why the two must never merge.
 *
 * Write-only by design, same as `SiteAssistantCredential`: no field here can carry key material
 * back to the browser. `protocol`/`providerId`/`baseUrl`/`model`/`maxTokens` mirror `ByokConfig`
 * (minus `apiKey`/`savedByProviderId`) so the stored view maps onto the form with no translation.
 */
export interface AdminExecutionCredential {
  isSet: boolean;
  masked: string | null;
  tokenHint?: CredentialTokenHint | null;
  protocol: string;
  providerId: string | null;
  baseUrl: string | null;
  model: string | null;
  maxTokens: number | null;
  updatedAt: string | null;
}

/** PUT body for the admin's own execution credential. Same "omitted means leave alone, empty
 *  `apiKey` is rejected" contract as {@link SiteAssistantCredentialPatch} — see that type's doc. */
export interface AdminExecutionCredentialPatch {
  apiKey?: string;
  protocol?: string;
  providerId?: string | null;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
}

/** Mirrors `@jini-ai/ui`'s `ExecutionTab` `DetectedAgent` shape — see the host's detect-agents
 *  admin route and its `toExecutionTabAgent` projection.
 *
 *  Each model's `reasoning` mirrors `@jini-ai/agent-runtime`'s `RuntimeModelOption.reasoning`
 *  (`packages/agent-runtime/src/types.ts` in Jini) — a model's OWN effort levels, narrowed to
 *  `{id,label}` the same way every other field on this interface narrows its Jini counterpart.
 *  `undefined` means the runtime doesn't report per-model levels for this agent (Codex today);
 *  it is never defaulted to `[]`, which would misreport "unknown" as "this model supports zero" —
 *  see `toExecutionTabAgent`'s `projectModelReasoning` for the same rule on the wire side. No
 *  `@jini-ai/ui` picker reads this yet; it exists so a future one can narrow the "Reasoning effort"
 *  control to the SELECTED model instead of `reasoningOptions`' agent-wide union. */
export interface AdminExecutionDetectedAgent {
  discoveryPending?: boolean;
  id: string;
  label: string;
  installed: boolean;
  version?: string;
  path?: string;
  models?: Array<{ id: string; label: string; reasoning?: Array<{ id: string; label: string }> }>;
  modelsSource?: "live" | "fallback";
  reasoningOptions?: Array<{ id: string; label: string }>;
  reasoningInModelId?: { levels: Array<{ id: string; label: string }> };
  authStatus?: "ok" | "missing" | "unknown";
  authMessage?: string;
}

/**
 * Mirrors the host's public assistant settings module's `PublicAssistantSettings`.
 *
 * `publicEnabled: false` is a hard off — the public page ships no assistant bundle and exposes no
 * assistant endpoint. It is NOT a client-side visibility flag, and nothing in this admin app should
 * ever treat it as one; see that module's header for the contract in full.
 */
export interface PublicAssistantSettings {
  publicEnabled: boolean;
  /** Optional while older servers and cached responses still carry only the switch. */
  widget?: "react" | "vanilla";
}

/** The one owner of the visitor-tools management view `VisitorToolsView`: the host's management
 * service returns it and the admin page reads it.
 * The admin page and the assistant chat's `visitor_tools_list` read the same service, so this shape
 * is the server's, field for field. `policyState: "invalid"` means the saved policy is unreadable and
 * every tool is effectively Off until the site-wide Off repair succeeds. */
export type VisitorToolMode = "auto" | "ask" | "off";
export interface VisitorToolLimits { perIpPerHour: number; perSitePerDay: number }
export interface VisitorToolView {
  id: string;
  source: "builtin" | "plugin" | "created" | "unavailable";
  sourceRevision: string;
  title: string;
  description: string;
  displayTitle?: string;
  displayDescription?: string;
  effect: "read" | "write";
  availability: { available: boolean; reason?: string };
  publication?: { endpoint: string; credentialId: string; returnedFields: readonly string[] };
  mode: VisitorToolMode;
  limits: VisitorToolLimits;
}
export interface VisitorToolsView {
  revisionSeq: number;
  /** Unreadable stored policy: every catalog tool is Off; only a site-wide Off reset is accepted. */
  policyState?: "invalid";
  defaults: VisitorToolLimits;
  callsPerTurn: number;
  tools: VisitorToolView[];
}
/** `toolId: "site"` patches every available tool at once (the invalid-policy repair uses it). */
export interface VisitorToolConfigureInput {
  toolId: string;
  expectedRevisionSeq: number;
  mode?: VisitorToolMode;
  limits?: Partial<VisitorToolLimits>;
}
export interface VisitorToolsPort {
  list(required: Record<string, never>, optional?: Record<string, never>): Promise<VisitorToolsView>;
  configure(required: VisitorToolConfigureInput, optional?: Record<string, never>): Promise<VisitorToolsView>;
}

/** The BYOK model-discovery probe's answer: only the discovered model ids, plus a message when the
 * provider (or the host's empty-key copy) gave one. */
export interface AdminExecutionListModelsResponse { ok: boolean; models: string[]; message?: string }

/** The BYOK connection probe's answer: a failed probe is a 200 with `ok: false`, never an HTTP error. */
export interface AdminExecutionTestConnectionResponse { ok: boolean; message: string }
