import type { DashboardActivityRow, DashboardSiteKeyState } from "../dashboard-view.types.js";
import type { DashboardPort } from "./dashboard-port.hooks.js";

/**
 * @file The in-memory {@link DashboardPort} — "every port gets a fake". Lives beside the port, not in
 * a host, so both this screen's own tests and a host's tests can describe each read independently
 * without stubbing global `fetch`. The live port is the host's: it binds its real API clients.
 */

/** Seed state for {@link createFakeDashboardPort}. Every field is independent — a test can seed
 *  just the one stat it cares about and let the rest default to "empty, no error", mirroring how
 *  `useDashboard` treats its five reads as unrelated sources (see that hook's own file header). */
export interface FakeDashboardPortOptions {
  posts?: DashboardActivityRow[];
  pages?: DashboardActivityRow[];
  /** Only `status` is read (`useDashboard` counts `status === "active"` rows) — narrowed the same
   *  way the port itself narrows `listMedia`. */
  media?: Array<{ status: string }>;
  /** Only the pending-queue LENGTH is read — seeded as a count rather than real `AdminComment`
   *  rows, matching the port's own `items: unknown[]` narrowing. */
  pendingCommentsCount?: number;
  activeThemeId?: string;
  /** The active theme's display name; omitted, the fake's summary carries no name. */
  activeThemeName?: string;
  /** Defaults to `false` — a test seeds `true` to exercise the default-password banner. */
  usesDefaultPassword?: boolean;
  /** The caller's own id the fake reports. Defaults to `"fake-user-1"`. */
  principalId?: string;
  /** Site-key plan §A.6. Defaults to `"active"` (the normal, no-banner case) — a test seeds
   *  `"missing-with-data"`/`"mismatch"`/`"invalid"` to exercise the site-key warning banner. */
  siteKeyState?: DashboardSiteKeyState;
  listPostsError?: Error;
  listPagesError?: Error;
  listMediaError?: Error;
  listCommentsQueueError?: Error;
  getPresentationError?: Error;
  getPasswordStatusError?: Error;
  getSiteKeyStateError?: Error;
}

/**
 * An in-memory {@link DashboardPort} for tests — "every port gets a fake". Each of the five methods resolves or rejects independently, so a
 * test can describe "posts loaded but comments failed" directly instead of hand-building five
 * `Response` objects and stubbing global `fetch`.
 */
export function createFakeDashboardPort(options: FakeDashboardPortOptions = {}): DashboardPort {
  return {
    async listPosts() {
      if (options.listPostsError) throw options.listPostsError;
      return { posts: (options.posts ?? []).map((post) => ({ post })) };
    },
    async listPages() {
      if (options.listPagesError) throw options.listPagesError;
      return { posts: (options.pages ?? []).map((post) => ({ post })) };
    },
    async listMedia() {
      if (options.listMediaError) throw options.listMediaError;
      return { media: options.media ?? [] };
    },
    async listCommentsQueue() {
      if (options.listCommentsQueueError) throw options.listCommentsQueueError;
      return { items: Array.from({ length: options.pendingCommentsCount ?? 0 }) };
    },
    async getPresentation() {
      if (options.getPresentationError) throw options.getPresentationError;
      const activeThemeId = options.activeThemeId ?? "fake-theme";
      const availableThemes = options.activeThemeName ? [{ id: activeThemeId, name: options.activeThemeName }] : [];
      return { settings: { activeThemeId }, availableThemes };
    },
    async getPasswordStatus() {
      if (options.getPasswordStatusError) throw options.getPasswordStatusError;
      return { usesDefaultPassword: options.usesDefaultPassword ?? false, principalId: options.principalId ?? "fake-user-1" };
    },
    async getSiteKeyState() {
      if (options.getSiteKeyStateError) throw options.getSiteKeyStateError;
      return { state: options.siteKeyState ?? "active" };
    },
  };
}
