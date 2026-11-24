/**
 * @file The narrow structural view types the dashboard reads — the port's input shape.
 *
 * Only the fields this screen actually reads. A host's richer post/page and site-key types satisfy
 * these structurally (its post rows carry many more fields; its site-key union is the same five
 * values), so the host passes its own API responses straight through without mapping. These are
 * deliberately NOT a shared wire type: they describe what one screen needs, not what a server sends.
 */

/** One post or page row, as the stat cards and the "Recently updated" list read it. */
export interface DashboardActivityRow {
  id: string;
  kind: string;
  slug: string;
  title: string;
  status: string;
  /** ISO timestamp; the activity list sorts on it lexicographically, newest first. */
  updatedAt: string;
}

/** The site-key status the warning banner reads. `"missing"` and `"active"` are the quiet states. */
export type DashboardSiteKeyState = "active" | "missing" | "missing-with-data" | "mismatch" | "invalid";
