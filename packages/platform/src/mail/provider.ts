/**
 * @file Mail provider contract + keyed registry (email provider contract v1, 2026-10-21).
 *
 * A provider is a {@link MailAdapterModule} that also names itself, declares the credential fields
 * it needs and its capabilities, and optionally parses delivery feedback and reports what a sending
 * domain must publish (SPF/DKIM/DMARC). Selection is explicit: the host stores
 * `mail.provider.{transactional,bulk}` and never picks "the first provider with a credential".
 */
import {
  createProviderRegistry,
  type DomainRequirement,
  type ProviderContext,
  type ProviderDefinition,
  type ProviderRegistry,
  type ProviderResult,
} from "@jini-ai/core/provider-registry";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { MailAdapterCredential, MailAdapterModule } from "./adapter-module.js";
import type { MailDeliveryLane } from "./ports.js";
import type { MailerFeedbackEvent } from "./types.js";

/** Provider token bucket: sustained rate plus burst. Absent = no provider-declared limit. */
export interface MailRateLimit {
  readonly perSecond: number;
  readonly burst: number;
}

export interface MailProviderCapabilities {
  /** False for local drivers (console): they never count as real delivery. */
  readonly hosted: boolean;
  /** True exactly when the module ships a {@link MailFeedbackParser}. */
  readonly feedback: boolean;
  /** True exactly when the module implements domainRequirements + domainStatus. */
  readonly domainVerification: boolean;
  readonly rateLimit?: MailRateLimit;
}

export interface MailFeedbackParser {
  /** Raw bytes in; never throws. Any of `secrets` may match so a webhook secret can rotate. */
  verify(required: {
    rawBody: Uint8Array; headers: Readonly<Record<string, string>>; secrets: readonly string[]; now: number;
  }): boolean;
  /** Each event must carry eventId + recipient, or the ingest drops it (no dedup key, no suppression key). */
  parse(required: { rawBody: Uint8Array; workspaceId: string }): readonly MailerFeedbackEvent[] | { error: string };
}

/** Per-call context: who the call acts for plus the host-resolved credential and guarded HTTP. */
export interface MailProviderCallContext extends ProviderContext {
  readonly credential: MailAdapterCredential;
  readonly httpClient: HttpClientPort;
}

export type MailDomainState = "verified" | "pending" | "failed" | "not_found";

export interface MailProviderModule extends MailAdapterModule {
  readonly id: string;
  readonly label: string;
  /** Credential fields the host must resolve (e.g. `token`, `username`, `baseUrl`). */
  readonly credentialKeys: readonly string[];
  /** Separate vault key for the webhook signing secret, so it rotates independently of the API key. */
  readonly webhookSecretKey?: string;
  readonly capabilities: MailProviderCapabilities;
  readonly feedback?: MailFeedbackParser;
  /** DNS records the provider needs before it will send as `domain`; satisfied through the DNS port. */
  domainRequirements?(ctx: MailProviderCallContext, required: { domain: string }): Promise<ProviderResult<DomainRequirement>>;
  domainStatus?(ctx: MailProviderCallContext, required: { domain: string }): Promise<ProviderResult<{ domain: string; state: MailDomainState }>>;
}

/** Shape check run by the registry for core and plugin registrations. @complexity O(k) keys. */
export function validateMailProvider({ provider }: { provider: MailProviderModule }): string | undefined {
  if (typeof provider !== "object" || provider === null) return "not an object";
  if (typeof provider.create !== "function") return "create() is missing";
  if (!Array.isArray(provider.credentialKeys) || !provider.credentialKeys.every((key) => typeof key === "string")) return "credentialKeys must be a string array";
  const caps = provider.capabilities;
  if (typeof caps !== "object" || caps === null) return "capabilities are missing";
  // A capability claim without the code behind it is how Resend once advertised feedback with no route.
  if (caps.feedback !== (provider.feedback !== undefined)) return "capabilities.feedback must match the presence of a feedback parser";
  const hasDomain = typeof provider.domainRequirements === "function" && typeof provider.domainStatus === "function";
  if (caps.domainVerification !== hasDomain) return "capabilities.domainVerification must match domainRequirements + domainStatus";
  return undefined;
}

