/**
 * @file `@jini-ai/admin/core` — the universal half. No React, no DOM.
 *
 * This is the layer a panel author codes against. Anything that touches `window` lives in
 * `@jini-ai/admin/browser`; anything that imports React lives in `@jini-ai/admin/react`. The
 * boundary is enforced by this package's vitest config, which deliberately runs `src/core/**`
 * without a DOM environment so a leak fails loudly rather than passing quietly.
 */

// Manifest — what a panel is, and what mounts.
export type { AdminNavEntry, AdminPanel, AdminRoutePattern } from './manifest/types.js';
export {
  buildAgentPageMap,
  buildNav,
  panelHref,
  resolveAgentPageId,
  resolvePanels,
} from './manifest/rules.js';
export type { AdminNavGroup, AdminNavItem, AdminRegistryContext } from './manifest/rules.js';

// Routing — pure, registry-driven.
export type { AdminRoute } from './routing/types.js';
export {
  DEFAULT_ADMIN_BASE,
  adminHref,
  currentRoutePath,
  matchRoute,
  stripTrailingSlash,
} from './routing/rules.js';

// Permissions — affordance only, never an authorization boundary.
export { hasPermission } from './permissions/rules.js';

// Transport — the seam every route group is built on.
export {
  AdminApiError,
  createAdminClient,
  createHttpTransport,
  describeApiError,
} from './transport/index.js';
export type {
  AdminClient,
  AdminRouteGroupFactory,
  AdminTransport,
  AdminFetch,
  HttpTransportOptions,
} from './transport/index.js';

// Gated destructive operations.
export type { GatedConfirmResult, GatedOperation, GatedPlanResult } from './gated/types.js';

// Ports. See `./ports/README.md` for the one port deliberately absent (`execution`).
export type {
  AdminAnalyticsHit,
  AdminAnalyticsPort,
  AdminAuthPort,
  AdminAuthUser,
  AdminComment,
  AdminCommentsPort,
  AdminCommentsQueuePage,
  AdminDatabasePort,
  AdminDegradedBanner,
  AdminDisclosureResult,
  AdminExtensionEnabledResult,
  AdminExtensionsPort,
  AdminIdentityPort,
  AdminIdentityUser,
  AdminIntegrationDelivery,
  AdminIntegrationDeliverySummary,
  AdminIntegrationSubscription,
  AdminIntegrationsPort,
  AdminLedgerRow,
  AdminMedia,
  AdminMediaPort,
  AdminMember,
  AdminMembersPort,
  AdminPlugin,
  AdminPolicy,
  AdminRecoveryDeepLinkResult,
  AdminRecoveryPort,
  AdminRecoveryStatus,
  AdminRestorePoint,
  AdminRestorePointSummary,
  AdminRole,
  AdminSettingsPort,
  AdminWorkspace,
  AdminWorkspacePort,
  CategoryCount,
  CommentModerationAction,
  CommentsSettings,
  CommentStatus,
  DatabaseContextEnvelope,
  DegradedBannerActionKind,
  DegradedBannerKind,
  MigrateForwardResult,
  RestoreConfirmInput,
  RestoreExecuteInput,
  RestoreExecuteResult,
  RestorePointCostClass,
  SettingResolvedValue,
  SettingResetResponse,
  SettingScope,
  SettingValueResponse,
} from './ports/index.js';
