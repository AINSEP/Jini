import { FormDeliveryError, type FormDeliveryJob, type FormDeliveryResult } from "../index.js";
import type { FormDestinationKit, FormDestinationPluginState, FormDestinationRegistry } from "../index.js";
import type { FormDeliveryConnectionPort, FormDestinationCredential } from "@jini-ai/core/contracts/site/cms-forms";
import { orFallback } from "@jini-ai/core/errors/idioms";

/**
 * @file The host half of one push-delivery attempt: find the binding's adapter among the loaded
 * form destinations, resolve its credential, and call the adapter's `deliver` with the frozen job.
 * Retries, attempt caps and error sanitising belong to the outbox worker and Jini's
 * `deliverFormJob`, which wraps this function; refusals here use the same safe error codes.
 *
 * The adapter gets a kit bound to the attempt's credential: its `fetch` reaches only the
 * credential's saved hosts, the rule `custom_credential_make_request` enforces, so a plugin handed
 * a credential cannot send it (or the answers) to any other origin through the kit.
 */

/**
 * The host's request-target check, restated structurally so this package needs no dependency on
 * the integrations package that owns it (the host passes `resolveRequestTarget` from there). It
 * must resolve the described credential's origins and reject a URL outside them.
 */
export type ResolveRequestTarget = (required: {
  resolver: { describe: (required: { workspaceId: string; label: string }) => Promise<{ baseUrl: string; additionalHosts: readonly string[] } | null> };
  input: { workspaceId: string; label: string; url: unknown };
}) => Promise<unknown>;

/**
 * Builds the `deliver` port `createFormDeliverySubscriptions` calls once per attempt.
 * @param required.resolveRequestTarget - The host's custom-credential make-request host check
 *   (exact origin match on `baseUrl` + `additionalHosts`); it must reject any URL outside them.
 * @throws FormDeliveryError `adapter-unavailable` (retryable: the plugin may be re-enabled) when no
 *   loaded destination with the binding's adapter id has `deliver`; `authorization-required`
 *   (non-retryable) when the connection port finds no credential. The adapter's `kit.fetch` rejects
 *   with `configuration-invalid` (non-retryable) for a URL outside the credential's saved hosts.
 * @param optional.pluginState - The read-only settings of a plugin in a workspace; when given, each
 *   adapter receives its own plugin's as `optional.state` (so a product turned off pauses delivery).
 * @complexity One registry load and one credential resolution per attempt, then the adapter's own cost.
 */
export function createFormDestinationDeliverer(
  required: {
    loadRegistry: (required: { workspaceId: string }) => Promise<FormDestinationRegistry>;
    connections: FormDeliveryConnectionPort;
    kit: FormDestinationKit;
    resolveRequestTarget: ResolveRequestTarget;
  },
  optional: { pluginState?: (required: { workspaceId: string; pluginId: string }) => FormDestinationPluginState } = {},
): (required: { workspaceId: string; job: FormDeliveryJob }) => Promise<FormDeliveryResult | void> {
  return async ({ workspaceId, job }) => {
    const { binding } = job;
    const adapter = (await required.loadRegistry({ workspaceId })).get(binding.adapterId);
    if (!adapter?.module.deliver) throw new FormDeliveryError({ code: "adapter-unavailable", retryable: true });
    // Resolved on every attempt and passed only to the adapter, so rotation and revocation apply at once.
    const credential = await required.connections({ workspaceId, connectionRef: binding.connectionRef, adapterId: binding.adapterId }, { binding });
    if (!credential) throw new FormDeliveryError({ code: "authorization-required", retryable: false });
    const kit = credentialScopedKit({ kit: required.kit, credential, workspaceId, connectionRef: binding.connectionRef, resolveRequestTarget: required.resolveRequestTarget });
    const state = optional.pluginState?.({ workspaceId, pluginId: adapter.pluginId });
    return adapter.module.deliver({ kit, credential, ...job.snapshot, binding, idempotencyKey: job.idempotencyKey }, state ? { state } : {});
  };
}

/**
 * The kit one attempt's adapter receives. Only the members `FormDestinationKit` names are passed on:
 * the host kit's other network helpers take any URL and would let a plugin carry the credential out
 * in a query string. Each `fetch` URL goes through the custom-credential make-request host check
 * (exact origin match on `baseUrl` + `additionalHosts`, http/https only, no `user:pass@`) before any
 * network call. The credential's own saved state is the allowlist; nothing the adapter sends widens it.
 * @complexity O(saved hosts) per fetch, before the host kit's own cost.
 */
function credentialScopedKit(required: { kit: FormDestinationKit; credential: FormDestinationCredential; workspaceId: string; connectionRef: string; resolveRequestTarget: ResolveRequestTarget }): FormDestinationKit {
  const { kit, credential, workspaceId, connectionRef, resolveRequestTarget } = required;
  const target = { baseUrl: credential.baseUrl, additionalHosts: credential.additionalHosts ?? [] };
  const fetch: FormDestinationKit["fetch"] = async (url, init, options) => {
    const allowed = await orFallback({
      work: async () => { await resolveRequestTarget({ resolver: { describe: async () => target }, input: { workspaceId, label: connectionRef, url } }); return true; },
      fallback: false,
      step: "form delivery request target",
    });
    // The resolver above cannot fail, so every refusal is the host check's. Its message names the
    // URL, which may carry answers; only the safe code leaves this function.
    if (!allowed) throw new FormDeliveryError({ code: "configuration-invalid", retryable: false, outcome: "not-applied" });
    return kit.fetch(url, init, options);
  };
  const now = kit.now?.bind(kit);
  return { fetch, timeouts: kit.timeouts, ...(now ? { now: () => now() } : {}) };
}
