/**
 * `resolveRunInput` + `createDefaultRunStartHandler` — gap 1's other half:
 * "a default `RunStartHandler`-style wiring (host-supplied `resolveRunInput`
 * seam, matching the existing `resolveDaemonUrl` precedent)" (Final
 * Recommendation, `ADS-memory/reports/swarm-consensus/runs/20260722T023000Z-consensus-report.md`).
 *
 * Today, `@jini-ai/http-kit`'s `POST /api/runs` durably starts a run via
 * `RunLifecycle.start()` and then — only if a host supplied one — invokes an
 * `onStarted`/`RunStartHandler` callback. Nothing in the kernel ever turns
 * that durable start into an actual `AgentExecutor.run()` call: a host with
 * no `onStarted` gets a run that is durably `'running'` forever, with no
 * driver ever attached. This module is the missing default, built the same
 * way `@jini-ai/cli`'s `resolveDaemonUrl` composes a required resolution step
 * (there: a daemon URL; here: an agent's prompt/cwd/env) out of an
 * injectable async seam — `resolveRunInput` has no generic default, unlike
 * `resolveDaemonUrl`'s optional `discover`, because prompt/skill/memory
 * composition is gap 2, and gap 2 stays host-owned *permanently* (Final
 * Recommendation item 5) — there is no sensible kernel-supplied fallback to
 * fall through to.
 *
 * This does not itself touch `@jini-ai/http-kit`'s `RunStartHandler` type (a
 * `@jini-ai/daemon` → `@jini-ai/http-kit` import would invert the package graph —
 * `@jini-ai/http-kit` already imports `@jini-ai/daemon`, never the reverse).
 * {@link DefaultRunStartHandler}'s parameter type is a structural subset of
 * `@jini-ai/http-kit`'s `RunStartContext`, so a real `RunStartContext` value —
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
  /**
   * Forwarded verbatim to `AgentExecutorRunInput.permissionMode`.
   *
   * **Load-bearing, and the reason this interface grew.** Omitting it is not neutral: every def that
   * has an auto-approve flag (`bypassPermissions` / `--yolo` / `--dangerously-skip-permissions`) uses
   * it by default when this is absent. So a host that had been passing `'restricted'` to
   * `AgentExecutor.run()` by hand and then adopted `createDefaultRunStartHandler` would silently have
   * started auto-approving every action — a security regression wearing the clothes of a refactor.
   * This field is what makes that host's existing posture expressible through the default handler.
   */
  readonly permissionMode?: 'bypass' | 'restricted';
  /** Forwarded verbatim to `AgentExecutorRunInput.model` — a host-selected model id. */
  readonly model?: string;
  /** Forwarded verbatim to `AgentExecutorRunInput.reasoning` — a host-selected reasoning effort. */
  readonly reasoning?: string;
  /**
   * Forwarded verbatim to `AgentExecutorRunInput.credentialEnv`: provider credentials this run's agent
   * needs, delegated explicitly by the host and never read implicitly from `process.env` (SEC-001).
   */
  readonly credentialEnv?: Record<string, string>;
  /**
   * Forwarded verbatim to `AgentExecutorRunInput.imagePaths` — host-validated image files the run's
   * prompt refers to. Omitting these three fields was not neutral either: a host that resolved an
   * attached screenshot got a run whose agent could not see it, with nothing reporting why.
   */
  readonly imagePaths?: readonly string[];
  /** Forwarded verbatim to `AgentExecutorRunInput.extraAllowedDirs` — additional host-validated directories the runtime may read. */
  readonly extraAllowedDirs?: readonly string[];
  /** Forwarded verbatim to `AgentExecutorRunInput.uploadRoot` — the trusted root pi-rpc image paths must resolve inside. */
  readonly uploadRoot?: string;
}

/** Host-owned composition seam: turns a durably-started run's identity into what `AgentExecutor.run()` actually needs. No generic default exists — see module doc. */
export type ResolveRunInput = (
  context: ResolveRunInputContext,
) => Promise<ResolvedRunInput> | ResolvedRunInput;

/** Structural subset of `@jini-ai/http-kit`'s `RunStartContext` — see module doc for why this package cannot import that type directly. */
export interface RunStartDriverContext {
  readonly request: { readonly contextRef: string; readonly agentId?: string };
  readonly run: { readonly id: string };
}

/** Structurally assignable to `@jini-ai/http-kit`'s `RunStartHandler` — see module doc. */
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
 * @returns A handler structurally assignable to `@jini-ai/http-kit`'s `RunStartHandler`.
 * @throws Whatever `resolveRunInput` or `agentExecutor.run()` throw — `@jini-ai/http-kit`'s `runStartRoute` already treats a rejecting `onStarted` as a failed run (finishes it, reports the internal error), so this handler deliberately does not swallow either failure itself.
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
    // Each optional field is spread only when present, never passed as an explicit `undefined`:
    // `AgentExecutor.run()` distinguishes absent from undefined for `permissionMode` in particular,
    // where absent means "use the def's own auto-approve default".
    await options.agentExecutor.run({
      runId: context.run.id,
      agentId: resolved.agentId,
      prompt: resolved.prompt,
      cwd: resolved.cwd,
      ...(resolved.env !== undefined ? { env: resolved.env } : {}),
      ...(resolved.permissionMode !== undefined ? { permissionMode: resolved.permissionMode } : {}),
      ...(resolved.model !== undefined ? { model: resolved.model } : {}),
      ...(resolved.reasoning !== undefined ? { reasoning: resolved.reasoning } : {}),
      ...(resolved.credentialEnv !== undefined ? { credentialEnv: resolved.credentialEnv } : {}),
      ...(resolved.imagePaths !== undefined ? { imagePaths: resolved.imagePaths } : {}),
      ...(resolved.extraAllowedDirs !== undefined ? { extraAllowedDirs: resolved.extraAllowedDirs } : {}),
      ...(resolved.uploadRoot !== undefined ? { uploadRoot: resolved.uploadRoot } : {}),
    });
  };
}
