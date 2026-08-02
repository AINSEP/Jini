/**
 * @file Barrel for every `@jini-ai/admin/core` port. See `README.md` in this directory for the one
 * port that is deliberately absent (`execution`) and why.
 */

export type { AdminAuthPort, AdminAuthUser } from './auth.js';
export type { AdminMember, AdminMembersPort } from './members.js';
export type { AdminMedia, AdminMediaPort } from './media.js';
export type {
  AdminSettingsPort,
  SettingResolvedValue,
  SettingResetResponse,
  SettingScope,
  SettingValueResponse,
} from './settings.js';
export type {
  AdminDatabasePort,
  AdminLedgerRow,
  AdminRestorePoint,
  AdminRestorePointSummary,
  MigrateForwardResult,
  RestorePointCostClass,
} from './database.js';
export type {
  AdminDegradedBanner,
  AdminDisclosureResult,
  AdminRecoveryDeepLinkResult,
  AdminRecoveryPort,
  AdminRecoveryStatus,
  CategoryCount,
  DatabaseContextEnvelope,
  DegradedBannerActionKind,
  DegradedBannerKind,
  RestoreConfirmInput,
  RestoreExecuteInput,
  RestoreExecuteResult,
} from './recovery.js';
export type {
  AdminIntegrationDelivery,
  AdminIntegrationDeliverySummary,
  AdminIntegrationSubscription,
  AdminIntegrationsPort,
} from './integrations.js';
export type {
  AdminComment,
  AdminCommentsPort,
  AdminCommentsQueuePage,
  CommentModerationAction,
  CommentsSettings,
  CommentStatus,
} from './comments.js';
export type { AdminExtensionEnabledResult, AdminExtensionsPort, AdminPlugin } from './plugins.js';
export type { AdminAnalyticsHit, AdminAnalyticsPort } from './analytics.js';
export type { AdminWorkspace, AdminWorkspacePort } from './workspace.js';

export type {
  AdminIdentityPort,
  AdminIdentityUser,
  AdminPolicy,
  AdminRole,
} from './identity.js';
