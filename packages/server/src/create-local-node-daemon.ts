/**
 * @module create-local-node-daemon
 *
 * The "host preset" (extraction-plan.md §2.4) that lets a brand-new product boot a running daemon
 * process by implementing zero interfaces: assembles `@jini-ai/sqlite`'s durable `EventLog`,
 * `@jini-ai/daemon`'s `RunLifecycle` and `AgentExecutor` (the driver that actually spawns an agent
 * CLI subprocess for 23 of the 24 registered defs — see `@jini-ai/daemon`'s own source-map.md), an HTTP
 * app wrapped in `@jini-ai/http-kit`'s route-registration guard and security middleware, a caller's own
 * `@jini-ai/core` packs, and the generic daemon-status routes, then listens and returns `{url, server,
 * stop}`.
 *
 * **As of 2026-07-29 this is a thin listener/discovery wrapper over `composeJiniKernel`** (see
 * `compose-jini-kernel.ts`). Everything it used to assemble inline — the kernel, the tool registry,
 * every route family — now comes from the shared feature catalog, pinned to the immutable
 * `local-daemon-v1` capability profile so this function's mounted surface, route order, tool
 * registration order and shutdown sequence are byte-for-byte what they have always been. The reason
 * for the change is not this function; it is that a preset assembling routes and tools inline, next
 * to a separate composable surface, guarantees the two eventually disagree about what a "feature"
 * mounts. There is now one path, and this is a caller of it.
 *
 * Callers who want a different surface pass `profile`/`capabilities`/`features`; callers who pass
 * nothing get the historical daemon exactly. `local-daemon-v1` is immutable: a future feature never
 * silently joins it.
 *
 * Also writes (2026-07-21) a `@jini-ai/sidecar`-backed local daemon-registry record — see
 * `resolveDaemonRegistryPath`'s own doc and this file's `CreateLocalNodeDaemonConfig.discoveryFile`
 * — once the real bound port is known, and removes it during `stop()`.
 *
 * This preset supported a switchable `transport: 'express' | 'fastify'` HTTP transport from
 * 2026-07-19 through 2026-07-22; it was removed since nothing ever consumed `transport: 'fastify'`
 * in practice — see `source-map.md`'s dated entry and the `future/fastify-transport` branch.
 */
import { createRequire } from 'node:module';
import type { Server } from 'node:http';

import express, { type Express } from 'express';
import type { DetectedAgent, OAuthCallbackListener } from '@jini-ai/agent-runtime';
import type { Bindings, Principal, ToolRegistration } from '@jini-ai/core';
import type { AnyPack, MissingTokenIds } from '@jini-ai/core/internal';
import type { ResolveRunInput, RunLifecycle } from '@jini-ai/daemon';
import {
  installRouteRegistrationGuard,
  mountPackHttp,
  type AdapterContext,
  type DelegatedToolExecuteRequest,
  type RunStartHandler,
  type WorkspaceRootResolver,
} from '@jini-ai/http-kit';
import { removeDaemonRegistryRecordIfCurrent, resolveDaemonRegistryPath, writeDaemonRegistryRecord } from '@jini-ai/sidecar';

import { composeJiniKernel, type KernelBoundIds } from './compose-jini-kernel.js';
import type { CapabilityId, JiniProfileId } from './feature.js';
import { closeHttpServer, normalizeDaemonBindHost } from './host-bootstrap.js';

const require = createRequire(import.meta.url);
/** This package's own `package.json` version, echoed back by `GET /api/daemon/status`. */
const packageVersion = (require('../package.json') as { readonly version: string }).version;

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TOKEN_ENV_VAR = 'JINI_API_TOKEN';
const DEFAULT_DISABLE_ENV_VAR = 'JINI_DISABLE_API_AUTH';
const DEFAULT_BIND_HOST_ENV_VAR = 'JINI_BIND_HOST';

// Re-exported from their new home so this module's long-standing public surface is unchanged.
export { buildDaemonDbOperations, projectDetectedAgent } from './builtin-features.js';
export { classifyRunFailureForRetry } from './kernel-base.js';

