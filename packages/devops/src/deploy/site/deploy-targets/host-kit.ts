import type { createNodeReachabilityPorts } from "../../node.js";
import {
  DeployError as DevopsDeployError,
  assertNotRedirected,
  checkDeploymentUrl,
  normalizeDeploymentUrl,
  redirectGuardInit,
  safeDnsLabel,
  safeProjectLabel,
  waitForReachableDeploymentUrl,
} from "../../index.js";


import type { DeployFetchTimeouts, SigV4Client  } from "./types.js";
import type { PluginDeployHostKit as DeployHostKit } from "../../index.js";

/**
 * @file Builds the {@link DeployHostKit} this app injects into every plugin deploy module. Generic:
 * devops' vendor-neutral helpers (reachability, naming, redirect guard), a timeout-bounded `fetch`,
 * and a SigV4 request signer (the protocol S3-compatible stores share), nothing host-specific.
 */

// Values match the platform fetch timeouts.
export const DEPLOY_FETCH_TIMEOUTS: DeployFetchTimeouts = Object.freeze({ QUICK: 15_000, DEPLOY: 30_000, UPLOAD: 120_000 });

/**
 * `fetch`, aborted after `timeoutMs`. A caller's own `init.signal` still works: the request aborts on
 * whichever fires first, and only OUR timeout is reported as a timeout.
 *
 * @throws {Error} `fetch timed out after <ms>ms: <origin>` when the timeout fired; otherwise whatever
 * `fetch` rejected with (the caller's abort reason, a network error).
 * @complexity One request.
 */
async function fetchWithTimeout({ fetchFn, url, init, options }: { fetchFn: typeof fetch; url: string; init: RequestInit; options: { readonly timeoutMs: number } }, _options = {}): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await fetchFn(url, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted && !init.signal?.aborted) throw new Error(`fetch timed out after ${options.timeoutMs}ms: ${URL.canParse(url) ? new URL(url).origin : "the requested server"}`, { cause: error });
    throw error;
  }
}

/** Preserve the installed plugin constructor ABI, including status/details and instanceof. */
class PluginDeployError extends DevopsDeployError {
  // Shared helpers throw the library class; plugins must recognize those refusals too.
  static [Symbol.hasInstance](value: unknown): boolean { return value instanceof DevopsDeployError; }
  constructor(message: string, status = 400, details?: DevopsDeployError["details"]) {
    super({ message }, { status, details });
  }
}

/** A plugin's response detector is positional; the Jini response port is an object. */
function reachabilityOptions(options: NonNullable<Parameters<DeployHostKit["waitForReachableDeploymentUrl"]>[1]> = {}) {
  const { detectProtected, ...rest } = options;
  return { ...rest, ...(detectProtected ? { detectProtected: ({ resp, body }: { resp: Response; body: string }) => detectProtected(resp, body) } : {}) };
}

/** At most 4 KiB is needed for the content digest; cancel oversized or stalled responses. */
async function matchesContentProof({ response, expected }: { response: Response; expected: string }, _options = {}): Promise<boolean> {
  if (!response.ok || !response.body) return false;
  const reader = response.body.getReader();
  try {
    const body = await readProofBody({ reader });
    return body !== undefined && body.toString("utf8") === expected;
  } finally { await reader.cancel(); }
}

async function readProofBody({ reader }: { reader: ReadableStreamDefaultReader<Uint8Array> }, _options = {}): Promise<Buffer | undefined> {
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return Buffer.concat(chunks);
    bytes += chunk.value.length;
    if (bytes > 4096) return undefined;
    chunks.push(chunk.value);
  }
}

/** Guard and transport come from one Jini binding, enforcing policy at connection time. */
async function probeDeploymentContent({ ports, url, expected }: { ports: ReturnType<typeof createNodeReachabilityPorts>; url: string; expected: string }, _options = {}): Promise<boolean> {
  try {
    ports.guard.assertSafeUrl({ raw: url, label: "deployment content proof" });
    const response = await ports.fetch({ url }, { init: { signal: AbortSignal.timeout(DEPLOY_FETCH_TIMEOUTS.QUICK), redirect: "error" } });
    return await matchesContentProof({ response, expected });
  } catch { return false; }
}

/**
 * The kit handed to a deploy module.
 *
 * @complexity O(1).
 */
export function createDeployHostKit({ fetchFn, createReachability, now, sleep, createSigV4Client }: {
  fetchFn: typeof fetch;
  createReachability: () => ReturnType<typeof createNodeReachabilityPorts>;
  now: () => number;
  sleep: (required: { ms: number }) => Promise<void>;
  createSigV4Client: (required: { options: Parameters<DeployHostKit["createSigV4Client"]>[0] }) => SigV4Client;
}, { timeouts }: { timeouts?: DeployFetchTimeouts } = {}): DeployHostKit {
  // Each probe operation owns its dispatcher; polling shares it until the operation settles.
  // Per-publish kits have no shutdown hook, so release connections on success and refusal alike.
  async function withReachability<T>({ run }: { run: (ports: ReturnType<typeof createNodeReachabilityPorts>) => Promise<T> }, _options = {}): Promise<T> {
    const reachability = createReachability();
    try { return await run(reachability); }
    finally { await reachability.close(); }
  }
  return {
    now: () => now(),
    // The paired Jini transport enforces policy at connection time, including every redirect.
    // A 200 alone cannot distinguish a previous site from the content just deployed.
    probeContent: ({ url, expected }) => withReachability({ run: ports => probeDeploymentContent({ ports, url, expected }) }),
    fetch: (url, init, fetchOptions) => fetchWithTimeout({ fetchFn, url, init, options: fetchOptions }),
    timeouts: timeouts ?? DEPLOY_FETCH_TIMEOUTS,
    sleep: (ms) => sleep({ ms }),
    // Standalone installed plugins keep their ABI. Every shared helper receives
    // object args and explicit host ports, including native fetch and polling time.
    checkDeploymentUrl: (url, options) => withReachability({ run: reachability => checkDeploymentUrl({ url, ...reachability }, reachabilityOptions(options)) }),
    waitForReachableDeploymentUrl: (urls, options) => withReachability({ run: reachability => waitForReachableDeploymentUrl({
      urls, ...reachability, now: () => now(),
      sleep: ({ ms }) => sleep({ ms }),
    }, reachabilityOptions(options)) }),
    normalizeDeploymentUrl: (url) => normalizeDeploymentUrl({ url }),
    safeDnsLabel: (raw) => safeDnsLabel({ raw }),
    safeProjectLabel: (raw, maxLength) => safeProjectLabel({ raw, maxLength }),
    redirectGuardInit: (init) => redirectGuardInit({ init }),
    assertNotRedirected: (resp, providerLabel) => assertNotRedirected({ resp, providerLabel }),
    createSigV4Client: (clientOptions) => createSigV4Client({ options: clientOptions }),
    DeployError: PluginDeployError,
  };
}
