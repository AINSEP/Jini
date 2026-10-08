import type { ByokConfig, DetectedAgent } from './types.js';
import type { ExecutionPort } from './ports.js';

/** Decoded HTTP operations; hosts retain auth, URLs and transport validation. */
export interface ExecutionProbeTransport {
  detectExecutionAgents(required: Record<string, never>, optional?: Record<string, never>): Promise<{ data: readonly DetectedAgent[] }>;
  testExecutionConnection(required: Pick<ByokConfig, "protocol" | "baseUrl" | "apiKey" | "model"> & ExecutionProbeFlags, optional?: Record<string, never>): Promise<{ ok: boolean; message?: string }>;
  testExecutionAgent(required: { agentId: string; model?: string }, optional?: Record<string, never>): ReturnType<NonNullable<ExecutionPort["testAgent"]>>;
  listExecutionModels(required: Pick<ByokConfig, "protocol" | "baseUrl" | "apiKey"> & ExecutionProbeFlags, optional?: Record<string, never>): Promise<{ ok: boolean; models: readonly string[]; message?: string }>;
}
interface ExecutionProbeFlags { useStoredCredential?: boolean; useAdminStoredCredential?: boolean }
/**
 * Unwraps `{ data }` off an `api.*` response, or throws a named error identifying which call
 * produced the malformed body.
 *
 * `request()` (`lib/api.ts`) validates shape on the FAILURE path only — a non-2xx always becomes
 * an `ApiError` — but a 2xx body is returned as `body as T` with no runtime check that it actually
 * has the shape `T` claims. Every caller in this file that read `.data` straight off that promise
 * used to let a malformed 200 (body present, `data` missing/`null`) fall through to whatever the
 * FIRST thing touching the result happened to be: `loadExecutionConfig`'s own `rows.map(...)`
 * threw `Cannot read properties of undefined (reading 'map')`, while `loadAdminExecutionCredential`
 * had no local dereference at all, so it silently RESOLVED to `undefined` and the crash only
 * surfaced later, at whichever caller first read a field off it (live case: `AssistantDock.hooks
 * .tsx`'s `view.isSet`, `Cannot read properties of undefined (reading 'isSet')`). Both are the same
 * underlying defect wearing different symptoms depending on what the caller happened to do next.
 * Centralizing the check here means every one of those call sites fails at its own source, with a
 * message naming the actual `api.*` method — not a raw property-access trace an on-call engineer
 * has to work backward from.
 *
 * Every existing caller's own failure contract is unchanged by this: `loadExecutionConfig`/
 * `loadAdminExecutionCredential` still get caught by `AssistantDock`'s `.catch()`-and-log-and-
 * fall-back-to-defaults; `saveAdminExecutionCredential` still surfaces as a failed save; the local
 * agent-detection port's methods still reject, per this file's own error-reporting contract (see
 * `requestAgentDetection`'s doc). This function only makes the THROWN message legible — it never
 * suppresses a malformed response into a silent default (an earlier draft's `?? []` would have hidden
 * the same failure behind "shows up as empty settings, no explanation" instead of fixing it).
 *
 * @complexity O(1) — one shape check, no iteration.
 */
export function requireExecutionResponseData<T>({ response, callSite }: { response: { data?: T | null } | null | undefined; callSite: string }, _options: Record<string, never> = {}): T {
  if (response === null || response === undefined || response.data === undefined || response.data === null) {
    throw new Error(`${callSite} response missing data`);
  }
  return response.data;
}

