import type { AdminAnalyticsHit } from "../api/analytics-api.types.js";

/**
 * @file What `useAnalytics` needs from the outside world, as an interface rather than a direct
 * `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) and already applied to `features/redirects` and
 * `features/pages`: this file declares, the host binds the real `api` client (its admin request
 * client and workspace id never enter this package), `analytics-dependencies.hooks.ts` ships the
 * fake, and nothing under `screens/analytics/hooks` imports `lib/api`.
 */
export interface AnalyticsPort {
  listRecentAnalyticsHits(required?: Record<string, never>, optional?: { limit?: number }): Promise<{ hits: AdminAnalyticsHit[] }>;
}
