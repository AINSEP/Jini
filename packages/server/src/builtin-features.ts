/**
 * @module builtin-features
 *
 * Every route family this package can mount, expressed as a `JiniFeature` whose `compose` returns
 * one atomic `@jini-ai/core` `Pack`.
 *
 * The load-bearing property is that a family's **tools and its routes are the same pack**. Before
 * this module, `create-local-node-daemon.ts` registered the terminal tool and the three `daemon.db.*`
 * tools into a private registry in one place, and mounted `registerTerminalRoutes`/
 * `registerDaemonDbRoutes` in another — so gating only the route registrations would have left
 * `jini.terminal.create` registered and still reachable through the always-mounted
 * `POST /api/delegated-tool-calls`. Here, a feature that is not selected contributes neither, and
 * there is no second step to gate. `terminal: false` means the pty tool is *absent from the
 * registry*, so a delegated call naming it is an unregistered-tool error rather than a shell.
 *
 * Features borrow kernel infrastructure (`ctx.kernel`) and never own it — see `kernel-base.ts` for
 * why the sqlite connection in particular is shared rather than feature-owned.
 */
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';

import { definePack, type Principal, type ToolRegistration } from '@jini-ai/core';
import { detectAgents, getAgentDef, type DetectedAgent, type OAuthCallbackListener } from '@jini-ai/agent-runtime';
import {
  createDefaultRunStartHandler,
  createRemoteToolEventRecorder,
  isAgentExecutorSupported,
  createTerminalSessionManager,
  createTerminalToolRegistrations,
  type ResolveRunInput,
  type TerminalSessionManager,
} from '@jini-ai/daemon';
import {
  ensureToolCatalogTables,
  getToolCatalogEntry,
  inspectSqliteDatabase,
  reseedToolCatalog,
  searchToolCatalog,
  verifySqliteIntegrity,
} from '@jini-ai/sqlite';
import {
  createDaemonDbToolRegistrations,
  denyAllWorkspaceRoots,
  registerActiveContextRoutes,
  registerAgentRoutes,
  registerConnectorsRoutes,
  registerDaemonDbRoutes,
  registerDaemonStatusRoutes,
  registerDelegatedToolRoutes,
  registerFrontendSessionRoutes,
  registerHealthRoutes,
  registerHostToolsRoutes,
  registerMediaRoutes,
  registerMemoryRoutes,
  registerModelProxyRoutes,
  registerRemoteRunEventRoutes,
  registerResearchRoutes,
  registerRoutineRoutes,
  registerRunRoutes,
  registerTerminalRoutes,
  registerToolCatalogRoutes,
  registerXaiRoutes,
  type AgentSummary,
  type DaemonDbOperations,
  type DaemonDbVacuumResult,
  type DelegatedToolExecuteRequest,
  type FrontendSessionsHttpDeps,
  type MediaHttpDeps,
  type MemoryHttpDeps,
  type RemoteToolBridgeTokenConfig,
  type RoutineHttpDeps,
  type RunStartHandler,
  type WorkspaceRootResolver,
} from '@jini-ai/http-kit';
import type { Express } from 'express';

import { defineJiniFeature, type FeatureBuildContext, type JiniFeature } from './feature.js';

/**
 * The identity every zero-config, `ToolExecutor`-gated tool this module registers (`terminal.create`,
 * `daemon.db.*`) executes as. A composition using these has no multi-tenant identity subsystem of
 * its own — the bearer gate is authenticated-or-not, not per-caller — so every authenticated caller
 * already shares one trust boundary and a single fixed `Principal` removes no distinction that
 * existed before it.
 */
export const LOCAL_DAEMON_PRINCIPAL: Principal = { id: 'local-daemon' };

const require = createRequire(import.meta.url);
/** This package's own version, the default a composition reports when a host names none. */
const packageVersion = (require('../package.json') as { readonly version: string }).version;

