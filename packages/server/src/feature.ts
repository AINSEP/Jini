/**
 * @module feature
 *
 * The capability/selection vocabulary that sits **over** `@jini-ai/core`'s `Pack`, and the two
 * immutable profiles that name a starting capability grant.
 *
 * Why this is a separate layer rather than fields on `Pack` itself: `Pack` is the universal
 * composition unit every consumer (including third-party packs this package knows nothing about)
 * builds on, and it must stay free of any one host's security vocabulary. `CapabilityId` is
 * `@jini-ai/server`'s answer to "what authority does mounting this grant?", which is a *local-host*
 * question — a different embedder could reasonably classify differently. So the atomicity guarantee
 * lives in the primitive (`Pack.tools` + `Pack.http` are one contribution, see that module's doc)
 * while the activation policy lives here.
 *
 * **Capabilities are an upper bound, not a trigger.** Granting `net:egress` says "this host is
 * *permitted* to run features that reach the network"; it does not silently mount the model proxy,
 * research, connectors and xAI together. What a capability grant does is set the ceiling that a
 * profile's activation policy and a caller's explicit `features` selection must both stay under.
 * The inverse is enforced too: explicitly enabling a feature whose capability is denied is a boot
 * error, never a silent win for either side.
 */
import type { Pack } from '@jini-ai/core';
import type { AdapterContext } from '@jini-ai/http-kit';

import type { JiniKernelBase } from './kernel-base.js';

/** Any pack, regardless of its dep/service types — mirrors `@jini-ai/http-kit`'s own local alias. */
export type AnyPack = Pack<any, any, string>;

/**
 * What mounting a feature grants a caller who can reach it. Deliberately coarse and closed: the
 * value of this vocabulary is that a host can answer "what did I just turn on?" by reading one
 * list, which stops being true the moment the list is long enough to skim.
 */
export type CapabilityId =
  /** Create, observe, cancel and stream runs. The contract every consumer of this kernel needs. */
  | 'run:transport'
  /** Write agent events into a run this process does not own. Strictly more authority than
   * `tool:delegated` (which at least routes through `ToolExecutor`'s policy) — never granted by
   * any shipped profile. */
  | 'run:inject'
  /** Enumerate and re-probe the agent CLIs installed on this machine. */
  | 'agent:discovery'
  /** The agent-facing door onto the shared `ToolRegistry`. */
  | 'tool:delegated'
  /** Durable, searchable descriptor catalog of the registered tool set. */
  | 'tool:catalog'
  /** Read host state: installed editors, active resource context. */
  | 'host:read'
  /** Spawn a process on the host — a pty, or an external application. */
  | 'host:exec'
  /** Inspect, integrity-check, or rewrite a database file in place. */
  | 'db:admin'
  /** Outbound calls to third parties, and the credentials that go with them. */
  | 'net:egress'
  /** Report daemon status and request its shutdown. */
  | 'daemon:control'
  /** Read/write the durable memory note store. */
  | 'memory:store'
  /** Create and run scheduled routines. */
  | 'routines:schedule'
  /** Generate media through a dispatch engine. */
  | 'media:generate'
  /** Bridge to an attached frontend surface's own capabilities. */
  | 'ui:session';

/**
 * The runtime half of {@link CapabilityId}.
 *
 * Declared as a `Record<CapabilityId, true>` rather than a plain array so drift is a compile error
 * in **both** directions: a union member missing here fails the `Record`'s exhaustiveness, and a
 * key here that is not in the union fails the object literal's excess-property check. A validation
 * list that can silently fall behind the type it validates is worse than none, because it reads as
 * closed while quietly admitting whatever was added last.
 */
const CAPABILITY_ID_SET: Readonly<Record<CapabilityId, true>> = Object.freeze({
  'run:transport': true,
  'run:inject': true,
  'agent:discovery': true,
  'tool:delegated': true,
  'tool:catalog': true,
  'host:read': true,
  'host:exec': true,
  'db:admin': true,
  'net:egress': true,
  'daemon:control': true,
  'memory:store': true,
  'routines:schedule': true,
  'media:generate': true,
  'ui:session': true,
});

/** Every capability this vocabulary declares, for error messages and for exhaustive iteration. */
export const CAPABILITY_IDS: readonly CapabilityId[] = Object.freeze(
  Object.keys(CAPABILITY_ID_SET) as CapabilityId[],
);

/** Whether `value` names a capability this vocabulary actually declares. */
export function isCapabilityId(value: string): value is CapabilityId {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_ID_SET, value);
}

/**
 * The capabilities a feature may default to *on* under the `core-only` activation policy — the
 * run-transport contract and nothing else.
 *
 * A feature qualifies only if **every** capability it provides is in here, so a feature that mixes
 * a core capability with a non-core one (say `run:transport` plus `host:exec`) does not sneak in on
 * the strength of its safe half.
 */