export interface CreateExecutionPortOptions {
  /**
   * When `true`, probes that receive no typed API key ask the server to use the workspace's STORED
   * site credential instead.
   *
   * For the AI Assistant tab, whose key is encrypted server-side and write-only: the operator
   * returns to a screen with a saved, working key and an EMPTY field, so "Test connection" and model
   * discovery had nothing to send and sat permanently disabled next to a credential that works.
   *
   * Left `false` for Settings → Execution mode, and that default is the safety property, not an
   * oversight: that screen probes the ADMIN's own credential (server-side since 2026-08-05, but
   * still a DIFFERENT stored row from the site's), a different purpose from this flag entirely. If
   * it opted in, an empty field there would silently probe — and report results for — the visitor
   * key, crossing the boundary ADR-058 §5 makes structural. (The admin's OWN stored fallback for a
   * BYOK *turn* is unconditional and happens entirely server-side in `assistant-byok.ts` — this
   * flag only ever concerns the SITE credential these `test-connection`/`list-models` probes can
   * optionally fall back to.)
   */
  useStoredCredential?: boolean;
  /**
   * When `true`, probes that receive no typed API key ask the server to use the CALLING ADMIN'S OWN
   * stored execution credential — the other write-only key, and a different row from
   * {@link CreateExecutionPortOptions.useStoredCredential}'s.
   *
   * Same symptom on the other screen. The admin's own key moved server-side on 2026-08-05, so
   * `ExecutionTab`'s Model field asked the server to discover models with an empty key and got back
   * "No API key — model discovery needs the key from this browser" — beside a stored key the server
   * uses on every admin turn. The visible consequence was that the admin BYOK panel never reached
   * `modelDiscovery.status === 'ok'`, so `ByokProviderForm` fell back to its free-text Model input
   * while the visitor panel next to it showed a real live-model picker from the same component.
   *
   * The server scopes the row to the SESSION's principal, so this can only ever reach the caller's
   * own credential. Deliberately a second flag rather than a widened `useStoredCredential`: see
   * `server/inbound/admin-http/routes/assistant/stored-credential-probe.ts`'s header.
   */
  useAdminStoredCredential?: boolean;
}

/** Create one adapter per host transport. Keep it outside React mounts so detection is shared.
 * Failed detections remain retryable; rescans always replace the cache with a fresh request.
 * Transport errors reject; connection/CLI outcomes may resolve ok:false.
 * @complexity O(1) local work per operation, excluding transport.
 * @example const adapter = createExecutionHttpAdapter({ transport }, {});
 * const port = adapter.createPort({}, { useAdminStoredCredential: true });
 */
