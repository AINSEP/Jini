/**
 * @file The one place Tovu's `ToolExecutor` decorator stack is composed.
 *
 * The order of these three wrappers is load-bearing in two different directions, and it was
 * previously spelled out only as an expression inside `agent-daemon-server.ts` — a module that boots
 * Express, opens a database, and spawns agents, so nothing could exercise the composition without
 * booting all of it. A security property that no test can reach is a security property that drifts:
 * the read-only gateway's bypass (see `read-only-tool-constraint.ts`) lived precisely in the gap
 * between "the route check is tested" and "the composition is not". This function closes that gap by
 * being the composition, callable on its own.
 *
 * Innermost to outermost:
 *
 * 1. `withReadOnlyToolConstraint` — wraps the BARE executor, so every dispatch by every layer above
 *    it, including a tool id no caller ever named, has to pass the read-only gate to reach a handler.
 *    Anything further out would be bypassed by whatever sits beneath it.
 * 2. `withRedactedToolFailures` (2026-09-16) — blanks secret-shaped values out of every `failed`
 *    result and mints its `ERR-…` id, per the owner's "hide secrets only" ruling (see that file's own
 *    header). Sits ABOVE the read-only gate so a read-only refusal (`status: 'denied'`, set by layer
 *    1, never `'failed'`) is never touched by it, and BELOW `withToolAttemptAudit` so the audit sees
 *    the finished `errorId` and can store it (`tool-executor-audit.ts`). It sits INSIDE
 *    `withToolFailureRecovery` (layer 4) rather than outside it: recovery's own read-only-remedy
 *    refusal message is set on the OUTER result, after this layer has already run, so that message is
 *    never redacted either — only the original/remedy/retry calls recovery makes THROUGH `inner` pass
 *    through this layer, each redacted on its own.
 * 3. `withToolAttemptAudit` — appends `requested` BEFORE delegating, which is the only ordering that
 *    records an unknown tool id or a throwing authorization (see that file's own doc). Sitting above
 *    the constraint gate means a read-only refusal is itself audited as a denial. Skipped entirely
 *    when the caller supplies no `toolAttemptAudit` — see {@link AssistantToolExecutorDeps}'s own doc.
 * 4. `withToolFailureRecovery` — outermost, so the remedy call and the retry it can make each land as
 *    their own audited attempt row. The opposite order would collapse all three into the one outer
 *    "completed" row the audit records for the call the transport actually made, losing the remedy
 *    tool's own attempt from the trail entirely.
 *
 * Composed the SAME way for both of Tovu's tool-dispatch surfaces: the agent daemon's delegated-tool
 * route and BYOK's `byok-tool-surface.ts` (as of 2026-09-06 — previously BYOK hand-assembled its own
 * second copy of this stack that never wrapped `withReadOnlyToolConstraint`, so a decorator known to
 * apply to "every read-only gateway" in fact applied to only one of the two; see that file's own
 * `executor` construction for the call site).
 *
 * Architectural role: `src/assistant` composition-layer adapter. Takes its collaborators as
 * arguments and constructs no policy, sink, or registry of its own.
 */
import { createToolExecutor, type ToolExecutor } from "../tool-executor.js";
import type { ToolRegistry } from "@jini-ai/core";
import type { ToolAttemptAuditSink } from "../core/tool-audit.js";
import type { SurfaceExchangeStore } from "../surface-exchanges.js";
import { withReadOnlyToolConstraint, type ReadOnlyToolMessages } from "../core/read-only-tools.js";
import { withToolAttemptAudit } from "../core/tool-audit.js";
import { withToolFailureRecovery, type ToolFailureRecoveryDeps } from "./recovery.js";
import { withRedactedToolFailures, readToolErrorId, type RedactedToolFailuresDeps } from "./redaction.js";

export interface AssistantToolExecutorDeps extends Omit<ToolFailureRecoveryDeps, "registry"> {
  readonly registry: ToolRegistry;
  readonly surfaceExchanges: SurfaceExchangeStore;
  readonly newExecutionId: () => string;
  /** Optional sink is a real supported configuration; never require a dummy observer. */
  readonly toolAttemptAudit?: { readonly sink: ToolAttemptAuditSink; readonly workspaceId: string; readonly now: () => string; readonly newAttemptId: () => string; readonly onSinkError?: (error: unknown) => void };
  readonly toolFailures: RedactedToolFailuresDeps;
}

/** One registry and innermost read-only gate protect original, remedy and retry alike.
 * Redaction precedes observation; recovery is outermost so each actual attempt is audited.
 * @complexity O(1) composition; each decorator owns its runtime cost.
 */
export function createAssistantToolExecutor(deps: AssistantToolExecutorDeps, _optional = {}): ToolExecutor {
  const guarded = withReadOnlyToolConstraint({ inner: createToolExecutor({ registry: deps.registry }),
    registry: deps.registry, idGenerator: { newId: deps.newExecutionId }, messages: deps.readOnlyMessages }, {});
  const redacted = withRedactedToolFailures({ inner: guarded, ...deps.toolFailures }, {});
  const audited = deps.toolAttemptAudit
    ? withToolAttemptAudit({ inner: redacted, ...deps.toolAttemptAudit, readErrorId: readToolErrorId }, deps.toolAttemptAudit.onSinkError ? { onSinkError: deps.toolAttemptAudit.onSinkError } : {})
    : redacted;
  return withToolFailureRecovery({ ...deps, inner: audited }, {});
}
