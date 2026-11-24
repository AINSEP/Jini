import { createSourceControlProviderKit as createKit } from "../kit.js";
import type { SourceControlKitHttpClient, SourceControlProviderKit } from "./provider-module.js";

/**
 * @file Builds the {@link SourceControlProviderKit} core hands a git-host provider module
 * (`provider-module.ts`). The kit is the module's only way to reach anything but Node builtins.
 */

/** What the host supplies so the kit can describe and trace its own transport. */
export interface SourceControlKitHost {
  /** Describes a transport failure: the caller-safe `refusal` text when `error` is the host's egress-policy refusal
   *  (else `undefined`), and the redacted `logDetail` the host wants logged. The kit passes the raw error, never formats it. */
  describeTransportError(required: { error: unknown }): { readonly refusal: string | undefined; readonly logDetail: string };
  /** Wraps the raw `fetch` so each `kit.fetch` is recorded as one outbound span (host/status only). Absent: untraced. */
  observeFetch?(required: { fetch: typeof fetch }): typeof fetch;
}

/** Stands in when a caller has no guarded HTTP client (the admin credential form only probes an
 *  account name, through `fetch`). A call through it fails as a transport error, never silently. */
const NO_HTTP_CLIENT: SourceControlKitHttpClient = {
  send: () => Promise.reject(new Error("no outbound HTTP client is wired for this call")),
};

/**
 * @param required.host - The host's transport-failure describer and optional fetch tracer.
 *   The guarded `httpClient` is traced where it is built, not here.
 * @param optional.httpClient - The guarded client for credentialed custom-credential calls, handed
 *   to the module as-is (it already speaks the module's positional ABI).
 * @param optional.fetchFn - Replaces global `fetch` (tests); otherwise `fetch` is looked up per call.
 * @param optional.sleep - Replaces the retry timer (tests).
 * @complexity O(1).
 */
export function createSourceControlProviderKit(
  required: { readonly host: SourceControlKitHost },
  optional: { readonly httpClient?: SourceControlKitHttpClient; readonly fetchFn?: typeof fetch; readonly sleep?: (ms: number) => Promise<void> } = {},
): SourceControlProviderKit {
  const { host } = required;
  const send = (url: string, init: RequestInit) => (optional.fetchFn ?? fetch)(url, init);
  const httpClient = optional.httpClient ?? NO_HTTP_CLIENT;
  const kit = createKit({ httpClient: { send: ({ request }) => httpClient.send(request) },
    fetch: ({ url }, options = {}) => (host.observeFetch ? host.observeFetch({ fetch: send as typeof fetch }) : send)(url, options.init ?? {}),
    describeTransportError: ({ error }) => host.describeTransportError({ error }),
  }, { fetchRedirectPolicy: "caller" });
  return {
    repositoryPaths: kit.repositoryPaths,
    // why: positional on purpose: the plugin module ABI (see SourceControlProviderKit).
    fetch: (url, init) => kit.fetch({ url, init }),
    redirectGuardInit: init => kit.redirectGuardInit({ init }),
    assertNotRedirected: (response, hostName) => kit.assertNotRedirected({ response, hostName }),
    isRedirectRefusal: error => kit.isRedirectRefusal({ error }),
    httpClient,
    describeTransportError: error => kit.describeTransportError({ error }),
    sleep: optional.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
  };
}
