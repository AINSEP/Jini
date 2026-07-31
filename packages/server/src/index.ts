/**
 * @module @jini-ai/server
 *
 * The Node.js host preset (extraction-plan.md §2.4): `createLocalNodeDaemon`, the piece that
 * assembles `@jini-ai/core`/`@jini-ai/daemon`/`@jini-ai/sqlite`/`@jini-ai/http-kit` into an actually-runnable
 * daemon process, plus the generic host-lifecycle primitives it's built on. See `source-map.md`
 * for full provenance and scope-decision notes.
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
export { composeJiniKernel } from './compose-jini-kernel.js';

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

// Re-exported, not owned: `createFrontendControl` moved to `@jini-ai/http-kit` on 2026-07-31 (see
// that module's doc — it never needed anything this package adds, and living here kept it out of
// reach of hosts that build their own Express app). Kept here so existing imports do not break.
export { createFrontendControl } from '@jini-ai/http-kit';
export type {
  CreateFrontendControlOptions,
  FrontendBindErrorContext,
  FrontendControl,
  FrontendHttpExtension,
} from '@jini-ai/http-kit';

export type { CloseHttpServerOptions } from './host-bootstrap.js';
export { DEFAULT_DAEMON_BIND_HOST, closeHttpServer, normalizeDaemonBindHost } from './host-bootstrap.js';