/**
 * The identity a delegated tool call runs as when the host supplies no resolver. Carries **no
 * roles**, deliberately.
 *
 * ## What actually makes this inert, because an earlier version of this comment named the wrong
 * mechanism
 *
 * It previously claimed inertness came from "every registered tool's own deny-by-default
 * `ToolPolicy`". That is **false**, and believing it is dangerous. `@jini-ai/cms` registers every
 * one of its tools with a pass-through `policy: { authorize: () => 'allow' }` — deliberately, and
 * documented as such in `core/tools/registration-kit.ts`: each tool's permission is evaluated
 * exactly once, inside the domain function or via that file's `requireToolPermission`, so a second
 * evaluator in the policy would be the bug rather than the guard.
 *
 * What actually denies this principal is the identity layer being fail-closed on an UNKNOWN
 * subject: `identity/authorize.ts` starts with `principals.findById(...)` and returns
 * `{ allowed: false, reason: 'principal_disabled' }` when no row comes back. `anonymous-delegated`
 * has no row, so every permission-gated tool refuses it.
 *
 * ## The residual risk that follows from that, stated plainly
 *
 * The protection is the *tool's own* permission check, not this identity and not the registry. A
 * tool registered by some other host with a permissive `ToolPolicy` **and** no internal permission
 * check would execute for this principal. That is exactly why `@jini-ai/http-kit`'s
 * `DelegatedToolsHttpDeps.resolvePrincipal` documents itself as mandatory, and why the fallback
 * below warns rather than staying silent.
 */
export const ANONYMOUS_DELEGATED_PRINCIPAL: Principal = { id: 'anonymous-delegated' };

/**
 * The `resolvePrincipal` fallback, wrapped so the fallback is announced once at composition rather
 * than taken silently. Warns at wiring time, not per request: a per-request warning on a route that
 * can be called in a loop is a log-flood, and the thing worth knowing is a deployment fact, not a
 * request fact.
 */
function warnAndUseAnonymousDelegatedPrincipal(): () => Principal {
  // eslint-disable-next-line no-console
  console.warn(
    '[@jini-ai/server] delegatedToolCalls is enabled without `resolvePrincipal`; delegated tool ' +
      `calls will run as "${ANONYMOUS_DELEGATED_PRINCIPAL.id}", which every permission-gated tool ` +
      'refuses (the identity layer is fail-closed on an unknown subject) but a tool with a ' +
      'permissive ToolPolicy and no internal permission check would still execute for.',
  );
  return () => ANONYMOUS_DELEGATED_PRINCIPAL;
}

/** Per-feature configuration, closed over when the catalog is built. */
export interface BuiltInFeatureOptions {
  readonly health?: {
    readonly getVersion?: () => string | Promise<string>;
    /** Folded into readiness as a `notShuttingDown` check. @default always false */
    readonly isShuttingDown?: () => boolean;
  };
  readonly runs?: {
    readonly onRunStarted?: RunStartHandler;
    readonly resolveRunInput?: ResolveRunInput;
  };
  readonly agents?: {
    readonly detector?: () => Promise<readonly DetectedAgent[]>;
  };
  readonly hostTools?: { readonly resolveWorkspaceRoot?: WorkspaceRootResolver };
  readonly terminal?: {
    readonly resolveWorkspaceRoot?: WorkspaceRootResolver;
    readonly principal?: Principal;
  };
  readonly daemonDb?: { readonly principal?: Principal };
  readonly delegatedToolCalls?: {
    readonly resolvePrincipal?: (request: DelegatedToolExecuteRequest) => Principal | Promise<Principal>;
  };
  readonly remoteRunEvents?: { readonly tokenConfig?: RemoteToolBridgeTokenConfig };
  readonly xai?: { readonly listenerRef?: { current: OAuthCallbackListener | null } };
  /**
   * Only `requestShutdown` is required, and deliberately so: everything else here
   * (`getVersion`/`host`/`getPort`/`dataDir`/`isShuttingDown`) is already known to the composition
   * and is derived when omitted, but *what shutdown means* is not something this package can invent
   * on a host's behalf. Defaulting it to a no-op would mount a shutdown endpoint that silently does
   * nothing — the "reports stopped while still serving" failure mode, shipped as a default.
   */
  readonly daemonStatus?: {
    readonly requestShutdown: () => void;
    readonly getVersion?: () => string | Promise<string>;
    readonly host?: string;
    readonly getPort?: () => number;
    readonly dataDir?: string;
    readonly isShuttingDown?: () => boolean;
  };
  /** Required to activate `memory` — this package has no note store of its own to default to. */
  readonly memory?: MemoryHttpDeps;
  readonly routines?: RoutineHttpDeps;
  readonly media?: MediaHttpDeps;
  readonly frontendSessions?: FrontendSessionsHttpDeps;
}