/**
 * Extracts the real bound TCP port from `server.address()`'s result once a `'listening'` event
 * has fired.
 *
 * @param address - The raw return value of `server.address()`.
 * @returns The bound port, or `null` if `address` is `null` (not yet listening), a string (a Unix
 * domain socket path — this module never listens on one), or an `AddressInfo` with a non-positive port.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function resolveBoundPort(address: { port: number } | string | null): number | null {
  if (address == null || typeof address === 'string') return null;
  return address.port > 0 ? address.port : null;
}

/**
 * The host a daemon's reported base URL should use: binding to every interface (`0.0.0.0` / `::`)
 * is not itself a connectable address, so callers are told to use the IPv4 loopback address instead.
 *
 * @param bindHost - The literal host `createLocalNodeDaemon` bound to (already normalized).
 * @returns `'127.0.0.1'` for an all-interfaces bind host, otherwise `bindHost` unchanged.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function resolveReportHost(bindHost: string): string {
  return bindHost === '0.0.0.0' || bindHost === '::' ? '127.0.0.1' : bindHost;
}

export type { KernelBoundIds };

/**
 * Product-level HTTP composition seam. Incubating capabilities register their routes here instead
 * of becoming downward dependencies of this locked host preset.
 */
export interface LocalNodeHttpExtensionContext {
  readonly adapter: AdapterContext;
  readonly lifecycle: RunLifecycle;
  readonly dataDir: string;
}

export type LocalNodeHttpExtension = (app: Express, context: LocalNodeHttpExtensionContext) => void;

export interface CreateLocalNodeDaemonConfig<
  Packs extends readonly AnyPack[],
  BoundIds extends string = KernelBoundIds,
> {
  /** Directory the daemon's durable state lives in. The directory itself must already exist. */
  dataDir: string;
  packs: Packs;
  /**
   * Extends the kernel's own pre-bound `EventLog`/`RunLifecycle` bindings with whatever a pack's
   * own deps require. A callback rather than a pre-built `Bindings` instance because
   * `Bindings.bind()` mutates and returns `this`.
   */
  bindings?: (b: Bindings<KernelBoundIds>) => Bindings<BoundIds>;
  /** TCP port to listen on. Defaults to `0` (ask the OS for an ephemeral free port). */
  port?: number;
  /** Host/address to bind to. Defaults to `'127.0.0.1'` (loopback-only). */
  host?: string;
  /** Env var names for the optional bearer-token gate. Defaults to `JINI_API_TOKEN` / `JINI_DISABLE_API_AUTH`. */
  apiToken?: { tokenEnvVar?: string; disableEnvVar?: string };
  /** Invoked once the HTTP listener has fully closed, before the durable `EventLog` is closed. */
  onShutdown?: () => Promise<void> | void;
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Optional detector override for a host with custom PATH/env policy or a deterministic test fixture. */
  agentDetector?: () => Promise<readonly DetectedAgent[]>;
  /**
   * Optional host-owned driver attached immediately after `POST /api/runs` durably starts a run.
   * Takes full precedence over {@link resolveRunInput} when both are supplied.
   */
  onRunStarted?: RunStartHandler;
  /**
   * Host-owned prompt/cwd/env composition seam. When supplied and `onRunStarted` is not, this
   * daemon builds a default `RunStartHandler` that resolves each run's input through this seam and
   * drives it straight to the zero-config `AgentExecutor`. Ignored when `onRunStarted` is supplied.
   */
  resolveRunInput?: ResolveRunInput;
  /**
   * Resolves a `resourceRef` to a filesystem working directory for `POST /api/resources/:resourceRef/open-in`.
   * Defaults to `denyAllWorkspaceRoots`: the route exists and is reachable but denies every call
   * with `404`, never fabricating or guessing a path.
   */
  resolveWorkspaceRoot?: WorkspaceRootResolver;
  /**
   * Optional product/capability route registrars. They run after the host's security middleware
   * and locked route packs, before caller packs and daemon-status routes.
   */
  httpExtensions?: readonly LocalNodeHttpExtension[];
  /**
   * Host-contributed `{descriptor, handler, policy}` triples, registered into the same internal
   * registry this preset's own gated tools (`jini.terminal.create`, `daemon.db.*`) use — and so
   * executed through the same `ToolExecutor`, inheriting its authorization, confirmation, timeout,
   * cancellation, output truncation, and audit trail.
   *
   * @throws At startup if a `descriptor.id` is already registered — by another entry here, or by
   * one of the preset's own tools. The registry is append-only by design.
   */
  toolRegistrations?: readonly ToolRegistration[];
  /**
   * Resolves the `Principal` one `POST /api/delegated-tool-calls` request executes as.
   *
   * @default the anonymous, role-less delegated principal — inertness comes from deny-by-default
   * tool policies, not from the identity.
   */
  resolveDelegatedPrincipal?: (request: DelegatedToolExecuteRequest) => Principal | Promise<Principal>;
  /**
   * Where this daemon's local discovery record (URL/host/port/pid) is written once it starts
   * listening. Defaults to `<dataDir>/daemon.json`. Pass `false` to disable. Best-effort: a failure
   * here never fails daemon startup or shutdown.
   */
  discoveryFile?: string | false;
  /**
   * Capability profile this daemon composes against.
   *
   * @default 'local-daemon-v1' — the immutable compatibility profile holding exactly the surface
   * this preset has always mounted. Changing it changes which route families exist; see
   * `feature.ts` for the vocabulary and why profiles are versioned rather than edited.
   */
  profile?: JiniProfileId;
  /**
   * Raises or lowers the profile's capability ceiling. A denial always wins: explicitly enabling a
   * feature whose capability is denied here is a startup error naming both, never a silent
   * re-opening of a coarse switch.
   */
  capabilities?: Readonly<Partial<Record<CapabilityId, boolean | undefined>>>;
  /**
   * Turns individual features on or off within whatever the capability ceiling permits — e.g.
   * `{ terminal: false, daemonDb: false }`. A feature turned off here registers **neither its
   * routes nor its tools**, so a disabled capability is absent from the shared registry rather than
   * merely unrouted.
   */
  features?: Readonly<Record<string, boolean | undefined>>;
}

