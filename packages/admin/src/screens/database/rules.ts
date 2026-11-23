import type { AdminLedgerRow, AdminSchemaState } from "../../core/index.js";
import type { QueryKey } from "@jini-ai/core/fetch";

import { t } from "./database-i18n.js";

import { formatTimestamp } from '@jini-ai/core/text';
/**
 * @file Pure logic for the `database` feature — everything that computes a value rather than
 * rendering one. New file: this feature had no `rules.ts` before this migration, since none of its
 * three sections had computed logic worth extracting until `KEYS` needed a shared home.
 *
 * `KEYS` (fetch-query migration, 2026-08-12): `restorePoints` and `timeline` are two independent
 * resources — the old restore-point create action never reloaded the timeline in
 * the pre-migration code either (each section owns its own load, no cross-invalidation), so they
 * get two entirely separate top-level namespaces rather than a shared grandparent, same shape
 * `@jini-ai/admin/forms` rules.ts's `KEYS` uses for `forms` vs `form-submissions`.
 *
 * `timeline(filters)` keys on the four filter fields together, not on a separate "applied" flag —
 * `use-timeline-section.hooks.ts` keeps a `kind`/`outcome`/`fromDate`/`toDate` DRAFT (bound to the
 * filter form's own inputs) separate from the `appliedFilters` state this key is built from, so
 * typing into a filter field does not itself trigger a reload — only `applyFilters` committing the
 * draft into `appliedFilters` does, matching the pre-migration `applyFilters`'s explicit
 * `load(true)` call. `use-migrate-forward-section.hooks.ts`'s plan/confirm/execute ceremony has no
 * read of its own to cache (no `KEYS` entry needed for the ceremony's own state), but its `execute`
 * step IS a write that changes two reads OTHER sections own — the drift banner's `schemaState` and
 * the Timeline's ledger — so it invalidates `KEYS.schemaState` and `KEYS.timelineAll` on success (see
 * that hook's own doc comment, and the 2026-09-20 platform-review fix for the bug this closes: the
 * banner and Timeline used to go stale after a migration with nothing to re-read them).
 */
const TIMELINE_ROOT: QueryKey = ["database", "timeline"];

export const KEYS = {
  schemaState: ["database", "schema-state"] as QueryKey,
  restorePoints: ["database", "restore-points"] as QueryKey,
  /** Prefix of every `timeline(filters)` key below — Jini invalidation matches by prefix
   *  (`@jini-ai/ui/fetch-query`'s `QueryKey` doc), so invalidating this one key refreshes whichever
   *  filter set the Timeline currently has cached. Must stay a prefix of `timeline(filters)`'s
   *  return value if that shape ever changes. */
  timelineAll: TIMELINE_ROOT,
  timeline: (filters: { kind: string; outcome: string; fromDate: string; toDate: string }): QueryKey => [
    ...TIMELINE_ROOT,
    filters.kind,
    filters.outcome,
    filters.fromDate,
    filters.toDate,
  ],
};

/** The restore-points list's name on the host's content-refresh bus — see the taxonomy screen's
 *  `TAXONOMY_RESOURCE` for why this is a plain colocated constant rather than a shared registry.
 *  Agent-writable via `backup_create_restore_point` (the host's database agent tools),
 *  which mints a new row this section lists. `database_execute_migrate_forward`
 *  (the domain's only other durable write) is never agent-callable at all — see that catalog's own
 *  header — so it needs no resource constant here. No sibling constant for `schemaState`/`timeline`:
 *  neither has an agent-writable source (schema state only changes via a real migration run, which
 *  no agent tool can execute; the timeline is a pure read of the same ledger a restore-point create
 *  also writes to, but re-querying it on every unrelated assistant run for a filtered, paginated
 *  view a human is actively scrolling is a worse trade than leaving it on its existing reload). */

/** How loudly the Database screen's drift warning presents itself. Maps onto the two `.notice`
 *  variants `styles.css` already ships (`.notice.error` / `.notice.warning`) — no new CSS. */
export type SchemaStateWarningTone = "error" | "warning";

/**
 * One drift warning, as untranslated English copy. `title`/`body` are the raw dictionary KEYS
 * (`database-i18n.tsx`'s convention) — the component passes each through `t()`, so this stays a
 * pure function with no locale in it.
 */
export interface SchemaStateWarning {
  tone: SchemaStateWarningTone;
  title: string;
  body: string;
}

