/**
 * @file Where the feedback route finds a provider's parser and webhook secrets.
 *
 * Parsers come from the provider module's `.feedback` (Jini `MailProviderModule`), read off the
 * plugin mail-adapter registry until the composition hands over a provider registry. Secrets live
 * in the custom-credentials vault under fixed labels, one per provider, plus a `(previous)` label so
 * a secret can rotate without dropping in-flight webhooks: save the new one as current, keep the old
 * one as previous until the provider stops signing with it, then delete it.
 */
import type { MailFeedbackParser } from "./provider.js";

/** Reads one saved vault credential by label (the host's custom-credentials store); `null` = not saved. */
export type MailWebhookSecretResolver<Credentials> = (
  credentials: Credentials,
  input: { workspaceId: string; label: string },
) => Promise<{ connection: { token: string } } | null>;

/** The registry shape this needs (`MailAdapterRegistry` structurally); modules are untrusted values. */
export interface MailAdapterSource {
  list(): readonly { readonly descriptor: { readonly id: string; readonly label: string }; readonly module: unknown }[];
}

/** Vault labels for a provider's webhook signing secret: current first, then the rotation slot.
 * `labelPrefix` is the host's product label; stored labels are persisted, so it never changes. */
export function mailWebhookSecretLabels({ providerLabel, labelPrefix }: { providerLabel: string; labelPrefix: string }): readonly [string, string] {
  const current = `${labelPrefix} — ${providerLabel} Webhook Secret`;
  return [current, `${current} (previous)`];
}

function asParser({ module }: { module: unknown }, _optional = {}): MailFeedbackParser | undefined {
  const feedback = (module as { feedback?: Partial<MailFeedbackParser> } | null | undefined)?.feedback;
  return typeof feedback?.verify === "function" && typeof feedback.parse === "function" ? (feedback as MailFeedbackParser) : undefined;
}

/**
 * Parser and label lookups over a freshly loaded adapter registry.
 * @complexity O(a) adapters per lookup, plus one registry load.
 */
export function createPluginMailFeedbackSources(required: { loadAdapters: () => Promise<MailAdapterSource> }) {
  const find = async ({ providerId }: { providerId: string }) =>
    (await required.loadAdapters()).list().find((adapter) => adapter.descriptor.id === providerId);
  return {
    parserFor: async ({ providerId }: { providerId: string }): Promise<MailFeedbackParser | undefined> => asParser({ module: (await find({ providerId }))?.module }),
    labelFor: async ({ providerId }: { providerId: string }): Promise<string | undefined> => (await find({ providerId }))?.descriptor.label,
  };
}

/**
 * `secretsFor` over the vault: the current then previous secret that are saved, in that order.
 * A vault read failure propagates (the route answers 500 and the provider retries).
 * @complexity Two label lookups per call.
 */
export function createVaultMailWebhookSecrets<Credentials>(
  required: {
    credentials: Credentials;
    workspaceId: string;
    labelFor: (required: { providerId: string }) => Promise<string | undefined>;
    /** The host's vault reader and label prefix (see {@link mailWebhookSecretLabels}). */
    resolveByLabel: MailWebhookSecretResolver<Credentials>;
    labelPrefix: string;
  },
  _optional: Record<string, never> = {},
) {
  const resolveByLabel = required.resolveByLabel;
  return async ({ providerId }: { providerId: string }): Promise<readonly string[]> => {
    const providerLabel = await required.labelFor({ providerId });
    if (providerLabel === undefined) return [];
    const secrets: string[] = [];
    for (const label of mailWebhookSecretLabels({ providerLabel, labelPrefix: required.labelPrefix })) {
      const saved = await resolveByLabel(required.credentials, { workspaceId: required.workspaceId, label });
      if (saved && saved.connection.token !== "") secrets.push(saved.connection.token);
    }
    return secrets;
  };
}