export function createExecutionHttpAdapter(
  { transport }: { transport: ExecutionProbeTransport },
  _options: Record<string, never> = {},
) {
  /**
   * host's real `ExecutionPort` — wired to `src/server/modules/assistant-
   * execution.ts`'s 3 routes (`@jini-ai/agent-runtime` underneath). Follows
   * `@jini-ai/ui`'s `ports.ts` contract (error-reporting contract §3.1):
   *
   * - `detectLocalAgents`/`rescanLocalAgents`/`listModels` REJECT on any
   *   failure (a network error, a non-2xx from this admin's own route, a
   *   provider that could not be reached). An empty array is reserved for a
   *   real "detection ran, found nothing" / "no models" outcome — collapsing a
   *   broken request into `[]` would make it indistinguishable from that,
   *   which is exactly the bug this port used to have.
   * - `testConnection` is the one documented exception: `api.testExecutionConnection`
   *   already classifies "reached the provider, credentials rejected" as an
   *   `{ok:false}` VALUE server-side (`test-connection.ts`), so this method
   *   simply returns whatever it resolves with. It only REJECTS when the
   *   route call itself fails (session expired, network down, this admin's own
   *   route 500ing) — a case with no provider-side answer to report as a value.
   */
  async function requestAgentDetection() {
    return requireExecutionResponseData({ response: await transport.detectExecutionAgents({}, {}), callSite: "detectExecutionAgents" }, {});
  }


  /**
   * Last detection, shared across every `ExecutionTab` mount in this tab's
   * lifetime.
   *
   * Detection is not cheap and it is not local: `detect-agents.ts` calls
   * `@jini-ai/agent-runtime`'s `detectAgents()`, which SPAWNS every known CLI
   * with `--version` — two dozen processes on the host server per call. The tab
   * asks for it unconditionally on mount (`useExecutionTab.ts`'s auto-detect
   * effect), and the shell renders only the ACTIVE tab's panel, so leaving
   * Execution mode unmounts the component and returning to it re-runs the whole
   * sweep. Same on every visit to the settings page. Without this cache the
   * operator pays a fresh 24-process scan for what is, in practice, a fixed
   * answer.
   *
   * Host-scoped rather than a `useRef`/context on purpose: the point is to
   * outlive the component, and `SettingsUi` builds a NEW port object per mount
   * (`useRef(createExecutionPort())`), so anything held on the port instance
   * would die with it.
   *
   * Deliberately no TTL. Installing a CLI mid-session is the only way this goes
   * stale, and that case already has a purpose-built, clearly-labelled escape
   * hatch — the Rescan button, which bypasses this cache (see
   * `rescanLocalAgents` below). A reload clears it too. A TTL would only add a
   * second, invisible refresh rule on top of the explicit one.
   */
  let cachedDetection: ReturnType<typeof requestAgentDetection> | null = null;

  /** Caches the in-flight promise, not just the settled value — two tabs
   *  mounting in the same frame then share one request instead of racing two
   *  identical process sweeps. */
  function cacheDetection(inFlight: ReturnType<typeof requestAgentDetection>) {
    cachedDetection = inFlight;
    // A rejection must never be cached: one network blip would otherwise pin the
    // error in place for the rest of the session, and the port's contract is
    // that a failure REJECTS (see this function's doc) — so a retry has to be
    // able to actually retry.
    inFlight.catch(() => {
      if (cachedDetection === inFlight) cachedDetection = null;
    });
    return inFlight;
  }

  /** Test seam. Module state persists across cases in a file, so a suite that
   *  asserts on detection has to be able to start from cold. */
  function resetLocalAgentDetectionCache(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): void {
    cachedDetection = null;
  }

  function createExecutionPort(_required: Record<string, never> = {}, options: CreateExecutionPortOptions = {}): ExecutionPort {
    const { useStoredCredential = false, useAdminStoredCredential = false } = options;
    return {
      async detectLocalAgents() {
        return cachedDetection ?? cacheDetection(requestAgentDetection());
      },
      async rescanLocalAgents() {
        // Explicit operator action: always re-probe, and make the fresh result
        // the new baseline for subsequent mounts.
        return cacheDetection(requestAgentDetection());
      },
      async testConnection(config: ByokConfig) {
        return transport.testExecutionConnection({
          protocol: config.protocol,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          ...(useStoredCredential ? { useStoredCredential: true } : {}),
          ...(useAdminStoredCredential ? { useAdminStoredCredential: true } : {}),
        }, {});
      },
      async testAgent(agentId: string, model?: string | undefined) {
        // Same `{ok:false}`-is-a-value split as `testConnection`: the route
        // classifies "the CLI ran and reported it is not usable" server-side and
        // returns it as a value, and REJECTS (throws out of `api.*`) only when
        // the probe could not run at all.
        return transport.testExecutionAgent({ agentId, ...(model ? { model } : {}) }, {});
      },
      async listModels(config: ByokConfig) {
        const result = await transport.listExecutionModels({
          protocol: config.protocol,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          ...(useStoredCredential ? { useStoredCredential: true } : {}),
          ...(useAdminStoredCredential ? { useAdminStoredCredential: true } : {}),
        }, {});
        // `result.ok === false` here is ALWAYS "discovery could not reach/read the
        // provider" (auth failure, timeout, blocked base URL, unsupported protocol)
        // — `list-models.ts`'s route never reports a reachable-but-genuinely-empty
        // catalog as `ok:false`, so there is no legitimate value to return here.
        // Reject with the server's own message rather than resolving `[]`.
        if (!result.ok) {
          throw new Error(result.message?.trim() ? result.message : "Model discovery failed");
        }
        return result.models;
      },
    };
  }

  return { createPort: createExecutionPort, resetDetectionCache: resetLocalAgentDetectionCache };
}
