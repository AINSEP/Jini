/**
 * @module @jini-ai/server
 *
 * Node host preset: createLocalNodeDaemon assembles core, daemon, concern-owned
 * storage and http-kit into a listening service. composeJiniKernel is the same
 * composition core for hosts mounting their own app without a second listener.
 *
 * Composition and lifecycle invariants:
 * - The preset's two overloads preserve the missing-binding type gate: defaulted
 *   BoundIds would defeat inference from a custom bindings callback. Core's
 *   internal token-gate types are reused, rather than reimplemented. The cast
 *   inside the generic body is protected by both exported overloads' gate.
 * - resolveBoundPort and resolveReportHost are pure helpers so defensive address
 *   checks are directly testable without a listener. Wildcard hosts are reported
 *   as loopback and IPv6 authorities are bracketed so discovery URLs are usable.
 * - Resource acquisition stays inside cleanup boundaries so a later database
 *   open cannot leak an earlier handle. Features dispose before caller packs,
 *   reversing construction; the preset constructed those services and owns
 *   teardown. Listener-close or onShutdown failures cannot skip storage close,
 *   feature disposal or discovery removal. Explicit stop callers observe failures;
 *   requested shutdown failures are reported rather than dropped as rejections.
 * - Feature and capability keys are runtime-validated: silently accepting a typo
 *   in a disabled capability would leave the real security-sensitive grant active.
 * - Bind-host configuration is set before serving requests. The injected env is
 *   shared with origin middleware and route guards so both enforce the same policy.
 * - Agent scan cache cleanup checks promise identity so an older failed scan
 *   cannot clear its replacement. Frontend binding contains resolver and error-sink
 *   failures so a host binding error cannot fail the underlying run.
 *
 * Frontend control belongs to daemon/http; this entry retains its public forwarding
 * exports. See owning modules and packages/server/README.md for detailed contracts.
 */
export type {
  CreateLocalNodeDaemonConfig,
  KernelBoundIds,
  LocalNodeDaemon,
  LocalNodeHttpExtension,
  LocalNodeHttpExtensionContext,
} from './create-local-node-daemon.js';
export {
  buildDaemonDbOperations,
  classifyRunFailureForRetry,
  createLocalNodeDaemon,
  projectDetectedAgent,
  resolveBoundPort,
  resolveReportHost,
} from './create-local-node-daemon.js';

// The composition core `createLocalNodeDaemon` is itself a caller of. An embedded host mounts onto
// its own Express app with this and never opens a second listener.
export type { ComposeJiniKernelConfig, JiniKernel, JiniKernelSecurity } from './compose-jini-kernel.js';
export { composeJiniKernel, defaultServerMessages } from './compose-jini-kernel.js';

export type {
  AnyPack,
  CapabilityId,
  FeatureBuildContext,
  FeatureComposition,
  FeaturePhase,
  JiniFeature,
  JiniProfile,
  JiniProfileId,
  ProfileActivation,
} from './feature.js';
export { CAPABILITY_IDS, CORE_CAPABILITIES, defineJiniFeature, isCapabilityId, JINI_PROFILES } from './feature.js';

export type {
  ActivationReason,
  ActiveFeatureRecord,
  DeactivationReason,
  FeatureActivationInput,
  FeatureActivationPlan,
  InactiveFeatureRecord,
} from './feature-activation.js';
export { resolveFeatureActivation } from './feature-activation.js';

export type { BuiltInFeatureOptions } from './builtin-features.js';
export {
  ANONYMOUS_DELEGATED_PRINCIPAL,
  createBuiltInFeatures,
  LOCAL_DAEMON_PRINCIPAL,
} from './builtin-features.js';

export type {
  CreateJiniKernelBaseOptions,
  JiniKernelBase,
  JiniKernelStorage,
  KernelSqliteAccess,
} from './kernel-base.js';
export { createJiniKernelBase } from './kernel-base.js';

// Frontend control belongs to the daemon HTTP surface: hosts that build their own Express app
// can compose it without the server kernel. This server entry keeps its existing public export.
export { createFrontendControl } from '@jini-ai/daemon/http';
export type { CreateFrontendControlOptions, FrontendBindErrorContext, FrontendControl, FrontendHttpExtension } from '@jini-ai/daemon/http';

export type { CloseHttpServerOptions, GracefulShutdownHandle, GracefulShutdownOptions } from './host-bootstrap.js';
export {
  DEFAULT_DAEMON_BIND_HOST,
  closeHttpServer,
  installGracefulShutdown,
  normalizeDaemonBindHost,
} from './host-bootstrap.js';
