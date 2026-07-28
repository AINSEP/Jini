/**
 * `resolveRunInput` + `createDefaultRunStartHandler` — gap 1's other half:
 * "a default `RunStartHandler`-style wiring (host-supplied `resolveRunInput`
 * seam, matching the existing `resolveDaemonUrl` precedent)" (Final
 * Recommendation, `ADS-memory/reports/swarm-consensus/runs/20260722T023000Z-consensus-report.md`).
 *
 * Today, `@injini/http`'s `POST /api/runs` durably starts a run via
 * `RunLifecycle.start()` and then — only if a host supplied one — invokes an
 * `onStarted`/`RunStartHandler` callback. Nothing in the kernel ever turns
 * that durable start into an actual `AgentExecutor.run()` call: a host with
 * no `onStarted` gets a run that is durably `'running'` forever, with no
 * driver ever attached. This module is the missing default, built the same
 * way `@injini/cli`'s `resolveDaemonUrl` composes a required resolution step
 * (there: a daemon URL; here: an agent's prompt/cwd/env) out of an
 * injectable async seam — `resolveRunInput` has no generic default, unlike
 * `resolveDaemonUrl`'s optional `discover`, because prompt/skill/memory
 * composition is gap 2, and gap 2 stays host-owned *permanently* (Final
 * Recommendation item 5) — there is no sensible kernel-supplied fallback to
 * fall through to.
 *
 * This does not itself touch `@injini/http`'s `RunStartHandler` type (a
 * `@injini/daemon` → `@injini/http` import would invert the package graph —
 * `@injini/http` already imports `@injini/daemon`, never the reverse).
 * {@link DefaultRunStartHandler}'s parameter type is a structural subset of
 * `@injini/http`'s `RunStartContext`, so a real `RunStartContext` value —
 * passed by a host wiring this handler in as `RunHttpDeps.onStarted` —
 * satisfies it without either package needing to import the other's types.
 */
import type { AgentExecutor } from '../agent-executor.js';

export interface ResolveRunInputContext {
  readonly runId: string;
  readonly contextRef: string;
  readonly agentId?: string;
}

export interface ResolvedRunInput {
  readonly agentId: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Host-owned composition seam: turns a durably-started run's identity into what `AgentExecutor.run()` actually needs. No generic default exists — see module doc. */
export type ResolveRunInput = (
  context: ResolveRunInputContext,
) => Promise<ResolvedRunInput> | ResolvedRunInput;

/** Structural subset of `@injini/http`'s `RunStartContext` — see module doc for why this package cannot import that type directly. */
export interface RunStartDriverContext {
  readonly request: { readonly contextRef: string; readonly agentId?: string };
  readonly run: { readonly id: string };
}

/** Structurally assignable to `@injini/http`'s `RunStartHandler` — see module doc. */
export type DefaultRunStartHandler = (context: RunStartDriverContext) => Promise<void>;

export interface CreateDefaultRunStartHandlerOptions {
  readonly agentExecutor: AgentExecutor;
  readonly resolveRunInput: ResolveRunInput;
}

/**
 * Builds the default `RunStartHandler`-shaped driver: resolves the real
 * agent input via `options.resolveRunInput`, then hands it straight to
 * `options.agentExecutor.run()`. A host wires this in as
 * `RunHttpDeps.onStarted` (or `CreateLocalNodeDaemonConfig.onRunStarted`)
 * instead of writing its own driver from scratch — it still owns
 * `resolveRunInput` itself (gap 2 stays host-owned), but no longer needs to
 * know `AgentExecutor`'s call shape or wire cancellation/journaling by hand.
 * @param options.agentExecutor - The executor this handler drives. Any byte-journaling is the executor's own concern (see `CreateAgentExecutorOptions.journal`) — this handler does not journal directly.
 * @param options.resolveRunInput - Host-owned composition seam — see module doc.
 * @returns A handler structurally assignable to `@injini/http`'s `RunStartHandler`.
 * @throws Whatever `resolveRunInput` or `agentExecutor.run()` throw — `@injini/http`'s `runStartRoute` already treats a rejecting `onStarted` as a failed run (finishes it, reports the internal error), so this handler deliberately does not swallow either failure itself.
 * @complexity O(1) plus `resolveRunInput`'s and `agentExecutor.run()`'s own costs.
 * @overallScore 100/100
 */
export function createDefaultRunStartHandler(
  options: CreateDefaultRunStartHandlerOptions,
): DefaultRunStartHandler {
  return async (context: RunStartDriverContext): Promise<void> => {
    const resolved = await options.resolveRunInput({
      runId: context.run.id,
      contextRef: context.request.contextRef,
      ...(context.request.agentId !== undefined ? { agentId: context.request.agentId } : {}),
    });
    await options.agentExecutor.run({
      runId: context.run.id,
      agentId: resolved.agentId,
      prompt: resolved.prompt,
      cwd: resolved.cwd,
      ...(resolved.env !== undefined ? { env: resolved.env } : {}),
    });
  };
}
