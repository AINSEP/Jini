import type { MailRateLimit, MailProviderCapabilities, MailFeedbackParser, MailProviderCallContext, MailDomainState, MailProviderModule, MailProviderRegistry, MailProviderSetting, MailLaneState, MailLaneStatus, MailStatusWarning, MailStatus } from '@jini-ai/core/contracts/mail';
export type { MailRateLimit, MailProviderCapabilities, MailFeedbackParser, MailProviderCallContext, MailDomainState, MailProviderModule, MailProviderRegistry, MailProviderSetting, MailLaneState, MailLaneStatus, MailStatusWarning, MailStatus } from '@jini-ai/core/contracts/mail';
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

/** Shape check run by the registry for core and plugin registrations. @complexity O(k) keys. */
export function validateMailProvider({ provider }: { provider: MailProviderModule }): string | undefined {
  if (typeof provider !== "object" || provider === null) return "not an object";
  if (typeof provider.create !== "function") return "create() is missing";
  if (!Array.isArray(provider.credentialKeys) || !provider.credentialKeys.every((key) => typeof key === "string")) return "credentialKeys must be a string array";
  const caps = provider.capabilities;
  if (typeof caps !== "object" || caps === null) return "capabilities are missing";
  // A capability claim without the code behind it is how Resend once advertised feedback with no route.
  if (caps.feedback !== (provider.feedback !== undefined)) return "capabilities.feedback must match the presence of a feedback parser";
  const hasDomain = hasDomainVerification(provider);
  if (caps.domainVerification !== hasDomain) return "capabilities.domainVerification must match domainRequirements + domainStatus";
  return undefined;
}

function hasDomainVerification(provider: MailProviderModule): boolean {
  return typeof provider.domainRequirements === "function" && typeof provider.domainStatus === "function";
}

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
  const senderWarning = senderDomainWarning(optional.senderDomainState);
  const warnings: MailStatusWarning[] = senderWarning === undefined ? [] : [senderWarning];
  return { state: overallMailState(lanes), lanes, warnings };
}

function senderDomainWarning(domain: MailDomainState | null | undefined): MailStatusWarning | undefined {
  if (domain === null) return "sender_unknown";
  if (domain === undefined || domain === "verified") return undefined;
  return "sender_unverified";
}

function overallMailState(lanes: readonly { state: string }[]): "ready" | "unconfigured" | "degraded" {
  if (lanes.every((status) => status.state === "ready")) return "ready";
  return lanes[0]!.state === "unconfigured" ? "unconfigured" : "degraded";
}
