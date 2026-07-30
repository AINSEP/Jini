/**
 * @module frontend-control
 *
 * Assembles the three halves of agent-driven frontend control into one thing a host can hand to
 * `createLocalNodeDaemon`, so wiring it up is a config entry rather than a checklist.
 *
 * The parts already existed and none of them composed: `@jini-ai/daemon`'s `FrontendSessionRegistry`
 * addresses a run to a surface, `@jini-ai/http-kit`'s frontend-session routes carry invocations to a
 * browser and answers back, and `createFrontendCapabilityRegistrations` projects a manifest into
 * gated tools. A host had to construct all three, keep them consistent, and remember to bind a run
 * when it started. Every one of those is a chance to get it subtly wrong, and one of them —
 * binding — is a security decision.
 *
 * **This facade never returns the registry**, and that is its most important property. The
 * registry's `invoke` executes a capability on a real user's screen with no policy check, no
 * confirmation, no timeout, and no audit record — it is safe only because the sole thing that can
 * reach it is a `ToolHandler` that `ToolExecutor` already gated. Handing a host the registry so it
 * could "wire something custom" would hand it a bypass, and a bypass that exists gets used. The
 * host gets an HTTP extension, a set of registrations, and a bind hook; none of them can execute a
 * capability directly.
 *
 * **The bind token is not a field on the run DTO.** A run is a neutral kernel noun and a browser
 * surface is not; putting `frontendBindToken` on `RunCreateRequest` would push a browser concept
 * into a protocol every consumer shares, to serve one transport. Instead the host supplies
 * {@link CreateFrontendControlOptions.resolveBindToken}, which reads the token out of whatever
 * envelope that host already uses — `contextRef` is an opaque host blob precisely so hosts can put
 * their own metadata in it. The engine stays neutral and the host keeps one place to look.
 */
import type { Express } from 'express';
import type { ToolPolicy, ToolRegistration } from '@jini-ai/core';
import {
  createFrontendCapabilityRegistrations,
  createFrontendSessionRegistry,
  type FrontendCapabilitySpec,
} from '@jini-ai/daemon';
import {
  registerFrontendSessionRoutes,
  type RunCreateRequest,
  type RunStartContext,
  type RunStartHandler,
} from '@jini-ai/http-kit';

import type { LocalNodeHttpExtension } from './create-local-node-daemon.js';

export interface FrontendBindErrorContext {
  readonly runId: string;
  readonly error: unknown;
}

export interface CreateFrontendControlOptions {
  /**
   * The capabilities to expose. `@jini-ai/agentic`'s `PAGE_CAPABILITIES` and `@jini-ai/chat-core`'s
   * `CHAT_CAPABILITIES` satisfy this structurally — the engine never imports that vocabulary
   * (see `frontend-capability-tools.ts`'s module doc for why the edge points one way).
   */
  readonly capabilities: readonly FrontendCapabilitySpec[];
  /**
   * Reads this run's bind token out of the host's own run request, or returns `undefined` when the
   * run has no originating surface.
   *
   * Required, and deliberately not defaulted. A default would have to guess where a host keeps the
   * token, and guessing wrong fails *open* in the confusing direction: the run starts, the agent
   * gets its tools, and every page call fails later with "no frontend is bound" — a symptom that
   * looks like a browser problem and is actually a config one.
   *
   * Returning `undefined` is normal, not an error. A run started from a CLI has no surface, and
   * capabilities whose `surface` is `'server'` do not need one.
   */
  readonly resolveBindToken: (request: RunCreateRequest) => string | undefined;
  /** @default `@jini-ai/daemon`'s `denyAllFrontendCapabilityPolicy` — a host grants access explicitly. */
  readonly policy?: ToolPolicy;
  /** @default `@jini-ai/daemon`'s `DEFAULT_FRONTEND_CAPABILITY_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** Applied to every registration. Frontend output is untrusted page text; bound it. */
  readonly maxOutputBytes?: number;
  /**
   * Host-owned sink for a bind failure. Defaults to `console.error`.
   *
   * A failed bind does not fail the run. The run is still legitimate — the agent simply cannot
   * drive the page, and every capability call it makes will say so by name. Killing a run because
   * one optional channel could not be established would turn a degraded session into no session.
   */
  readonly onBindError?: (context: FrontendBindErrorContext) => void;
}

