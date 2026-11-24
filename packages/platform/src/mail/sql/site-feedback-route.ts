/** @file The site's mail feedback route from its content kernel, vault and plugin mail adapters. */
import { createMailFeedbackInboxRepo } from "./feedback-inbox.repo.js";
import { createMailFeedbackRoute, type MailFeedbackRoute } from "../feedback-route.js";
import { createPluginMailFeedbackSources, createVaultMailWebhookSecrets, type MailAdapterSource, type MailWebhookSecretResolver } from "../feedback-sources.js";
import type { MailSqlKernel } from "./ledger.repo.js";
import { createMailSuppressionRepo } from "./suppression.repo.js";

/**
 * One composition call for the composition roots, so they add a single line. Parsers come from the
 * plugin mail-adapter registry until a mail provider registry exists (see `feedback-sources.ts`).
 * The host passes its vault reader and the product label prefix of its persisted secret labels.
 * @example createSiteMailFeedbackRoute({ db: kernel, workspaceId, credentials: { repo, sealer }, loadAdapters, resolveByLabel, labelPrefix })
 */
export function createSiteMailFeedbackRoute<DB, Credentials>(required: {
  db: MailSqlKernel<DB>;
  workspaceId: string;
  credentials: Credentials;
  loadAdapters: () => Promise<MailAdapterSource>;
  resolveByLabel: MailWebhookSecretResolver<Credentials>;
  labelPrefix: string;
}): MailFeedbackRoute {
  const { db, workspaceId, credentials, loadAdapters, resolveByLabel, labelPrefix } = required;
  const sources = createPluginMailFeedbackSources({ loadAdapters });
  return createMailFeedbackRoute({
    parserFor: sources.parserFor,
    secretsFor: createVaultMailWebhookSecrets({ credentials, workspaceId, labelFor: sources.labelFor, resolveByLabel, labelPrefix }),
    repos: { inbox: createMailFeedbackInboxRepo({ db }), suppression: createMailSuppressionRepo({ db }) },
    resolveWorkspaceId: () => workspaceId,
  });
}
