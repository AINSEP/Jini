import type { ProviderResult } from "@jini-ai/core/provider-registry";
import { credentialSecrets, safeMailProviderText } from "./provider-error.js";
import type { MailAdapterCredential } from "./adapter-module.js";
import type { MailProviderCallContext, MailProviderModule } from "./provider.js";

import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { SenderDomainVerification, SenderDomainVerificationPort } from "./engine-contracts.js";
import { isDomainReadPermissionRefused, readMailDomain, type MailDomainReadCredentialPort } from "./domain-read.js";

/**
 * @file The sender domain's state at the active transactional provider (its own `domainStatus`),
 * for callers that need the provider verdict. Kept apart from the DNS
 * check on purpose: a provider can report `pending` after every record resolves, and DNS can match
 * while the provider was never asked. Each reason the provider cannot be asked is named apart, so
 * "DNS verification unavailable for this provider" is a state of its own, not a failure.
 */
export interface SenderDomainVerificationDeps {
  workspaceId: string;
  /** The host's guarded outbound-HTTP seam, handed through to the provider. */
  httpClient: HttpClientPort;
  /** The installed providers, read fresh (host catalog). */
  findProvider: (required: { id: string }) => Promise<MailProviderModule | undefined>;
  /** The provider's saved key, or `null` when none is saved (host credential resolver). */
  resolveCredential: (required: { id: string }) => Promise<MailAdapterCredential | null>;
  resolveDomainReadCredential?: MailDomainReadCredentialPort;
  /** The configured transactional lane. */
  readProviderId: () => Promise<string | null>;
  /** The configured sender address. */
  readSenderEmail: () => Promise<string | undefined>;
}

/** The configured sender's domain, lower-cased; undefined when unset or unreadable.
 * @complexity O(n) time and space in the sender address length; one settings read. */
async function senderDomain(deps: SenderDomainVerificationDeps): Promise<string | undefined> {
  const email = await deps.readSenderEmail().catch(() => undefined);
  return email?.split("@")[1]?.trim().toLowerCase() || undefined;
}

/** Read domain status, trying the plugin's account on permission refusal; failures stay `unknown`.
 * @complexity At most two provider reads and two key lookups; diagnostic output is capped at 1000 characters. */
async function askProvider(required: { deps: SenderDomainVerificationDeps; provider: MailProviderModule; providerId: string; domain: string }): Promise<SenderDomainVerification> {
  const { deps, provider, providerId, domain } = required;
  const credential = await deps.resolveCredential({ id: providerId }).catch(() => null);
  if (!credential) return { state: "unknown", domain, providerId, reason: "the provider's key is not saved" };
  // Same call context `resolve-mailer.ts` builds for a provider call: this workspace, live, its key.
  const ctx: MailProviderCallContext = { workspaceId: deps.workspaceId, mode: "live", credential, httpClient: deps.httpClient };
  const result = await readMailDomain({ ctx, providerId, read: context => provider.domainStatus!(context, { domain }), ...(deps.resolveDomainReadCredential ? { resolveDomainReadCredential: deps.resolveDomainReadCredential } : {}) }).catch(() => null);
  if (result?.status === "ok") return { state: result.value.state, domain, providerId };
  return { state: "unknown", domain, providerId, reason: providerReadFailureReason({ result, credential }) };
}

/** A refusal both keys hit is named plainly; any other provider answer keeps its code+message,
 * secret-redacted (the sending key's exact values plus Jini's patterns) and capped.
 * @complexity O(n) diagnostic text plus credential values; output is capped at 1000 characters.
 */
function providerReadFailureReason(required: { result: Exclude<ProviderResult<unknown>, { status: "ok" }> | null; credential: MailAdapterCredential }): string {
  const { result, credential } = required;
  if (!result) return "the provider did not answer the domain check";
  if (isDomainReadPermissionRefused({ result })) return "the sending key can't check domains, and no connected account could check it either";
  return safeMailProviderText({ text: `${result.error.code}: ${result.error.message}` }, { secrets: credentialSecrets({ credential }) });
}

/** Resolve the configured sender against its provider, independently of DNS answers.
 * Settings start together; catalog and credential reads follow in their original await order.
 * @complexity Two settings reads, one catalog lookup and at most two provider reads; O(1) space.
 */
async function checkSenderDomain(deps: SenderDomainVerificationDeps): Promise<SenderDomainVerification> {
  const [providerId, domain] = await Promise.all([deps.readProviderId().catch(() => null), senderDomain(deps)]);
  if (!domain) return { state: "no_sender", providerId };
  const provider = providerId === null ? undefined : await deps.findProvider({ id: providerId }).catch(() => undefined);
  if (!provider) return { state: "no_provider", domain, providerId };
  const id = providerId!;
  if (!provider.domainStatus) return { state: "unsupported", domain, providerId: id };
  return askProvider({ deps, provider, providerId: id, domain });
}

/**
 * Build the never-throwing provider-verdict port. Lookup failures become explicit verdicts;
 * the deadline covers the whole check and clears its timer without cancelling provider work.
 * @complexity Per call: two settings reads, one catalog load, at most two key lookups and two provider calls; O(1) space.
 * @example createSenderDomainVerification(deps)()
 */
export function createSenderDomainVerification(required: SenderDomainVerificationDeps, options: { timeoutMs?: number } = {}): SenderDomainVerificationPort {
  return async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SenderDomainVerification>(resolve => {
      timer = setTimeout(() => resolve({ state: "unknown", providerId: null, reason: "provider_domain_check_timed_out" }), options.timeoutMs ?? 5_000);
    });
    try { return await Promise.race([checkSenderDomain(required), timeout]); } finally { clearTimeout(timer); }
  };
}