/** Thrown when a feature is activated without the host-supplied options it cannot default. */
function requireOptions<T>(value: T | undefined, featureId: string, optionPath: string): T {
  if (value === undefined) {
    throw new Error(
      `jini: feature "${featureId}" is active but "${optionPath}" was not supplied — ` +
        `this feature has no zero-config default. Supply it, or disable "${featureId}".`,
    );
  }
  return value;
}

function requireSqlite(context: FeatureBuildContext, featureId: string) {
  if (context.kernel.sqlite === null) {
    throw new Error(
      `jini: feature "${featureId}" needs sqlite storage but this composition uses memory storage — ` +
        `use storage: { kind: 'sqlite', dataDir } or disable "${featureId}".`,
    );
  }
  return context.kernel.sqlite;
}

/**
 * `DaemonDbOperations` over a caller-owned connection. `vacuum` measures the primary file's on-disk
 * size before/after (not the `-wal`/`-shm` sum), since a fresh `VACUUM` checkpoints and shrinks the
 * primary file itself, which is what "reclaimed" means here.
 */
export function buildDaemonDbOperations(db: import('better-sqlite3').Database, file: string): DaemonDbOperations {
  return {
    inspect: () => inspectSqliteDatabase({ db, file }),
    verify: (quick: boolean) => verifySqliteIntegrity({ db, quick }),
    vacuum: (): DaemonDbVacuumResult => {
      const startedAt = Date.now();
      const beforeBytes = statSync(file).size;
      db.exec('VACUUM');
      const afterBytes = statSync(file).size;
      return {
        ok: true,
        beforeBytes,
        afterBytes,
        reclaimedBytes: Math.max(0, beforeBytes - afterBytes),
        elapsedMs: Date.now() - startedAt,
      };
    },
  };
}

/**
 * Whether the `agents` feature should advertise this probe result.
 *
 * Discovery scans every runtime definition, but `AgentExecutor` refuses to drive any def its
 * `assessAgentExecutorCompatibility` rejects — see `@jini-ai/daemon`'s own module doc. All currently
 * registered defs pass that check, but a future def may not. Advertising one that doesn't yields an
 * agent a user can select and then cannot run — so the executor's own compatibility answer is applied
 * here, at the surface that offers the choice.
 *
 * Assessed against the **full** `RuntimeAgentDef` resolved by id, not the `DetectedAgent` passed in:
 * the projected type omits `maxPromptArgBytes`, and the argv-bound defs (`aider`, `deepseek`) qualify
 * solely through it, so judging the projection would drop two working agents.
 *
 * An id with no registered def is **kept**, not dropped. A host supplying its own `detector` may
 * legitimately surface agents outside `AGENT_DEFS`, driven by something other than this executor;
 * there is nothing to assess, and refusing to advertise them would break that host on no evidence.
 *
 * @param agent - One probe result from the active detector.
 * @returns `true` when the agent should appear in `GET /api/agents`.
 * @complexity O(1) — one registry lookup plus fixed field checks.
 * @overallScore 100/100
 */
export function isExecutableDetectedAgent(agent: DetectedAgent): boolean {
  const def = getAgentDef(agent.id);
  return def === null || isAgentExecutorSupported(def);
}

/** Projects a real `DetectedAgent` probe onto the HTTP summary shape. */
export function projectDetectedAgent(agent: DetectedAgent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    available: agent.available,
    ...(agent.version !== undefined ? { version: agent.version } : {}),
    ...(agent.authStatus !== undefined ? { authStatus: agent.authStatus } : {}),
    models: agent.models.map(({ id, label }) => ({ id, label })),
    ...(agent.reasoningOptions !== undefined
      ? { reasoningOptions: agent.reasoningOptions.map(({ id, label }) => ({ id, label })) }
      : {}),
    modelsSource: agent.modelsSource,
    ...(agent.supportsCustomModel !== undefined ? { supportsCustomModel: agent.supportsCustomModel } : {}),
    ...(agent.diagnostics?.[0]?.message ? { diagnostic: agent.diagnostics[0].message } : {}),
  };
}

