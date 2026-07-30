/**
 * @module compose-jini-kernel
 *
 * The one composition path. Everything this package can mount goes through here — including
 * `createLocalNodeDaemon`, which is now a listener/discovery wrapper over this function rather than
 * a second, independently-drifting assembly.
 *
 * That single-path property is the point. When a preset assembles routes and tools inline *and* a
 * separate "composable" surface exists beside it, the two disagree the moment someone adds a family
 * to one and forgets the other — and the disagreement is invisible, because both compile. Here a
 * new family is a `JiniFeature` in the catalog, and every consumer picks it up or explicitly does
 * not; there is no second place to forget.
 *
 * Mounting order is fixed and load-bearing:
 *
 * 1. `probe`-phase routes — before the body parser and before any auth, so liveness/readiness never
 *    depends on either.
 * 2. `sidecar-strict`'s bearer gate, when that mode is active — ahead of the body parser, so a
 *    request this gate will reject never has its body parsed at all. It needs only `req.path` and the
 *    `Authorization` header.
 * 3. the JSON body parser, then (when this composition owns security) the remaining gates:
 *    `sidecar-strict`'s origin guard, or `jini-local`'s bearer + origin pair.
 * 4. `api`-phase routes, in catalog order.
 * 5. the caller's own `onAfterApiRoutes` hook — product HTTP extensions and pack routes.
 * 6. `status`-phase routes, last, so a status surface reports on a fully assembled app.
 *
 * Tools are registered for every active feature **before any route mounts**, so a feature's routes
 * can assume its own tools exist, and `afterTools` hooks (the tool catalog's durable snapshot) see
 * the complete registry rather than a partial one.
 */
import express, { type Express } from 'express';

import {
  bindings,
  createDaemon,
  disposePacks,
  registerPackTools,
  type Bindings,
  type Daemon,
  type Pack,
  type ToolRegistration,
} from '@jini-ai/core';
import { AgentExecutorToken, EventLogToken, RunLifecycleToken } from '@jini-ai/daemon';
import {
  mountPackHttp,
  registerApiBearerAuthMiddleware,
  registerApiOriginGuardMiddleware,
  requireStrictBearerToken,
  configuredAllowedOrigins,
  type AdapterContext,
} from '@jini-ai/http-kit';

import { createBuiltInFeatures, type BuiltInFeatureOptions } from './builtin-features.js';
import {
  JINI_PROFILES,
  type AnyPack,
  type CapabilityId,
  type FeatureBuildContext,
  type FeaturePhase,
  type JiniFeature,
  type JiniProfileId,
} from './feature.js';
import { resolveFeatureActivation, type FeatureActivationPlan } from './feature-activation.js';
import { createJiniKernelBase, type JiniKernelBase, type JiniKernelStorage } from './kernel-base.js';

/** The token ids every composition binds before any caller customization runs. */
export type KernelBoundIds = 'jini.eventLog' | 'jini.runLifecycle' | 'jini.agentExecutor';

/** How this composition's `/api` surface is guarded. */
export type JiniKernelSecurity =
  /** The caller's app already owns authentication/origin policy. Nothing is installed. */
  | { readonly mode: 'host' }
  /** This composition installs the loopback-daemon bearer gate and origin guard. */
  | {
      readonly mode: 'jini-local';
      readonly host: string;
      readonly apiToken?: { readonly tokenEnvVar?: string; readonly disableEnvVar?: string };
    }
  /**
   * Like `jini-local`, but for a daemon whose threat model is **another process running as the same
   * OS user**, not a remote attacker: every `/api` request must carry the bearer token, including
   * one arriving from `127.0.0.1`, and an unconfigured token fails closed with 503 rather than
   * silently serving unauthenticated callers.
   *
   * Use this when the daemon holds authority a co-resident process should not be able to borrow —
   * starting real agent runs, executing tools against a real database. A loopback bind keeps remote
   * hosts out but does nothing about a sibling process, which is precisely what `jini-local`'s
   * loopback short-circuit trusts.
   *
   * `probe`-phase routes (health/readiness/version) mount before this gate and therefore stay
   * reachable without a token — monitoring never needs a secret.
   */
  | {
      readonly mode: 'sidecar-strict';
      readonly host: string;
      /**
       * Env var carrying the required bearer token. Required with no default — this package does
       * not name a host's secret, matching every other host-resolved seam in the engine.
       */
      readonly tokenEnvVar: string;
      /**
       * Exact `req.path` values this gate does not apply to. Defaults to none. Every entry is a hole
       * in the gate, so each one belongs at the mount site with a stated reason — the intended use
       * is a callback route whose only legitimate caller cannot yet present a credential.
       */
      readonly exemptPaths?: readonly string[];
    };

