// Local federation forks moved to @jini-ai/mcp/federation (+ /stdio, /approvals); see development/DELETED-CODE.md.

/**
 * @file The CALL-TIME half of "a refusal must never be silent" — `mcp-federation/refusal-notice.ts`
 * is the BOOT-TIME half (the prompt prefix every run starts with). Read that file's header first;
 * this one only makes sense as the second half of the same incident.
 *
 * ---------------------------------------------------------------------------
 * The defect this closes
 * ---------------------------------------------------------------------------
 * A federated tool this boot refused is never registered (`mcp-federation/trust.ts`'s
 * `admitRemoteTools`), so `@jini-ai/daemon`'s `createToolExecutor` does the only thing its contract
 * allows for an id it does not know: it THROWS `ToolExecutor: unknown tool "<id>"` — "a
 * routing/programming error", per that file's own doc, never a `ToolExecutionResult`. That throw
 * propagates through every decorator in `tool-executor-stack.ts` (each of which passes it through
 * unchanged) and out through `@jini-ai/http-kit`'s `delegated-tools.ts`, whose route wraps the whole
 * call in a try/catch that treats ANY throw as SEC-005-worthy: it redacts the message to a bare
 * `INTERNAL_ERROR` + correlation id and sends the real text ONLY to `onInternalError` (the daemon's
 * `console.error`). The model — and therefore the user — sees an opaque 500 indistinguishable from a
 * genuine internal fault, for a call that was in fact refused for a nameable, fixable reason.
 *
 * `mcp-federation/refusal-notice.ts` already solves the ENUMERATION half of this (the boot prompt
 * names every actionable refusal up front) but deliberately never mentions `not-in-operator-allowlist`
 * (its R-B: reporting every tool an operator never asked for would spam the prompt on a real server
 * with dozens of unwanted tools). That silence is correct for a list nobody asked to see. It is not
 * correct for a call the model actually attempted — the model has, by naming this exact tool id,
 * already decided it wants it, so telling it why the call failed is never noise. See
 * `refusal-notice.ts`'s `explainFederatedToolRefusal` for the one explanation R-B withholds from the
 * boot prefix but this file needs for an attempt.
 *
 * ---------------------------------------------------------------------------
 * Why a decorator, and why OUTERMOST
 * ---------------------------------------------------------------------------
 * `ToolExecutor` is a plain structural interface and every one of Tovu's existing decorators
 * (`read-only-tool-constraint.ts`, `tool-executor-audit.ts`, `tool-failure-recovery.ts`,
 * `tool-executor-stack.ts`) is exactly this shape — a wrapper, not an upstream change. This one is
 * composed OUTSIDE all three of those (see `agent-daemon-server.ts`'s `toolExecutor` construction),
 * not folded into `tool-executor-stack.ts` itself: every existing decorator still sees and classifies
 * the ORIGINAL throw exactly as it does today — `tool-executor-audit.ts`'s `isUnknownToolError` still
 * records an `unknown-tool` audit row, byte-for-byte the current behavior — and this layer only ever
 * intercepts what is ABOUT TO ESCAPE the whole stack, converting it into a legible result at the very
 * last moment instead of an opaque throw. Composed here rather than baked into
 * `createAssistantToolExecutor` for the same reason `tool-executor-stack.ts` stays free of federation
 * concerns: BYOK shares that stack and has no federated connections or admission snapshot to check
 * against.
 *
 * ---------------------------------------------------------------------------
 * Why the result is `status: 'failed', errorKind: 'validation'`
 * ---------------------------------------------------------------------------
 * Not a new status, and not `'denied'`: `@jini-ai/http-kit`'s `delegated-tools.ts` already maps
 * `'failed'` with `errorKind === 'validation'` to a real, UN-redacted `400 BAD_REQUEST` carrying the
 * handler's own message verbatim — the exact "reason reaches the model" property this file exists
 * for, already wired, with zero changes to any Jini package. `'denied'` was considered and rejected:
 * `toolExecutionResultToApiResult` maps it to a FIXED string ("this operation was denied by policy")
 * and ignores `ToolExecutionResult.error` entirely, so a custom message placed there would never reach
 * the wire. `'validation'` is a deliberate reuse of a status that normally means "the caller's input
 * was malformed" for a case that is really "the caller's TARGET was refused" — accepted because it is
 * the only existing carrier for a free-text, non-redacted message, and because both share the same
 * caller-facing shape: a call the requester can fix by asking for something else, not a fault on this
 * side.
 *
 * ---------------------------------------------------------------------------
 * Why its own minted result is redacted here, not left to `withRedactedToolFailures`
 * ---------------------------------------------------------------------------
 * This decorator is composed OUTERMOST (see above), so a `failed` result it mints itself in its own
 * `catch` block never passes back through `withRedactedToolFailures`, which sits INSIDE
 * `createAssistantToolExecutor` (`tool-executor-stack.ts`) — every other `failed`-result path in the
 * stack is redacted; this was the one that structurally could not be. Today `remoteName` is the only
 * upstream-influenced piece of the composed string (the external server's own advertised tool name,
 * sanitized by `safeRemoteName` against injection characters but not against secret shapes) and
 * `connectionId`/`explanation` are operator-authored or fixed prose, but calling
 * {@link redactSecretShapes} directly on the composed message — mirroring `tool-failure-redaction.ts`'s
 * own `errorKind: 'validation'` branch exactly — closes the hole structurally rather than relying on
 * that staying true.
 *
 * Architectural role:
 * `src/assistant` composition-layer adapter, matching its three siblings above. Depends on
 * `mcp-federation`'s pure reduction functions and on `contracts/core/secret-redaction.ts`'s pure
 * engine — no I/O, no registry, no protocol of its own.
 */


