import type { SendPipelineDeps } from "./send-pipeline.js";
import type { NewsletterToolDeps } from "./tool-registrations.js";

/**
 * Assembles `send-pipeline.ts`'s deps bundle — the local twin of `toCampaignWriteServiceDeps` above.
 * The optional launch-setting binding defaults to false, preserving the admin routes' existing
 * fail-closed behavior. Runtime composition still has no sending toggle or consent binding.
 */
export function toNewsletterSendPipelineDeps(deps: NewsletterToolDeps, _optional: Record<string, never> = {}): SendPipelineDeps {
  return deps.buildSendPipelineDeps({ deps, isSendingEnabled: deps.newsletterSendingEnabled ?? (async () => false) });
}