export type MailProviderRegistry = ProviderRegistry<MailProviderModule>;

/** Mail registry over the shared keyed registry; built-ins throw on a bad registration, plugins are refused. */
export function createMailProviderRegistry(
  _required: Record<string, never> = {},
  optional: { builtins?: readonly MailProviderModule[] } = {},
): MailProviderRegistry {
  const seed: ProviderDefinition<MailProviderModule>[] = (optional.builtins ?? []).map((provider) => ({ id: provider.id, provider, label: provider.label }));
  return createProviderRegistry<MailProviderModule>({ contract: "mail" }, { validate: validateMailProvider, seed });
}

// ---------------------------------------------------------------------------------------------
// Selection setting + status.
// ---------------------------------------------------------------------------------------------

export const MAIL_PROVIDER_SETTING_KEY = "mail.provider";

/** One provider per lane; equal ids today, separable later without a data migration. null = unconfigured. */
export interface MailProviderSetting {
  readonly transactional: string | null;
  readonly bulk: string | null;
}

/**
 * The value written on first boot: whatever the host was effectively using, so a live site never
 * silently switches provider when selection becomes explicit. A local driver (console) or nothing
 * becomes `null` — the explicit `unconfigured` state, not a fake "working" default.
 */
export function initialMailProviderSetting(
  _required: Record<string, never>,
  optional: { effectiveProviderId?: string | null; registry?: MailProviderRegistry } = {},
): MailProviderSetting {
  const id = optional.effectiveProviderId ?? null;
  const hosted = id !== null && optional.registry?.get({ id })?.provider.capabilities.hosted === true;
  const value = hosted ? id : null;
  return { transactional: value, bulk: value };
}

export type MailLaneState = "ready" | "unconfigured" | "unknown_provider" | "missing_credential" | "local_only";

export interface MailLaneStatus {
  readonly lane: MailDeliveryLane;
  readonly providerId: string | null;
  readonly state: MailLaneState;
}

export type MailStatusWarning = "sender_unverified" | "sender_unknown";

export interface MailStatus {
  /** `unconfigured` drives the blocking admin banner; owner sign-in must never depend on mail. */
  readonly state: "ready" | "unconfigured" | "degraded";
  readonly lanes: readonly MailLaneStatus[];
  readonly warnings: readonly MailStatusWarning[];
}

function laneStatus(
  required: { lane: MailDeliveryLane; providerId: string | null; registry: MailProviderRegistry; hasCredential: (id: string) => boolean },
): MailLaneStatus {
  const { lane, providerId, registry } = required;
  if (providerId === null) return { lane, providerId, state: "unconfigured" };
  const entry = registry.get({ id: providerId });
  if (!entry) return { lane, providerId, state: "unknown_provider" };
  if (!entry.provider.capabilities.hosted) return { lane, providerId, state: "local_only" };
  return { lane, providerId, state: required.hasCredential(providerId) ? "ready" : "missing_credential" };
}

/** Pure status projection for `mail_status` and the admin banner. @complexity O(lanes). */
export function computeMailStatus(
  required: { setting: MailProviderSetting; registry: MailProviderRegistry; hasCredential: (id: string) => boolean },
  optional: { senderDomainState?: MailDomainState | null } = {},
): MailStatus {
  const { setting, registry, hasCredential } = required;
  const lanes = (["transactional", "bulk"] as const).map((lane) => laneStatus({ lane, providerId: setting[lane], registry, hasCredential }));
  const warnings: MailStatusWarning[] = [];
  const domain = optional.senderDomainState;
  if (domain === null) warnings.push("sender_unknown");
  else if (domain !== undefined && domain !== "verified") warnings.push("sender_unverified");
  const ready = lanes.filter((status) => status.state === "ready").length;
  const state = ready === lanes.length ? "ready" : lanes[0]!.state === "unconfigured" ? "unconfigured" : "degraded";
  return { state, lanes, warnings };
}