import type { Principal, RunRef, SurfaceEmitter } from "@jini-ai/core";
import type { ToolExecutionResult, ToolExecutor } from "../tool-executor.js";

export interface FederatedRefusalDiagnosisDeps {
  readonly inner: ToolExecutor;
  readonly isFederatedTool: (required: { toolId: string }) => boolean;
  readonly parseConnectionId: (required: { toolId: string }) => string | null;
  readonly findRefusal: (required: { toolId: string }) => { remoteName: string; connectionId: string; explanation: string } | null;
  readonly newExecutionId: () => string;
  readonly redactSecretShapes: (required: { text: string }) => { text: string };
  readonly getBootStatus?: () => FederationBootStatus;
}

/**
 * The federation boot pass's own live state, for the "still connecting" case below — deliberately
 * NOT `FederationRuntime` itself (`external-mcp-federation-runtime.ts`): that type carries a whole
 * runtime's worth of methods (`start`, `reload`, …) this decorator has no business calling, and
 * importing it here would pull a composition-layer type into what is otherwise a pure reduction
 * over data, same posture as `refusal-notice.ts`'s own `FederationAdmissionSnapshotEntry`. A caller
 * builds this from its own `FederationRuntime` with `{ settled: federation.started, connectFailures:
 * federation.connectFailures() }` — see `byok-tool-surface.ts`'s call site.
 */
export interface FederationBootStatus {
  /** Whether the boot pass (every configured connection, attempted once, in order) has finished.
   *  `false` for the window between "the surface started federation" and "every connection has
   *  either admitted or failed" — the exact gap `npx` startup (6-13s) can outlast this decorator's
   *  caller's own bounded wait (`assistant-byok.ts`'s `FEDERATION_TURN_WAIT_MS`, 5s). */
  readonly settled: boolean;
  /** `AttachFederatedToolsResult.connectFailures`, verbatim — a connectionId that reached `attach`
   *  but never admission at all, with its human-readable reason. */
  readonly connectFailures: readonly { readonly connectionId: string; readonly reason: string }[];
  /**
   * The boot roster's connection ids (2026-09-25), known as soon as the runtime's own
   * `resolveConnections()` call resolves — see `external-mcp-federation-runtime.ts`'s
   * `configuredConnectionIds()`. `undefined` means the roster itself is not known yet (the earliest
   * sliver of boot, before that call has even resolved); an omitted/`undefined` value is treated as
   * "cannot rule anything out yet", never as "nothing is configured" — those are different claims,
   * and only a present array can positively prove a connectionId was never configured at all. Without
   * this field, `!status.settled` alone told a caller naming ANY federated-shaped id, including one
   * that was never in the roster, "still connecting" for as long as boot took.
   */
  readonly configuredConnectionIds?: readonly string[];
}

/**
 * `ToolExecutor.execute`'s own contract for an unregistered id (`@jini-ai/daemon`'s
 * `tool-executor.ts`): a thrown `Error` reading `unknown tool "<id>"`, with no code or subclass to
 * match on instead. Duplicated from `tool-executor-audit.ts`'s identical `isUnknownToolError` rather
 * than imported: that file is a sibling one layer up with no dependency on `mcp-federation`, and
 * importing across that line for an 18-character regex is not worth the coupling. Both copies carry
 * the same MEDIUM message-text-coupling note that file's own doc records — if `@jini-ai/daemon`
 * rewords this message, this decorator silently stops matching and every call it would have
 * diagnosed falls back to today's opaque redaction, never a worse or incorrect outcome.
 *
 * @complexity O(n) in the message length.
 * @overallScore 90
 */