export interface LocalNodeDaemon {
  /** The daemon's real, resolved base URL (reflects the actual bound port even when `port: 0` was requested). */
  readonly url: string;
  readonly server: Server;
  /**
   * Gracefully shuts the daemon down: closes the HTTP listener, disposes every composed feature
   * (releasing e.g. an in-flight xAI OAuth loopback listener), removes the discovery record, runs
   * the caller's `onShutdown` hook, then closes the durable sqlite handles. Idempotent and safe to
   * call more than once, or concurrently.
   */
  stop(): Promise<void>;
  /** Every feature actually composed, with why and what it grants. */
  readonly activeFeatures: readonly string[];
}

/**
 * Boots a complete, runnable `@jini-ai/core` daemon process.
 *
 * Preserves `createDaemon`'s compile-time "missing binding" error through this wrapper: the same
 * `MissingTokenIds<Packs, BoundIds>` conditional gate `createDaemon` itself uses forces a call site
 * with an unbound pack dependency to fail to typecheck with the missing token id(s) visible.
 *
 * **Why two overloads instead of one generic signature:** when a type parameter both has a default
 * and is referenced inside a conditional type in the same parameter position where it also needs to
 * be inferred from a nested callback's return type, TypeScript resolves it to the default *instead
 * of* inferring from the callback, silently defeating the gate on exactly the call shape
 * (`bindings` provided) where it matters most. Splitting into two overloads sidesteps the inference
 * conflict entirely. Both directions are covered by `@ts-expect-error` proofs in
 * `create-local-node-daemon.typecheck.ts`.
 *
 * @param config - See {@link CreateLocalNodeDaemonConfig}.
 * @returns A promise resolving to `{url, server, stop, activeFeatures}` once the daemon is listening.
 * @throws Rejects if the port is already in use (`EADDRINUSE`), the host can't be bound
 * (`EACCES`/`EADDRNOTAVAIL`), the OS reports a listening socket with no resolvable port, or the
 * composition itself is invalid. On any of these every sqlite handle already opened is closed
 * before rejecting, so a failed boot never leaks an open file handle.
 * @complexity O(1) beyond the packs' own `services()`/`http()` costs.
 * @overallScore 100/100
 */