/** The "we asked, and we still do not know" outcome. Shared by every non-answer below so the three
 *  distinct ways of not knowing (request failed, comparison incomplete, status unrecognised) can
 *  differ in `body` while presenting identically. */
const COULD_NOT_CHECK_TITLE = "We could not check your database";

/**
 * Decides whether the Database screen shows a drift warning, and which one.
 *
 * WHY A DEFAULT-TO-LOUD SHAPE: this function is the human-facing end of `src/platform/db/drift.ts`'s
 * classification, which until now had no UI at all. Its governing rule is therefore negative — the
 * ONLY inputs that return `null` are a confirmed `"in-sync"` read and the pre-first-read state
 * (`state: null` with no error), where nothing has been claimed yet. Everything else returns a
 * visible banner, including inputs that represent ignorance rather than trouble. An absent banner
 * on this screen reads as "your database is fine", so anything less than a confirmed-clean answer
 * must not produce one. That is the same discipline `adapter.sqlite.ts` states server-side ("never
 * fabricated") carried through to the pixel.
 *
 * PRECEDENCE: `error` is checked before `state`, so a stale successful read cannot mask a check
 * that has just failed — a previous "in-sync" is not evidence about now.
 *
 * The `default` branch is deliberately reachable: `status` arrives as JSON off the wire, so its
 * TypeScript union is a claim about the server, not a runtime guarantee. A future status this
 * build has never heard of resolves to "could not check" rather than falling through to silence.
 *
 * @complexity O(1).
 */
export function resolveSchemaStateWarning(
  required: { state: AdminSchemaState | null; error: string | null },
  _optional: Record<string, never> = {},
): SchemaStateWarning | null {
  const { state, error } = required;

  if (error) {
    return {
      tone: "warning",
      title: COULD_NOT_CHECK_TITLE,
      body: "This check did not finish, so we cannot tell whether your database is up to date. Try reloading the page.",
    };
  }
  if (!state) return null;

  switch (state.status) {
    case "in-sync":
      return null;
    case "diverged":
      return {
        tone: "error",
        title: "Your database does not match the software running this site",
        body: "This site's data was set up by a different version of the software than the one running now. Saving changes may not work correctly. Check with whoever manages this site before making further changes.",
      };
    case "ahead":
      return {
        tone: "warning",
        title: "Your database is newer than the software running this site",
        body: "This site's data was set up by a newer version of the software than the one running now. Some features may not work until this site is updated.",
      };
    case "behind":
      return {
        tone: "warning",
        title: "Your database is out of date",
        body: "The software running this site is newer than the setup of this site's data. Use Migrate forward below to bring it up to date.",
      };
    case "unknown":
      return {
        tone: "warning",
        title: COULD_NOT_CHECK_TITLE,
        body: "One of the two records we compare is missing, so we cannot tell whether your database is up to date. That is not itself a sign of a problem — but nothing has been confirmed either.",
      };
    default:
      return {
        tone: "warning",
        title: COULD_NOT_CHECK_TITLE,
        body: "This site reported a status this version of the admin does not recognise, so we cannot tell whether your database is up to date.",
      };
  }
}

/**
 * Distinct accessible name for one Timeline row's "View in Recovery →" button.
 *
 * Every row with a `restorePointId` renders the identical visible text (`t(locale, "View in
 * Recovery →")`) — fine for a sighted operator reading the row it sits in, but every one of these
 * buttons is on screen SIMULTANEOUSLY (unlike a per-row menu item, which only ever has one open
 * instance at a time), so `getByRole("button", { name: "View in Recovery →" })` — or any
 * accessibility-tree-driven agent resolving by role+name rather than table position — cannot tell
 * one ledger row's link from another's. Same defect class as `recovery/rules.ts`'s
 * `restoreButtonAccessibleName`, on this screen's own analogous always-visible per-row link.
 *
 * Appends the row's own kind and timestamp — both already visible in that row's other columns —
 * AFTER the visible label rather than replacing it, so the accessible name still starts with the
 * exact visible text (WCAG 2.5.3 Label in Name).
 *
 * @complexity O(1).
 */
export function viewInRecoveryAccessibleName(
  { locale, row, viewerTimeZone }: { locale: string; row: Pick<AdminLedgerRow, "kind" | "createdAt">; viewerTimeZone: string },
  _options = {},
): string {
  return `${t({ locale: locale, key: "View in Recovery →" })} — ${row.kind}, ${formatTimestamp({ iso: row.createdAt }, { viewerTimeZone })}`;
}