function isUnknownToolError(error: unknown): boolean {
  return error instanceof Error && /unknown tool/i.test(error.message);
}

/**
 * The "still connecting" / "failed to connect" diagnosis (2026-09-24) — reached only for a federated
 * id that {@link findFederatedToolRefusal} could NOT explain, i.e. one whose connection has no
 * admission report at all yet (never refused because it was never even admitted).
 *
 * Two distinct outcomes, both reached only via `status.connectFailures`/`!status.settled` and never
 * both — `attachFederatedMcpTools`'s per-connection loop is sequential and produces at most one of
 * "still running" or "failed" for a given connectionId at any moment this decorator could observe it:
 *
 * - `!status.settled`: the boot pass has not finished walking every configured connection, so THIS
 *   connectionId is presumed still connecting (npx startup, 6-13s, routinely outlasts a caller's own
 *   bounded wait) — UNLESS `status.configuredConnectionIds` is already known and does not contain it,
 *   in which case it was never configured at all and the original throw stands (2026-09-25; before
 *   this check, a hallucinated/stale id got "still connecting" for as long as boot took, same as a
 *   real pending one). A model naming an id that IS in the roster has, by doing so, already decided it
 *   wants it — telling it to retry is strictly better than the opaque `unknown tool` throw it would
 *   get instead, even in the rare case this particular connection actually already failed while a
 *   LATER one in the loop is still connecting; the very next call after boot settles gets the precise
 *   failure reason below instead.
 * - `status.settled` and this connectionId is in `connectFailures`: the boot pass finished and this
 *   connection genuinely never admitted — its own human-readable reason (`bootstrap.ts`'s
 *   `messageOf(error)`, already proven secret-free by that field's own doc) is relayed verbatim.
 *
 * `status` is `undefined` for a caller that never passed `getBootStatus` at all (the daemon's own
 * call site) or for a toolId that is not federated-shaped — both return `null` immediately, letting
 * the original `unknown tool` throw stand exactly as it did before this diagnosis existed.
 *
 * @complexity O(1) for the connecting case; O(connectFailures) for the settled case.
 * @overallScore 100
 */
function diagnoseStillConnectingOrFailed(toolId: string, status: FederationBootStatus | undefined, deps: FederatedRefusalDiagnosisDeps): ToolExecutionResult | null {
  if (!status) return null;
  const connectionId = deps.parseConnectionId({ toolId });
  if (connectionId === null) return null;

  if (!status.settled) {
    // Only a positively-known roster can rule `connectionId` OUT; `undefined` (roster not resolved
    // yet) keeps the pre-2026-09-25 behavior of presuming still-connecting rather than guessing wrong
    // in either direction.
    if (status.configuredConnectionIds && !status.configuredConnectionIds.includes(connectionId)) return null;
    return failedResult(`External MCP server '${connectionId}' is still connecting — try again in a moment.`, deps);
  }
  const failure = status.connectFailures.find((entry) => entry.connectionId === connectionId);
  if (!failure) return null;
  // `reason` is already proven secret-free by `AttachFederatedToolsResult.connectFailures`'s own
  // doc, but redacted anyway for the same defense-in-depth reason the refusal branch below redacts
  // an operator-authored/fixed-prose string that "never matches a redaction rule" today — a
  // guarantee this file has no way to keep verifying stays true upstream.
  return failedResult(deps.redactSecretShapes({ text: `External MCP server '${connectionId}' failed to connect: ${failure.reason}` }).text, deps);
}

/** One `status: 'failed'`, `errorKind: 'validation'` result — the shape both diagnosis branches
 *  above return, factored out purely to keep {@link diagnoseStillConnectingOrFailed} and the main
 *  refused-tool branch from hand-building the same four-field object twice. See this file's header
 *  ("Why the result is `status: 'failed', errorKind: 'validation'`") for why this exact shape is what
 *  reaches the model un-redacted-by-the-stack rather than a thrown error. */
function failedResult(message: string, deps: FederatedRefusalDiagnosisDeps): ToolExecutionResult {
  return { executionId: deps.newExecutionId(), status: "failed", errorKind: "validation", error: message };
}