export interface FrontendControl {
  /** Mounts the frontend-session stream and response routes. Pass in `httpExtensions`. */
  readonly httpExtension: LocalNodeHttpExtension;
  /** One gated tool per capability. Pass in `toolRegistrations`. */
  readonly toolRegistrations: readonly ToolRegistration[];
  /**
   * Binds each starting run to the surface that originated it, and releases the binding when the
   * run reaches a terminal state so a long-lived tab does not accumulate dead bindings.
   *
   * Compose it with whatever the host already does on run start — this hook only binds, it never
   * executes anything:
   *
   * ```ts
   * onRunStarted: (context) => {
   *   frontend.bindOnStarted(context);
   *   void startMyAgent(context);
   * }
   * ```
   */
  readonly bindOnStarted: RunStartHandler;
}

function defaultBindErrorSink(context: FrontendBindErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/server] could not bind run "${context.runId}" to a frontend surface`, context.error);
}

/**
 * Builds the frontend-control bundle.
 *
 * @param options - Capabilities to expose, how to find the bind token, and the gate to apply.
 * @returns An HTTP extension, tool registrations, and a run-start bind hook — never the registry.
 * @throws Never at construction. A duplicate capability id throws later, when the registrations are
 * registered, naming the id (`ToolRegistry.register`'s own error).
 *
 * @complexity O(n) in `capabilities`.
 */
export function createFrontendControl(options: CreateFrontendControlOptions): FrontendControl {
  // Closed over, never exposed. See the module doc: reaching this is reaching an ungated `invoke`.
  const registry = createFrontendSessionRegistry();
  const onBindError = options.onBindError ?? defaultBindErrorSink;

  const toolRegistrations = createFrontendCapabilityRegistrations({
    registry,
    capabilities: options.capabilities,
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
  });

  const httpExtension: LocalNodeHttpExtension = (app: Express, context) => {
    registerFrontendSessionRoutes(app, { registry }, context.adapter);
  };

  /**
   * The error boundary the `onBindError` contract actually needs. A `RunStartHandler` throwing is
   * not a no-op: `@jini-ai/http-kit`'s run-start route catches it, marks the run `failed` and answers
   * 500 — so anything inside this hook that can throw can produce exactly the killed run that
   * contract promises never to cause. `resolveBindToken` is host-supplied and reads an opaque host
   * blob (a `JSON.parse` away from throwing), and the sink itself is host-supplied too. A sink that
   * throws leaves nowhere left to report, so that one is swallowed rather than escalated.
   */
  const reportBindError = (context: FrontendBindErrorContext): void => {
    try {
      onBindError(context);
    } catch {
      // Deliberately terminal: the reporting channel is what failed.
    }
  };

  const bindOnStarted: RunStartHandler = ({ request, run, lifecycle }: RunStartContext) => {
    let bindToken: string | undefined;
    try {
      bindToken = options.resolveBindToken(request);
    } catch (error) {
      reportBindError({ runId: run.id, error });
      return;
    }
    if (bindToken === undefined) return;

    let release: () => void;
    try {
      release = registry.bindRunByToken(run.id, bindToken);
    } catch (error) {
      reportBindError({ runId: run.id, error });
      return;
    }

    // Release on terminal so a tab that outlives many runs does not accumulate bindings for runs
    // that ended. `waitForTerminal` rejecting is itself a reason to release, not to keep waiting,
    // so both paths run it — and the whole chain is swallowed, because a bookkeeping failure must
    // never surface as an unhandled rejection that takes the process down.
    void lifecycle
      .waitForTerminal(run.id)
      .then(release, release)
      .catch(() => undefined);
  };

  return { httpExtension, toolRegistrations, bindOnStarted };
}
