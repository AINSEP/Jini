import { setTimeout as sleep } from "node:timers/promises";

import {
  DeployError as DevopsDeployError,
  assertNotRedirected,
  checkDeploymentUrl,
  normalizeDeploymentUrl,
  redirectGuardInit,
  safeDnsLabel,
  safeProjectLabel,
  waitForReachableDeploymentUrl,
} from "@jini-ai/devops/deploy";

/**
 * @file A test double of the host kit a deploy module receives (the positional ABI installed
 * plugin modules are written against). Moved with the plugin from its first host, whose real kit
 * these tests used to import by path. Same shape and the same devops helpers; three host parts
 * are faked:
 * - the URL guard accepts any parseable URL (the host transport owns DNS and address policy);
 * - no observability wrapping;
 * - `createSigV4Client` attaches a SigV4-SHAPED `Authorization` header with a placeholder
 *   signature. It proves what the module hands the signer and what reaches the wire, never that a
 *   signature verifies: that is the host signer's own test.
 *
 * Every send reads `globalThis.fetch` at call time, so a test that stubs the global after building
 * a kit is still the one called. One shared copy for every hosting plugin's tests; `__tests__/` is never published.
 */

/** The host's timeout classes (QUICK/DEPLOY/UPLOAD), same values as the first host's kit. */
export const FAKE_DEPLOY_FETCH_TIMEOUTS = Object.freeze({ QUICK: 15_000, DEPLOY: 30_000, UPLOAD: 120_000 });

/**
 * `fetch`, aborted after `timeoutMs`; a caller's own `init.signal` still works, and only OUR
 * timeout is reported as a timeout.
 * @throws {Error} `fetch timed out after <ms>ms: <url>` when the timeout fired.
 */
async function fetchWithTimeout({ fetchFn, url, init, timeoutMs }) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await fetchFn(url, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted && !init.signal?.aborted) throw new Error(`fetch timed out after ${timeoutMs}ms: ${url}`);
    throw error;
  }
}

/** The installed plugin constructor ABI (positional), recognizing the library class too. */
class PluginDeployError extends DevopsDeployError {
  // Shared helpers throw the library class; plugins must recognize those refusals too.
  static [Symbol.hasInstance](value) { return value instanceof DevopsDeployError; }
  constructor(message, status = 400, details) {
    super({ message }, { status, details });
  }
}

/** A plugin's protected-response detector is positional; the devops option is an object. */
function reachabilityOptions(options = {}) {
  const { detectProtected, ...rest } = options;
  return { ...rest, ...(detectProtected ? { detectProtected: ({ resp, body }) => detectProtected(resp, body) } : {}) };
}

/** A SigV4-shaped signer: real scope (key id, date, region, service), placeholder signature. */
function fakeSigV4Client({ accessKeyId, service, region }) {
  async function sign(input, init = {}) {
    const datetime = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const headers = new Headers(init.headers);
    headers.set("x-amz-date", datetime);
    headers.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");
    const scope = `${accessKeyId}/${datetime.slice(0, 8)}/${region}/${service}/aws4_request`;
    headers.set("authorization", `AWS4-HMAC-SHA256 Credential=${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${"0".repeat(64)}`);
    return new Request(input, { ...init, headers });
  }
  return { sign, fetch: async (input, init) => globalThis.fetch(await sign(input, init)) };
}

/**
 * The kit handed to a deploy module under test.
 * @param {Record<string, never>} [_required]
 * @param {{ fetchFn?: typeof fetch, timeouts?: typeof FAKE_DEPLOY_FETCH_TIMEOUTS }} [optional]
 *   `fetchFn`: what `kit.fetch` and reachability probes send through (default: the global, read per
 *   call). `timeouts`: overrides the timeout classes.
 */
export function createFakeDeployHostKit(_required = {}, optional = {}) {
  const fetchFn = optional.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  const reachability = {
    fetch: ({ url }, { init } = {}) => fetchFn(url, init),
    guard: { assertSafeUrl: ({ raw }) => new URL(raw) },
  };
  return {
    fetch: (url, init, fetchOptions) => fetchWithTimeout({ fetchFn, url, init, timeoutMs: fetchOptions.timeoutMs }),
    timeouts: optional.timeouts ?? FAKE_DEPLOY_FETCH_TIMEOUTS,
    sleep: (ms) => sleep(ms),
    checkDeploymentUrl: (url, options) => checkDeploymentUrl({ url, ...reachability }, reachabilityOptions(options)),
    waitForReachableDeploymentUrl: (urls, options) => waitForReachableDeploymentUrl({
      urls, ...reachability, now: () => Date.now(), sleep: ({ ms }) => sleep(ms),
    }, reachabilityOptions(options)),
    normalizeDeploymentUrl: (url) => normalizeDeploymentUrl({ url }),
    safeDnsLabel: (raw) => safeDnsLabel({ raw }),
    safeProjectLabel: (raw, maxLength) => safeProjectLabel({ raw, maxLength }),
    redirectGuardInit: (init) => redirectGuardInit({ init }),
    assertNotRedirected: (resp, providerLabel) => assertNotRedirected({ resp, providerLabel }),
    createSigV4Client: (clientOptions) => fakeSigV4Client(clientOptions),
    DeployError: PluginDeployError,
  };
}