export interface ComposeJiniKernelConfig {
  /** The app to mount onto. Always caller-supplied — this function never opens a listener. */
  readonly app: Express;
  readonly adapter: AdapterContext;
  readonly storage: JiniKernelStorage;
  /** @default 'agent-core-v1' — the conservative embedding posture. */
  readonly profile?: JiniProfileId;
  /** Raises or lowers the profile's capability ceiling. A denial here always wins. */
  readonly capabilities?: Readonly<Partial<Record<CapabilityId, boolean | undefined>>>;
  /** Names built-in (or `extraFeatures`) features on/off within that ceiling. */
  readonly features?: Readonly<Record<string, boolean | undefined>>;
  readonly featureOptions?: BuiltInFeatureOptions;
  /** Product features. Same shape, same activation rules, same atomicity — no second path. */
  readonly extraFeatures?: readonly JiniFeature[];
  /** Host-contributed tools, registered after every active feature's own. */
  readonly toolRegistrations?: readonly ToolRegistration[];
  /** Caller-owned `@jini-ai/core` packs, composed against the kernel bindings. */
  readonly packs?: readonly AnyPack[];
  readonly bindings?: (b: Bindings<KernelBoundIds>) => Bindings<string>;
  readonly agentExecutor?: Parameters<typeof createJiniKernelBase>[0]['agentExecutor'];
  /** @default { mode: 'host' } */
  readonly security?: JiniKernelSecurity;
  /** @default true — set false when the caller's app already parses JSON bodies. */
  readonly installJsonBodyParser?: boolean;
  /**
   * Runs after `api`-phase routes and before `status`-phase ones.
   *
   * Receives `base` explicitly rather than letting the caller close over the `JiniKernel` this
   * function returns: the hook fires *during* composition, so that binding does not exist yet and
   * reading it would be a temporal-dead-zone `ReferenceError` at boot.
   */
  readonly onAfterApiRoutes?: (app: Express, daemon: Daemon<readonly AnyPack[]>, base: JiniKernelBase) => void;
  /** @default process.env */
  readonly env?: NodeJS.ProcessEnv;
}

export interface JiniKernel {
  readonly base: JiniKernelBase;
  /** The composed caller packs' services, exactly as `createDaemon` returns them. */
  readonly daemon: Daemon<readonly AnyPack[]>;
  /** What was mounted, why, and what it grants — the machine-readable answer to "is X on?". */
  readonly activation: FeatureActivationPlan;
  /**
   * Runs every active feature pack's `dispose`, in reverse composition order, best-effort. Separate
   * from {@link closeBase} so a composition root can interleave its own shutdown steps between the
   * two — which is exactly what the standalone daemon does.
   */
  disposeFeatures(): Promise<void>;
  /**
   * Runs every **caller** pack's `dispose`, in reverse composition order, best-effort. Idempotent.
   *
   * This composition called `createDaemon` on `config.packs`, so it — not the caller — is what
   * built their services; a pack whose `services()` opened a socket, a timer or a database handle
   * has no other owner to release it. Kept separate from {@link disposeFeatures} for the same
   * reason that one is separate from {@link closeBase}: a composition root shuts down in its own
   * order, and the standalone daemon interleaves discovery-record removal and the host's
   * `onShutdown` hook between these steps.
   */
  disposeCallerPacks(): Promise<void>;
  /** Closes the kernel-owned sqlite handles. Idempotent. */
  closeBase(): Promise<void>;
  /** {@link disposeFeatures}, then {@link disposeCallerPacks}, then {@link closeBase}. */
  close(): Promise<void>;
}