export async function createLocalNodeDaemon<const Packs extends readonly AnyPack[]>(
  config: CreateLocalNodeDaemonConfig<Packs, KernelBoundIds> &
    { bindings?: undefined } &
    (MissingTokenIds<Packs, KernelBoundIds> extends never
      ? unknown
      : { readonly __missingBindings: MissingTokenIds<Packs, KernelBoundIds> }),
): Promise<LocalNodeDaemon>;
export async function createLocalNodeDaemon<const Packs extends readonly AnyPack[], BoundIds extends string>(
  config: CreateLocalNodeDaemonConfig<Packs, BoundIds> &
    { bindings: (b: Bindings<KernelBoundIds>) => Bindings<BoundIds> } &
    (MissingTokenIds<Packs, BoundIds> extends never
      ? unknown
      : { readonly __missingBindings: MissingTokenIds<Packs, BoundIds> }),
): Promise<LocalNodeDaemon>;
export async function createLocalNodeDaemon(
  config: CreateLocalNodeDaemonConfig<readonly AnyPack[], string>,
): Promise<LocalNodeDaemon> {
  const env = config.env ?? process.env;
  const host = normalizeDaemonBindHost(config.host ?? DEFAULT_HOST);
  const requestedPort = config.port ?? 0;
  const registryPath =
    config.discoveryFile === false ? null : (config.discoveryFile ?? resolveDaemonRegistryPath(config.dataDir));

  // `@jini-ai/http-kit`'s own `guardSameOrigin` resolves `bindHost` purely from real
  // `process.env.JINI_BIND_HOST` — it has no parameter path for an injected env. Setting it here,
  // before any request can possibly be served, keeps that route's same-origin decision in sync with
  // the host this daemon actually bound to.
  env[DEFAULT_BIND_HOST_ENV_VAR] = host;

  const resolvedPortRef = { current: requestedPort };
  const adapter: AdapterContext = { resolvedPortRef };

  let shuttingDown = false;
  let stopPromise: Promise<void> | null = null;
  let server: Server;

  // Owned here rather than by the xai feature so `stop()` observes the same ref the routes wrote to.
  const xaiListenerRef: { current: OAuthCallbackListener | null } = { current: null };

  const app: Express = express();
  installRouteRegistrationGuard(app);

  const kernel = await composeJiniKernel({
    app,
    adapter,
    storage: { kind: 'sqlite', dataDir: config.dataDir },
    profile: config.profile ?? 'local-daemon-v1',
    ...(config.capabilities === undefined ? {} : { capabilities: config.capabilities }),
    ...(config.features === undefined ? {} : { features: config.features }),
    packs: config.packs,
    ...(config.bindings === undefined ? {} : { bindings: config.bindings }),
    ...(config.toolRegistrations === undefined ? {} : { toolRegistrations: config.toolRegistrations }),
    security: {
      mode: 'jini-local',
      host,
      apiToken: {
        tokenEnvVar: config.apiToken?.tokenEnvVar ?? DEFAULT_TOKEN_ENV_VAR,
        disableEnvVar: config.apiToken?.disableEnvVar ?? DEFAULT_DISABLE_ENV_VAR,
      },
    },
    env,
    featureOptions: {
      health: { getVersion: () => packageVersion, isShuttingDown: () => shuttingDown },
      runs: {
        ...(config.onRunStarted === undefined ? {} : { onRunStarted: config.onRunStarted }),
        ...(config.resolveRunInput === undefined ? {} : { resolveRunInput: config.resolveRunInput }),
      },
      ...(config.agentDetector === undefined ? {} : { agents: { detector: config.agentDetector } }),
      hostTools: {
        ...(config.resolveWorkspaceRoot === undefined ? {} : { resolveWorkspaceRoot: config.resolveWorkspaceRoot }),
      },
      terminal: {
        ...(config.resolveWorkspaceRoot === undefined ? {} : { resolveWorkspaceRoot: config.resolveWorkspaceRoot }),
      },
      ...(config.resolveDelegatedPrincipal === undefined
        ? {}
        : { delegatedToolCalls: { resolvePrincipal: config.resolveDelegatedPrincipal } }),
      xai: { listenerRef: xaiListenerRef },
      daemonStatus: {
        getVersion: () => packageVersion,
        host,
        getPort: () => resolvedPortRef.current,
        dataDir: config.dataDir,
        isShuttingDown: () => shuttingDown,
        requestShutdown: () => {
          void stop();
        },
      },
    },
    // Product extensions, then caller-pack routes — the historical position, between the locked
    // route families and the daemon-status routes.
    onAfterApiRoutes: (mountedApp, daemon, base) => {
      for (const registerExtension of config.httpExtensions ?? []) {
        registerExtension(mountedApp, { adapter, lifecycle: base.lifecycle, dataDir: config.dataDir });
      }
      mountPackHttp(mountedApp, config.packs, daemon);
    },
  });

  async function stop(): Promise<void> {
    shuttingDown = true;
    if (!stopPromise) {
      stopPromise = (async () => {
        await closeHttpServer(server);
        // Feature teardown sits exactly where the inline xAI-listener stop used to: after the
        // listener is closed, before the discovery record is removed. `disposePacks` is
        // best-effort by contract, so one feature's failure cannot block shutdown.
        await kernel.disposeFeatures();
        if (registryPath !== null) {
          // Best-effort: a daemon that already served every request successfully must not fail its
          // own shutdown just because its discovery record couldn't be removed.
          try {
            await removeDaemonRegistryRecordIfCurrent(registryPath, process.pid);
          } catch {
            // Intentionally swallowed — see the try's own comment.
          }
        }
        // A caller-supplied `onShutdown` failing must never leak any sqlite handle this call
        // opened: `finally` guarantees the close still runs, then the original rejection (if any)
        // propagates to whoever is awaiting `stop()`.
        try {
          await config.onShutdown?.();
        } finally {
          await kernel.closeBase();
        }
      })();
    }
    return stopPromise;
  }

  const listen = (): Promise<Server> =>
    new Promise<Server>((resolve, reject) => {
      let listeningServer: Server;
      try {
        listeningServer = app.listen(requestedPort, host);
      } catch (error) {
        reject(error);
        return;
      }
      listeningServer.once('listening', () => resolve(listeningServer));
      // `app.listen` throws synchronously when the port is already in use on some Node versions,
      // but emits an `error` event on others — wiring both paths means this promise always settles.
      listeningServer.on('error', (error) => reject(error));
    });

  const activeFeatures = kernel.activation.active.map((record) => record.id);

  return await new Promise<LocalNodeDaemon>((resolve, reject) => {
    const failToBind = (error: unknown) => {
      // Best-effort: a failed boot must not leave any resource this call already opened dangling.
      void kernel.close().finally(() => reject(error));
    };

    listen()
      .then((listeningServer) => {
        server = listeningServer;
        // Widen the between-request idle window so kept-alive sockets survive gaps between bursts
        // (e.g. an SSE stream's idle periods); `headersTimeout` must exceed `keepAliveTimeout`.
        server.keepAliveTimeout = 120_000;
        server.headersTimeout = 125_000;

        const boundPort = resolveBoundPort(server.address());
        if (!boundPort) {
          failToBind(
            new Error(`@jini-ai/server: daemon failed to resolve listening port (address=${JSON.stringify(server.address())})`),
          );
          return;
        }
        resolvedPortRef.current = boundPort;
        const reportedUrl = `http://${resolveReportHost(host)}:${boundPort}`;

        // Writing the discovery record is async; this promise must not resolve — handing the URL
        // back to the caller — until the record a same-machine CLI would read is in place.
        void (async () => {
          if (registryPath !== null) {
            try {
              await writeDaemonRegistryRecord(registryPath, {
                url: reportedUrl,
                host: resolveReportHost(host),
                port: boundPort,
                pid: process.pid,
                startedAt: new Date().toISOString(),
              });
            } catch {
              // Best-effort — a daemon that is otherwise fully up must not fail to boot just
              // because its discovery record couldn't be written.
            }
          }
          resolve({ url: reportedUrl, server, stop, activeFeatures });
        })();
      })
      .catch((error) => failToBind(error));
  });
}
