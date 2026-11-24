import type { AdminAnalyticsHit } from "../api/analytics-api.types.js";
import type { AnalyticsPort } from "./analytics-port.hooks.js";

/**
 * @file The fake half of `analytics-port.hooks.ts` — see that file for why the split exists.
 *
 * The live implementation (a module-level singleton over the host's admin request client and
 * workspace id) is the host's: it builds that port and hands it to the screen through the
 * controller hook it injects, so this package never reaches an HTTP client of its own.
 */

/** Seed state for {@link createFakeAnalyticsPort}. */
export interface FakeAnalyticsPortOptions {
  hits?: AdminAnalyticsHit[];
}

/**
 * An in-memory {@link AnalyticsPort} for tests — the fake that lets a test describe "these hits
 * are recorded" directly, instead of hand-building fetch `Response`s. Shipped alongside the real
 * binding per the pattern's "every port gets a fake" rule (see `assistant-chats-dependencies
 * .hooks.ts`).
 */
export function createFakeAnalyticsPort(options: FakeAnalyticsPortOptions = {}): AnalyticsPort {
  const hits = options.hits ?? [];

  return {
    async listRecentAnalyticsHits() {
      return { hits };
    },
  };
}