function mountPhase(
  phase: FeaturePhase,
  app: Express,
  composed: readonly ComposedFeature[],
  daemon: Daemon<readonly AnyPack[]>,
): void {
  for (const entry of composed) {
    if ((entry.feature.phase ?? 'api') !== phase) continue;
    mountPackHttp(app, [entry.pack], daemon);
  }
}

interface ComposedFeature {
  readonly feature: JiniFeature;
  readonly pack: AnyPack;
  readonly afterTools?: () => void;
}

/**
 * Composes the kernel, the selected feature set, and the caller's own packs onto `config.app`.
 *
 * @throws For any activation error (unknown feature id, denied capability under an explicit enable,
 * unmet `requires`), any missing required feature option, a duplicate tool id, or a failed
 * rehydration. Every kernel resource opened before the failure is disposed and closed before the
 * error propagates, so a failed composition never leaks a sqlite file handle or a pty manager.
 */
export async function composeJiniKernel(config: ComposeJiniKernelConfig): Promise<JiniKernel> {
  const env = config.env ?? process.env;
  const profile = JINI_PROFILES[config.profile ?? 'agent-core-v1'];
  const catalog: readonly JiniFeature[] = [
    ...createBuiltInFeatures(config.featureOptions ?? {}),
    ...(config.extraFeatures ?? []),
  ];

  // Pure, and first: an invalid selection fails before a single resource is opened.
  const activation = resolveFeatureActivation({
    features: catalog,
    profile,
    ...(config.capabilities === undefined ? {} : { capabilities: config.capabilities }),
    ...(config.features === undefined ? {} : { featureOverrides: config.features }),
  });

  const base = await createJiniKernelBase({
    storage: config.storage,
    ...(config.agentExecutor === undefined ? {} : { agentExecutor: config.agentExecutor }),
  });

  const composed: ComposedFeature[] = [];
  let featureDaemon: Daemon<readonly AnyPack[]> = { services: {} } as Daemon<readonly AnyPack[]>;
  let callerDaemon: Daemon<readonly AnyPack[]> = { services: {} } as Daemon<readonly AnyPack[]>;
  const callerPacks = config.packs ?? [];

  try {
    const kernelBindings = bindings()
      .bind(EventLogToken, base.eventLog)
      .bind(RunLifecycleToken, base.lifecycle)
      .bind(AgentExecutorToken, base.agentExecutor);
    const boundBindings = config.bindings ? config.bindings(kernelBindings) : kernelBindings;

    callerDaemon = (
      createDaemon as (c: { packs: readonly AnyPack[]; bindings: Bindings<string> }) => Daemon<readonly AnyPack[]>
    )({ packs: callerPacks, bindings: boundBindings });

    const featureContext: FeatureBuildContext = { kernel: base, adapter: config.adapter, env };
    const byId = new Map(catalog.map((feature) => [feature.id, feature]));
    for (const record of activation.active) {
      const feature = byId.get(record.id)!;
      const composition = feature.compose(featureContext);
      composed.push({
        feature,
        pack: composition.pack,
        ...(composition.afterTools === undefined ? {} : { afterTools: composition.afterTools }),
      });
    }

    const featurePacks = composed.map((entry) => entry.pack);
    featureDaemon = (
      createDaemon as (c: { packs: readonly AnyPack[]; bindings: Bindings<string> }) => Daemon<readonly AnyPack[]>
    )({ packs: featurePacks, bindings: bindings() as Bindings<string> });

    // Every tool, from every source, before any route mounts.
    registerPackTools(base.registry, featurePacks, featureDaemon);
    // Host-contributed tools after the features' own, so a collision names the host's id rather
    // than silently shadowing a built-in.
    for (const registration of config.toolRegistrations ?? []) base.registry.register(registration);
    registerPackTools(base.registry, callerPacks, callerDaemon);

    // Only now is the registry complete — see `toolCatalog`'s own `afterTools` doc.
    for (const entry of composed) entry.afterTools?.();

    const { app } = config;
    mountPhase('probe', app, composed, featureDaemon);

    const security = config.security ?? { mode: 'host' };

    // `sidecar-strict`'s bearer gate mounts BEFORE the body parser, unlike `jini-local`'s: a caller
    // this gate is going to reject with 401 should never have had its body parsed in the first place.
    // The gate reads only `req.path` and the `Authorization` header, so it needs nothing the parser
    // provides. Its origin guard still mounts below, alongside `jini-local`'s.
    if (security.mode === 'sidecar-strict') {
      app.use(
        requireStrictBearerToken({
          tokenEnvVar: security.tokenEnvVar,
          env,
          ...(security.exemptPaths !== undefined ? { exemptPaths: security.exemptPaths } : {}),
        }),
      );
    }

    if (config.installJsonBodyParser !== false) app.use(express.json());

    if (security.mode === 'sidecar-strict') {
      registerApiOriginGuardMiddleware(app, {
        host: security.host,
        extraAllowedOrigins: configuredAllowedOrigins(env),
        getResolvedPort: () => config.adapter.resolvedPortRef.current,
        env,
      });
    }

    if (security.mode === 'jini-local') {
      registerApiBearerAuthMiddleware(app, {
        tokenConfig: {
          tokenEnvVar: security.apiToken?.tokenEnvVar ?? 'JINI_API_TOKEN',
          disableEnvVar: security.apiToken?.disableEnvVar ?? 'JINI_DISABLE_API_AUTH',
        },
        env,
      });
      registerApiOriginGuardMiddleware(app, {
        host: security.host,
        extraAllowedOrigins: configuredAllowedOrigins(env),
        getResolvedPort: () => config.adapter.resolvedPortRef.current,
        env,
      });
    }

    mountPhase('api', app, composed, featureDaemon);
    config.onAfterApiRoutes?.(app, callerDaemon, base);
    mountPhase('status', app, composed, featureDaemon);
  } catch (error) {
    // Reverse of the order they were built: features composed against an already-constructed caller
    // daemon, so they release first. The caller's packs are disposed here too — `createDaemon` ran
    // their `services()` before the first feature composed, so a failure anywhere after that point
    // leaves whatever those services opened with no owner at all.
    await disposePacks(
      composed.map((entry) => entry.pack),
      featureDaemon,
    );
    await disposePacks(callerPacks, callerDaemon);
    await base.close();
    throw error;
  }

  let disposedFeatures: Promise<void> | null = null;
  const disposeFeatures = (): Promise<void> => {
    disposedFeatures ??= disposePacks(
      composed.map((entry) => entry.pack),
      featureDaemon,
    ).then(() => undefined);
    return disposedFeatures;
  };

  let disposedCallerPacks: Promise<void> | null = null;
  const disposeCallerPacks = (): Promise<void> => {
    disposedCallerPacks ??= disposePacks(callerPacks, callerDaemon).then(() => undefined);
    return disposedCallerPacks;
  };

  return {
    base,
    daemon: callerDaemon,
    activation,
    disposeFeatures,
    disposeCallerPacks,
    closeBase: () => base.close(),
    async close(): Promise<void> {
      await disposeFeatures();
      await disposeCallerPacks();
      await base.close();
    },
  };
}

/** Re-exported so a caller can name the pack type without reaching into `@jini-ai/core`'s internals. */
export type { Pack };