/**
 * Wraps `inner` so a call naming a federated tool id THIS BOOT REFUSED fails with a message naming
 * the tool, the server, and the fix, instead of the bare `unknown tool` throw escaping all the way to
 * `@jini-ai/http-kit`'s SEC-005 redaction.
 *
 * @param getSnapshot - Reads the CURRENT admission snapshot lazily, not a value closed over once —
 *   this decorator is composed in `agent-daemon-server.ts` before `attachFederatedMcpTools` resolves
 *   (mirroring that file's own `federationRefusalPrefix` `let` binding for the identical reason), so
 *   a plain array parameter captured at construction time would forever see the empty pre-boot
 *   snapshot. Pass `() => federationAdmissionReports` (a closure over the module-scope binding), not
 *   `() => someArrayCapturedNow`.
 * @param getBootStatus - Optional (2026-09-24). When given, an unknown-tool throw for a federated id
 *   this boot's snapshot does NOT (yet) refuse is diagnosed one step further before falling back to
 *   the original throw: while `!settled`, the connection is presumed still connecting (`npx`
 *   startup, 6-13s, can outlast a caller's own bounded wait — see `assistant-byok.ts`'s
 *   `FEDERATION_TURN_WAIT_MS`) and the call gets a clear "still connecting" message instead of the
 *   raw `ToolExecutor: unknown tool` throw a model cannot act on. Once `settled`, a connectionId
 *   present in `connectFailures` gets that failure's own reason instead. Omitted (the daemon's own
 *   call site, where a turn never runs until `federation.start()` has fully resolved — see
 *   `agent-daemon-server.ts`'s `start()`), this decorator's behavior is byte-identical to before this
 *   parameter existed: every one of this file's own pre-2026-09-24 tests passes an unchanged 2-arg
 *   call and must keep throwing for a federated-shaped id this boot never refused.
 * @returns A drop-in `ToolExecutor`. Every call that is not BOTH (a) an unknown-tool throw AND (b) a
 *   federated id this boot's snapshot actually refused passes through with byte-identical behavior —
 *   completed results, every other status, and the throw itself for a genuinely unknown or
 *   native-typo id — so `resumeConfirmation`/`cancel`/`getAuditRecord` delegate straight through with
 *   no wrapping at all.
 * @complexity One extra `instanceof`/regex test and one string-prefix test per call that reaches
 *   `catch` — already the unhappy path; {@link findFederatedToolRefusal}'s own O(connections ×
 *   refusals) cost only when both tests pass, and `getBootStatus`'s own O(connectFailures) lookup
 *   only when they pass AND no refusal was found.
 * @overallScore 100
 */
export function withFederatedRefusalDiagnosis(
  { inner, ...deps }: FederatedRefusalDiagnosisDeps,
  _optional = {},
): ToolExecutor {
  return {
    execute: async (
      { principal, run, toolId, input }: { principal: Principal; run: RunRef; toolId: string; input: unknown },
      { signal, emitSurface }: { signal?: AbortSignal; emitSurface?: SurfaceEmitter } = {},
    ): Promise<ToolExecutionResult> => {
      try {
        return await inner.execute({ principal, run, toolId, input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) });
      } catch (error) {
        if (!isUnknownToolError(error) || !deps.isFederatedTool({ toolId })) throw error;
        const refusal = deps.findRefusal({ toolId });
        if (refusal === null) {
          const stillConnecting = diagnoseStillConnectingOrFailed(toolId, deps.getBootStatus?.(), { inner, ...deps });
          if (stillConnecting !== null) return stillConnecting;
          throw error;
        }
        return {
          executionId: deps.newExecutionId(),
          status: "failed",
          errorKind: "validation",
          // Redacted like every other `errorKind: 'validation'` failure (`tool-failure-redaction.ts`'s
          // own validation branch) even though THIS layer sits outside `withRedactedToolFailures` in
          // `agent-daemon-server.ts`'s composition and so would otherwise never pass back through it —
          // see this file's header for why it is composed outermost. `remoteName` is the one
          // upstream-influenced piece of this string: it is the external server's OWN advertised tool
          // name, sanitized by `safeRemoteName` only against injection characters, never against
          // secret shapes, so a remote naming a tool e.g. `sk-ant-api03-...` would otherwise leak it
          // verbatim. `connectionId` and `explanation` are operator-authored / fixed prose and never
          // match a redaction rule, so this is a no-op for them.
          error: deps.redactSecretShapes({
            text: `tool "${refusal.remoteName}" on external server "${refusal.connectionId}" was refused: ${refusal.explanation}`,
          }).text,
        };
      }
    },
    resumeConfirmation: (args) => inner.resumeConfirmation(args),
    cancel: (executionId) => inner.cancel(executionId),
    getAuditRecord: (executionId) => inner.getAuditRecord(executionId),
  };
}