export const CORE_CAPABILITIES: readonly CapabilityId[] = Object.freeze([
  'run:transport',
  'agent:discovery',
  'tool:delegated',
]);

/**
 * When a feature's routes mount, relative to the composition's own middleware.
 *
 * - `probe` — before the JSON body parser and before any auth/origin middleware. A liveness or
 *   readiness probe must never need a body parser, a bearer token, or a same-origin `Origin`
 *   header just to confirm the process is up.
 * - `api` — the normal position, behind whatever security the composition installed.
 * - `status` — last, after every product/pack route, so a status surface reports on a fully
 *   assembled app.
 */
export type FeaturePhase = 'probe' | 'api' | 'status';

/** Everything a feature needs to build its pack. Supplied by `composeJiniKernel`. */
export interface FeatureBuildContext {
  /** Kernel-owned infrastructure. Features **borrow** from here; they never own or close it. */
  readonly kernel: JiniKernelBase;
  readonly adapter: AdapterContext;
  readonly env: NodeJS.ProcessEnv;
}

/** What a feature contributes once it has been selected for composition. */
export interface FeatureComposition {
  /** The atomic unit: this feature's services, tools, routes and teardown, together. */
  readonly pack: AnyPack;
  /**
   * Runs after **every** active feature's tools are in the shared registry, and before any routes
   * mount. The one ordering a `Pack` cannot express on its own, needed by any feature that derives
   * something from the complete tool set rather than contributing to it (today: the tool catalog's
   * durable snapshot, which would be silently partial if it ran during its own pack's `tools`).
   */
  readonly afterTools?: () => void;
}

/**
 * A selectable built-in or product feature: capability metadata plus a builder for the one `Pack`
 * that carries its routes, tools and teardown together.
 */
export interface JiniFeature {
  readonly id: string;
  /** The authority mounting this feature grants. `[]` means none — always permitted (e.g. health). */
  readonly provides: readonly CapabilityId[];
  /** Other feature ids that must also be active. Unmet is a boot error naming both ends. */
  readonly requires?: readonly string[];
  /** @default 'api' */
  readonly phase?: FeaturePhase;
  readonly compose: (context: FeatureBuildContext) => FeatureComposition;
}

/** Identity helper that pins a feature's shape at the definition site. */
export function defineJiniFeature(feature: JiniFeature): JiniFeature {
  return feature;
}

/**
 * How a profile decides which *permitted* features are on by default.
 *
 * - `core-only` — only features whose capabilities are all in {@link CORE_CAPABILITIES}. Granting
 *   an extra capability under this policy raises the ceiling; it activates nothing on its own.
 * - `all-permitted` — every feature the grant set permits. The coarse, batteries-included posture
 *   the standalone daemon has always had; denying a capability here turns off everything that
 *   needed it, in one line.
 */
export type ProfileActivation = 'core-only' | 'all-permitted';

export interface JiniProfile {
  readonly id: JiniProfileId;
  readonly grants: readonly CapabilityId[];
  readonly activation: ProfileActivation;
}

export type JiniProfileId = 'agent-core-v1' | 'local-daemon-v1';

/**
 * The shipped profiles. **Versioned and immutable**: a future capability must never silently join
 * an existing profile's grant set, because a consumer pinned to `local-daemon-v1` chose the
 * authority surface it had on the day it pinned. A new set is a new id (`-v2`), not an edit.
 *
 * Both name a *capability grant*, never a hand-listed feature array — so the active feature list is
 * always computed from capability semantics and cannot drift away from them when a feature is
 * added, renamed, or reclassified.
 */
export const JINI_PROFILES: Readonly<Record<JiniProfileId, JiniProfile>> = Object.freeze({
  /**
   * The conservative embedding default: the run-transport contract only. Everything that touches
   * the host, the network, a database file, or daemon control is outside the grant, so it can be
   * neither defaulted on nor explicitly enabled without the host first raising the ceiling.
   */
  'agent-core-v1': Object.freeze({
    id: 'agent-core-v1',
    grants: Object.freeze(['run:transport', 'agent:discovery', 'tool:delegated'] as const) as readonly CapabilityId[],
    activation: 'core-only',
  }),
  /**
   * `createLocalNodeDaemon`'s historical surface, frozen as a compatibility profile: exactly the
   * capabilities the standalone daemon has always mounted. `run:inject`, `memory:store`,
   * `routines:schedule`, `media:generate` and `ui:session` are **absent by design** — those route
   * families were never wired by that preset, and granting them here would silently expand a
   * shipped daemon's surface.
   */
  'local-daemon-v1': Object.freeze({
    id: 'local-daemon-v1',
    grants: Object.freeze([
      'run:transport',
      'agent:discovery',
      'tool:delegated',
      'tool:catalog',
      'host:read',
      'host:exec',
      'db:admin',
      'net:egress',
      'daemon:control',
    ] as const) as readonly CapabilityId[],
    activation: 'all-permitted',
  }),
});