/**
 * Builds the full built-in feature catalog with `options` closed over.
 *
 * Order is composition order, and it is deliberately the order `createLocalNodeDaemon` has always
 * registered these families in — so the route-registration inventory, the tool-registration order,
 * and therefore which id a duplicate-registration error names, are all unchanged.
 */
export function createBuiltInFeatures(options: BuiltInFeatureOptions = {}): readonly JiniFeature[] {
  const healthFeature = defineJiniFeature({
    id: 'health',
    // No capability: a liveness/readiness probe grants no authority and is always permitted.
    provides: [],
    phase: 'probe',
    compose: (context) => ({
      pack: definePack({
        name: 'jini.health',
        deps: [],
        services: () => ({ context }),
        http: (app, services) => {
          const sqlite = services.context.kernel.sqlite;
          const isShuttingDown = options.health?.isShuttingDown ?? (() => false);
          registerHealthRoutes(
            app as Express,
            {
              getVersion: options.health?.getVersion ?? (() => packageVersion),
              // Borrows the kernel's connection — see kernel-base.ts on why this is not
              // `daemonDb`'s to own. A readiness check must never itself throw and crash the
              // route: a thrown pragma read is a legitimate "not ready" signal, not a 500.
              checkReadiness: async () => {
                const notShuttingDown = !isShuttingDown();
                if (sqlite === null) return { ok: notShuttingDown, checks: { notShuttingDown } };
                let dbOk: boolean;
                try {
                  dbOk = verifySqliteIntegrity({ db: sqlite.connection, quick: true }).ok;
                } catch {
                  dbOk = false;
                }
                return { ok: dbOk && notShuttingDown, checks: { db: dbOk, notShuttingDown } };
              },
            },
            services.context.adapter,
          );
        },
      }),
    }),
  });

  const runsFeature = defineJiniFeature({
    id: 'runs',
    provides: ['run:transport'],
    compose: (context) => {
      // `onRunStarted` always wins when supplied. Otherwise a supplied `resolveRunInput` gets the
      // default handler built for it, driving the kernel's own `AgentExecutor`. With neither, runs
      // durably start with no driver attached.
      const onStarted =
        options.runs?.onRunStarted ??
        (options.runs?.resolveRunInput === undefined
          ? undefined
          : createDefaultRunStartHandler({
              agentExecutor: context.kernel.agentExecutor,
              resolveRunInput: options.runs.resolveRunInput,
            }));
      return {
        pack: definePack({
          name: 'jini.runs',
          deps: [],
          services: () => ({ context }),
          http: (app, services) => {
            registerRunRoutes(
              app as Express,
              {
                lifecycle: services.context.kernel.lifecycle,
                ...(onStarted === undefined ? {} : { onStarted }),
              },
              services.context.adapter,
            );
          },
        }),
      };
    },
  });

  const agentsFeature = defineJiniFeature({
    id: 'agents',
    provides: ['agent:discovery'],
    compose: (context) => {
      // Promise-cached so concurrent clients never spawn duplicate probe sets; invalidated by
      // POST /api/agents/rescan.
      const detector = options.agents?.detector ?? detectAgents;
      let scan: Promise<readonly AgentSummary[]> | null = null;
      const scanAgents = (force: boolean): Promise<readonly AgentSummary[]> => {
        if (force) scan = null;
        if (!scan) {
          const pending: Promise<readonly AgentSummary[]> = detector()
            // Filtered before projection so the executor's answer is computed from the full def —
            // see `isExecutableDetectedAgent`'s doc for why the projected shape is not enough.
            .then((agents) => agents.filter(isExecutableDetectedAgent).map(projectDetectedAgent))
            .catch((error: unknown) => {
              // Keyed by promise identity, not "whatever is cached when this failure lands": a slow
              // scan that fails after `POST /api/agents/rescan` already replaced it with a newer,
              // successful one must invalidate only its own entry. Clearing unconditionally evicts
              // the newer result and forces a duplicate probe of every agent CLI on the machine.
              if (scan === pending) scan = null;
              throw error;
            });
          scan = pending;
        }
        return scan;
      };
      return {
        pack: definePack({
          name: 'jini.agents',
          deps: [],
          services: () => ({ context }),
          http: (app, services) => {
            registerAgentRoutes(
              app as Express,
              { listAgents: () => scanAgents(false), rescanAgents: () => scanAgents(true) },
              services.context.adapter,
            );
          },
        }),
      };
    },
  });

  const hostToolsFeature = defineJiniFeature({
    id: 'hostTools',
    // Lists editors on PATH (`host:read`) and launches one (`host:exec`).
    provides: ['host:read', 'host:exec'],
    compose: (context) => ({
      pack: definePack({
        name: 'jini.hostTools',
        deps: [],
        services: () => ({ context }),
        http: (app, services) => {
          registerHostToolsRoutes(app as Express, services.context.adapter, {
            resolveRoot: options.hostTools?.resolveWorkspaceRoot ?? denyAllWorkspaceRoots,
          });
        },
      }),
    }),
  });

  const modelProxyFeature = defineJiniFeature({
    id: 'modelProxy',
    provides: ['net:egress'],
    compose: (context) => ({
      pack: definePack({
        name: 'jini.modelProxy',
        deps: [],
        services: () => ({ context }),
        http: (app, services) => registerModelProxyRoutes(app as Express, {}, services.context.adapter),
      }),
    }),
  });

  const activeContextFeature = defineJiniFeature({
    id: 'activeContext',
    provides: ['host:read'],
    compose: (context) => ({
      pack: definePack({
        name: 'jini.activeContext',
        deps: [],
        services: () => ({ context }),
        http: (app, services) =>
          registerActiveContextRoutes(
            app as Express,
            // Mandatory but with an honest, harmless answer this package can always give:
            // "unknown". It has no Project/Workspace noun of its own to resolve a name from.
            { resolveResource: (): undefined => undefined },
            services.context.adapter,
          ),
      }),
    }),
  });

  const terminalFeature = defineJiniFeature({
    id: 'terminal',
    provides: ['host:exec'],
    compose: (context) => {
      const manager: TerminalSessionManager = createTerminalSessionManager();
      return {
        pack: definePack({
          name: 'jini.terminal',
          deps: [],
          services: () => ({ context, manager }),
          // THE gap closure: the pty tool and the pty routes are one contribution. A composition
          // without this feature never registers `jini.terminal.create` at all, so a delegated call
          // naming it is an unregistered-tool error — not a shell.
          tools: (services): readonly ToolRegistration[] => [
            createTerminalToolRegistrations({ manager: services.manager }).create,
          ],
          http: (app, services) =>
            registerTerminalRoutes(
              app as Express,
              {
                manager: services.manager,
                toolExecutor: services.context.kernel.toolExecutor,
                principal: options.terminal?.principal ?? LOCAL_DAEMON_PRINCIPAL,
                resolveRoot: options.terminal?.resolveWorkspaceRoot ?? denyAllWorkspaceRoots,
              },
              services.context.adapter,
            ),
        }),
      };
    },
  });

  const daemonDbFeature = defineJiniFeature({
    id: 'daemonDb',
    provides: ['db:admin'],
    compose: (context) => {
      const sqlite = requireSqlite(context, 'daemonDb');
      // Borrowed, never owned: `kernel.close()` closes this connection. See kernel-base.ts.
      const registrations = createDaemonDbToolRegistrations({
        operations: buildDaemonDbOperations(sqlite.connection, sqlite.eventsDbPath),
      });
      return {
        pack: definePack({
          name: 'jini.daemonDb',
          deps: [],
          services: () => ({ context }),
          tools: (): readonly ToolRegistration[] => [registrations.inspect, registrations.verify, registrations.vacuum],
          http: (app, services) =>
            registerDaemonDbRoutes(
              app as Express,
              {
                toolExecutor: services.context.kernel.toolExecutor,
                principal: options.daemonDb?.principal ?? LOCAL_DAEMON_PRINCIPAL,
              },
              services.context.adapter,
            ),
        }),
      };
    },
  });

  const toolCatalogFeature = defineJiniFeature({
    id: 'toolCatalog',
    provides: ['tool:catalog'],
    compose: (context) => {
      const sqlite = requireSqlite(context, 'toolCatalog');
      return {
        pack: definePack({
          name: 'jini.toolCatalog',
          deps: [],
          services: () => ({ context }),
          http: (app, services) =>
            registerToolCatalogRoutes(
              app as Express,
              {
                catalog: {
                  search: (query: string, limit?: number) => searchToolCatalog(sqlite.connection, query, limit),
                  describe: (id: string) => getToolCatalogEntry(sqlite.connection, id),
                },
              },
              services.context.adapter,
            ),
        }),
        // Runs once EVERY active feature's tools are registered — the one ordering a Pack cannot
        // express itself. Seeding from inside this pack's own `tools` would snapshot a registry
        // that is still being filled, and the catalog would be silently partial.
        afterTools: () => {
          ensureToolCatalogTables(sqlite.connection);
          reseedToolCatalog(
            sqlite.connection,
            context.kernel.registry.list().map((descriptor) => ({
              id: descriptor.id,
              description: descriptor.description ?? descriptor.id,
              source: 'first-party',
              ...(descriptor.inputSchema === undefined ? {} : { inputSchema: descriptor.inputSchema }),
            })),
          );
        },
      };
    },
  });

  const delegatedToolCallsFeature = defineJiniFeature({
    id: 'delegatedToolCalls',
    provides: ['tool:delegated'],
    requires: ['runs'],
    compose: (context) => ({
      pack: definePack({
        name: 'jini.delegatedToolCalls',
        deps: [],
        services: () => ({ context }),
        http: (app, services) =>
          registerDelegatedToolRoutes(
            app as Express,
            {
              lifecycle: services.context.kernel.lifecycle,
              toolExecutor: services.context.kernel.toolExecutor,
              // `DelegatedToolsHttpDeps.resolvePrincipal` documents itself as MANDATORY — "there is
              // no safe default identity this package could assume on a host's behalf" — and this
              // line supplied one anyway, silently. The default stays (removing it is a breaking
              // change for hosts already relying on it, and is the owner's call, not this file's)
              // but it no longer happens quietly: a host that enables this route without deciding
              // who its calls run as should learn that from a startup line, not from an audit.
              // See ANONYMOUS_DELEGATED_PRINCIPAL for what does and does not make it inert.
              resolvePrincipal:
                options.delegatedToolCalls?.resolvePrincipal ?? warnAndUseAnonymousDelegatedPrincipal(),
            },
            services.context.adapter,
          ),
      }),
    }),
  });

  const connectorsFeature = defineJiniFeature({
    id: 'connectors',
    provides: ['net:egress'],
    compose: (context) => ({
      pack: definePack({
        name: 'jini.connectors',
        deps: [],
        services: () => ({ context }),
        http: (app, services) => registerConnectorsRoutes(app as Express, {}, services.context.adapter),
      }),
    }),
  });

  const researchFeature = defineJiniFeature({
    id: 'research',
    provides: ['net:egress'],
    compose: (context) => ({
      pack: definePack({
        name: 'jini.research',
        deps: [],
        services: () => ({ context }),
        http: (app, services) => registerResearchRoutes(app as Express, {}, services.context.adapter),
      }),
    }),
  });

  const xaiFeature = defineJiniFeature({
    id: 'xai',
    provides: ['net:egress'],
    compose: (context) => {
      const sqlite = requireSqlite(context, 'xai');
      // Owned here (rather than left to xai.ts's internal default) so this feature's `dispose` can
      // close an in-flight OAuth loopback listener — otherwise the fixed 127.0.0.1:56121 socket
      // outlives the composition by up to its 30-minute self-close timeout.
      const listenerRef = options.xai?.listenerRef ?? { current: null as OAuthCallbackListener | null };
      return {
        pack: definePack({
          name: 'jini.xai',
          deps: [],
          services: () => ({ context, listenerRef }),
          http: (app, services) =>
            registerXaiRoutes(
              app as Express,
              { dataDir: sqlite.dataDir, listenerRef: services.listenerRef },
              services.context.adapter,
            ),
          dispose: async (services) => {
            const listener = services.listenerRef.current;
            services.listenerRef.current = null;
            // Best-effort — the listener self-closes on its own timeout anyway.
            if (listener) await listener.stop();
          },
        }),
      };
    },
  });

  const remoteRunEventsFeature = defineJiniFeature({
    id: 'remoteRunEvents',
    // Never granted by any shipped profile: writing agent events into a run this process does not
    // own is strictly more authority than executing a tool through the policy-gated delegated route.
    provides: ['run:inject'],
    requires: ['runs'],
    compose: (context) => ({
      pack: definePack({
        name: 'jini.remoteRunEvents',
        deps: [],
        services: () => ({ context }),
        http: (app, services) =>
          registerRemoteRunEventRoutes(
            app as Express,
            {
              lifecycle: services.context.kernel.lifecycle,
              recorder: createRemoteToolEventRecorder({ lifecycle: services.context.kernel.lifecycle }),
              ...(options.remoteRunEvents?.tokenConfig === undefined
                ? {}
                : { tokenConfig: options.remoteRunEvents.tokenConfig }),
              env: services.context.env,
            },
            services.context.adapter,
          ),
      }),
    }),
  });

  const memoryFeature = defineJiniFeature({
    id: 'memory',
    provides: ['memory:store'],
    compose: (context) => {
      const deps = requireOptions(options.memory, 'memory', 'featureOptions.memory');
      return {
        pack: definePack({
          name: 'jini.memory',
          deps: [],
          services: () => ({ context }),
          http: (app, services) => registerMemoryRoutes(app as Express, deps, services.context.adapter),
        }),
      };
    },
  });

  const routinesFeature = defineJiniFeature({
    id: 'routines',
    provides: ['routines:schedule'],
    compose: (context) => {
      const deps = requireOptions(options.routines, 'routines', 'featureOptions.routines');
      return {
        pack: definePack({
          name: 'jini.routines',
          deps: [],
          services: () => ({ context }),
          http: (app, services) => registerRoutineRoutes(app as Express, deps, services.context.adapter),
        }),
      };
    },
  });

  const mediaFeature = defineJiniFeature({
    id: 'media',
    provides: ['media:generate'],
    compose: (context) => {
      const deps = requireOptions(options.media, 'media', 'featureOptions.media');
      return {
        pack: definePack({
          name: 'jini.media',
          deps: [],
          services: () => ({ context }),
          http: (app, services) => registerMediaRoutes(app as Express, deps, services.context.adapter),
        }),
      };
    },
  });

  const frontendSessionsFeature = defineJiniFeature({
    id: 'frontendSessions',
    provides: ['ui:session'],
    compose: (context) => {
      const deps = requireOptions(options.frontendSessions, 'frontendSessions', 'featureOptions.frontendSessions');
      return {
        pack: definePack({
          name: 'jini.frontendSessions',
          deps: [],
          services: () => ({ context }),
          http: (app, services) => registerFrontendSessionRoutes(app as Express, deps, services.context.adapter),
        }),
      };
    },
  });

  const daemonStatusFeature = defineJiniFeature({
    id: 'daemonStatus',
    provides: ['daemon:control'],
    phase: 'status',
    compose: (context) => {
      const supplied = requireOptions(options.daemonStatus, 'daemonStatus', 'featureOptions.daemonStatus.requestShutdown');
      const deps = {
        getVersion: supplied.getVersion ?? (() => packageVersion),
        host: supplied.host ?? '127.0.0.1',
        getPort: supplied.getPort ?? (() => context.adapter.resolvedPortRef.current),
        dataDir: supplied.dataDir ?? context.kernel.sqlite?.dataDir ?? '',
        isShuttingDown: supplied.isShuttingDown ?? (() => false),
        requestShutdown: supplied.requestShutdown,
      };
      return {
        pack: definePack({
          name: 'jini.daemonStatus',
          deps: [],
          services: () => ({ context }),
          http: (app, services) => registerDaemonStatusRoutes(app as Express, deps, services.context.adapter),
        }),
      };
    },
  });

  return [
    healthFeature,
    runsFeature,
    agentsFeature,
    hostToolsFeature,
    modelProxyFeature,
    activeContextFeature,
    terminalFeature,
    daemonDbFeature,
    toolCatalogFeature,
    delegatedToolCallsFeature,
    connectorsFeature,
    researchFeature,
    xaiFeature,
    remoteRunEventsFeature,
    memoryFeature,
    routinesFeature,
    mediaFeature,
    frontendSessionsFeature,
    daemonStatusFeature,
  ];
}
