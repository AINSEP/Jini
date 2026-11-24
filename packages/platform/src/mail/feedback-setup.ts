/**
 * @file **Feedback setup** (email phase 5) behind `mail_get_feedback_setup` and
 * `GET system/mail-feedback`: for each active provider, whether it can report deliveries, bounces
 * and complaints, the webhook URL to paste into the provider, whether its signing secret is saved
 * (current and previous rotation slots, `features/mail/feedback-sources.ts`), and the newest
 * verified event.
 *
 * Presence only: the secret slots are read from the credential list by label, never decrypted, so
 * this read cannot leak or even touch a secret. "No events yet" (`no_events_yet`) is reported apart
 * from healthy ingestion (`receiving`), because a webhook nobody has called looks the same as a
 * broken one until the first event arrives.
 */
import type {
  OriginRegistryPort,
  VerifiedOrigin,
} from "@jini-ai/core/contracts/server/verified-origin";
import type { MailProviderConfiguration } from "@jini-ai/core/contracts/mail";
import type { MailSuppressionAdminRepo } from "@jini-ai/core/contracts/site/platform-mail";
import type { MailProviderControl } from "./mail-status.js";
import type { MailFeedbackProviderSetup, MailFeedbackSetupReport, MailWebhookSecretSlot } from "@jini-ai/core/contracts/site/platform-mail";

export interface MailFeedbackSetupDeps<TCredentialRepo = unknown> {
  workspaceId: string;
  mailProviderControl?: Pick<MailProviderControl, "describe">;
  /** The host's credential store, handed back to {@link MailFeedbackSetupDeps.listCustomCredentials}. */
  customCredentialSetRepo?: TCredentialRepo;
  originRegistry?: Pick<OriginRegistryPort, "canonicalOrigin">;
  mailSuppressionAdmin?: Pick<MailSuppressionAdminRepo, "lastFeedbackEvent">;
  /** Host: safe summaries (label + update time, never a secret) of the saved credentials. */
  listCustomCredentials(deps: { repo: TCredentialRepo }, input: { workspaceId: string }): Promise<readonly { label: string; updatedAt: string }[]>;
  /** Host: the persisted current/previous signing-secret labels for a provider (product-prefixed). */
  mailWebhookSecretLabels(required: { providerLabel: string }): readonly [string, string];
}

/** Mirrors `features/newsletter/confirmation.ts`'s private `composeOriginUrl` (default ports elided). */
function originUrl(origin: VerifiedOrigin, _options: Record<string, never> = {}): string {
  const matchesDefaultPort = (origin.scheme === "https" && origin.port === 443) || (origin.scheme === "http" && origin.port === 80);
  const isDefaultPort = origin.port === undefined || matchesDefaultPort;
  const authority = isDefaultPort ? origin.host : `${origin.host}:${origin.port}`;
  return `${origin.scheme}://${authority}${origin.basePath ?? ""}`;
}

async function siteOrigin(deps: MailFeedbackSetupDeps, _options: Record<string, never> = {}): Promise<string | null> {
  if (!deps.originRegistry) return null;
  try {
    return originUrl(await deps.originRegistry.canonicalOrigin({ workspaceId: deps.workspaceId }));
  } catch {
    return null;
  }
}

function slot({ label, saved }: { label: string; saved: Map<string, string> }, _options: Record<string, never> = {}): MailWebhookSecretSlot {
  return { label, configured: saved.has(label), updatedAt: saved.get(label) ?? null };
}

function stateOf(setup: Pick<MailFeedbackProviderSetup, "supported" | "signingSecret" | "lastVerifiedEvent">, _options: Record<string, never> = {}): MailFeedbackProviderSetup["state"] {
  if (!setup.supported) return "unsupported";
  if (!setup.signingSecret?.current.configured && !setup.signingSecret?.previous.configured) return "secret_missing";
  return setup.lastVerifiedEvent ? "receiving" : "no_events_yet";
}

async function providerSetup({ deps, provider, context }: { deps: MailFeedbackSetupDeps; provider: MailProviderConfiguration; context: { origin: string | null; saved: Map<string, string> } }, _optional = {}): Promise<MailFeedbackProviderSetup> {
  const supported = provider.capabilities.feedback;
  const webhookPath = `/hooks/mail/${encodeURIComponent(provider.id)}`;
  const [current, previous] = deps.mailWebhookSecretLabels({ providerLabel: provider.label });
  const signingSecret = supported ? { current: slot({ label: current, saved: context.saved }), previous: slot({ label: previous, saved: context.saved }) } : null;
  const lastVerifiedEvent = supported && deps.mailSuppressionAdmin ? await deps.mailSuppressionAdmin.lastFeedbackEvent({ workspaceId: deps.workspaceId, providerId: provider.id }) : null;
  const setup = { providerId: provider.id, label: provider.label, lanes: provider.lanes, supported, webhookPath,
    webhookUrl: supported && context.origin ? `${context.origin}${webhookPath}` : null, signingSecret, lastVerifiedEvent };
  return { ...setup, state: stateOf(setup) };
}

/**
 * Feedback setup for every provider that currently sends for a lane.
 * @complexity One provider describe, one credential list, one origin read and one inbox probe per provider.
 * @example await readMailFeedbackSetup(deps)
 */
export async function readMailFeedbackSetup(deps: MailFeedbackSetupDeps, _options: Record<string, never> = {}): Promise<MailFeedbackSetupReport> {
  if (!deps.mailProviderControl?.describe) return { available: false, providers: [] };
  const report = await deps.mailProviderControl.describe();
  const active = report.providers.filter((provider) => provider.lanes.length > 0);
  const records = deps.customCredentialSetRepo ? await deps.listCustomCredentials({ repo: deps.customCredentialSetRepo }, { workspaceId: deps.workspaceId }) : [];
  const saved = new Map(records.map((record) => [record.label, record.updatedAt] as const));
  const origin = await siteOrigin(deps);
  return { available: true, providers: await Promise.all(active.map((provider) => providerSetup({ deps, provider, context: { origin, saved } }))) };
}
