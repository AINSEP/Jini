import { useState, type FormEvent } from "react";
import type { QueryKey } from "@jini-ai/core/fetch";
import type { AdminLedgerRow } from "../../../core/index.js";
import { KEYS } from "../rules.js";
import { t } from "../database-i18n.js";
import type { TimelineSectionPort } from "./timeline-section-port.hooks.js";

/**
 * @file Everything `TimelineSection` (the Database screen's ledger browser) does, so
 * `Database.tsx` is only markup.
 *
 * Extracted verbatim — same state, same declaration order, same effect, same error strings.
 * `Database.tsx` has no unit test today (see the feature's `README.md`); a hook is reachable from
 * `renderHook` with no `DataTable` and no cursor-driven pagination UI to drive by hand.
 *
 * `navigateToRecoveryWithDeepLink` moved here rather than to `rules.ts`: it performs I/O
 * (`sessionStorage.setItem`, `navigate`) rather than computing a value, so it is an effect, not a
 * pure rule, even though it needs no component state and is exported as a plain function rather
 * than folded into the hook's return.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import): this hook already resolved the
 * locale (`host.useLocale()`) for its own error-string translations, so exposing that SAME already-resolved
 * `locale` as a bound `t` (plus the raw value, still needed for `TimelineSection`'s own local
 * subcomponents) on the return value adds no new fetch — `TimelineSection` used to receive `locale`
 * as a separate prop from `Database`, entirely redundant with the resolution this hook was already
 * doing internally and not using for anything the component could see.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): page 1 is one `useFetchQuery` keyed on `KEYS.
 * timeline(appliedFilters)` — `appliedFilters` (NOT `kind`/`outcome`/`fromDate`/`toDate`
 * themselves) is the key, so typing into a filter input does not itself trigger a reload; only
 * `applyFilters` committing the draft into `appliedFilters` does, by changing the query's key (see
 * `rules.ts`'s `KEYS` doc). This also removes the mount-time `useEffect` entirely — `useFetchQuery`
 * fetches on mount by construction, and `appliedFilters` already starts blank. "Load more" pages
 * are NOT folded into that query, for the identical reason `../../../forms/react/hooks/use-form-
 * submissions.hooks.ts`/`@jini-ai/admin/comments/react`'s queue hook keep their own cursor-appended
 * pages local: `@jini-ai/ui/fetch-query`'s `QueryKey` doc binds one hook to one FIXED key.
 * `filtersRef` guards that local accumulation against the same class of race the base query gets
 * for free: a `loadMore` in flight when `applyFilters` commits new filters must not append the
 * wrong filter's rows once it resolves.
 *
 * DI seam (2026-08-14, Orc-BASH pass): `port` is injected — see `timeline-section-port.hooks.ts` —
 * rather than reaching the host's HTTP client directly, so a test can describe timeline-load/load-more outcomes
 * against `createFakeTimelineSectionPort` instead of stubbing global `fetch`. the host's
 * `useWiredTimelineSection` binding is the zero-argument pair the screen actually mounts; `fetchTimelinePage` is now a
 * closure over `port` local to the hook body rather than a module-scope function, matching
 * `use-comment-queue.hooks.ts`'s inline-closure convention — `port` is never placed in a dependency
 * array (this file has no `useCallback` and neither `useEffect` below depends on it), so a fresh
 * fake-port object per render can never retrigger either effect.
 *
 * The first-page query, the cursor-appended pages and the stale-append guard described above now live in
 * `useCursorPages` (`@jini-ai/ui/fetch-query`), which the host injects as `host.useCursorPages`; this hook binds
 * the port, `KEYS.timeline` and the error wording.
 *
 * Host seam: the locale hook, the API-error describer and the cursor-pages hook (`TimelineSectionHost`) arrive on `host`, so this file reaches neither the host's HTTP client
 * nor the admin shell. Pass a module-level `host` object: its hook fields are called on every render
 * and must keep their identity.
 */

/** The router call {@link navigateToRecoveryWithDeepLink} needs (normally the admin router's `navigate`). */
export type RecoveryDeepLinkNavigate = (required: { routePath: string }) => void;

/** Stashes a client-constructed `DatabaseContextEnvelope` for `Recovery.tsx` to re-resolve
 * server-side on arrival (ADR-041 §7/ADR-045 §5, INV-04) — this admin app's router has no
 * per-navigation state mechanism, so `sessionStorage` carries the envelope across the navigation the
 * same way route state would in a router that supported it. A query string would technically work
 * now that routing is path-based, but this is transient handoff state: putting it in the URL would
 * make it bookmarkable and shareable, which is exactly what it must not be. The envelope itself
 * carries display continuity only; `resolveDeepLinkContext` never trusts it as authoritative. */
export function navigateToRecoveryWithDeepLink(
  { row, navigate }: { row: AdminLedgerRow; navigate: RecoveryDeepLinkNavigate },
  _optional: Record<string, never> = {},
): void {
  if (!row.restorePointId) return;
  const envelope = {
    v: 1,
    correlationId: `database-timeline-${row.id}`,
    siteId: "workspace-local",
    ledgerEventId: row.id,
    restorePointId: row.restorePointId,
    drift: row.kind,
    intent: "view",
    issuedAt: new Date().toISOString(),
  };
  sessionStorage.setItem("recovery-deep-link-envelope", JSON.stringify(envelope));
  navigate({ routePath: "/recovery" });
}

export interface TimelineSectionController {
  rows: AdminLedgerRow[] | null;
  nextCursor: string | null;
  error: string | null;
  kind: string;
  setKind: (kind: string) => void;
  outcome: string;
  setOutcome: (outcome: string) => void;
  fromDate: string;
  setFromDate: (fromDate: string) => void;
  toDate: string;
  setToDate: (toDate: string) => void;
  loadingMore: boolean;
  applyFilters: (e: FormEvent) => void;
  loadMore: () => void;
  /** Bound translator — `key` already resolved against the caller's locale, so `Database.tsx`
   *  never imports `useAdminLocale`/`database-i18n` for this section. See this file's header. */
  t: (key: string) => string;
  /** Raw resolved locale — `TimelineSection`'s own local subcomponents (`TimelineFilterForm`,
   *  `TimelineBody`, `timelineColumns`) take `locale` directly rather than a bound translator. See
   *  this file's header. */
  locale: string;
}

export interface TimelineFilters {
  kind: string;
  outcome: string;
  fromDate: string;
  toDate: string;
}

/** What the injected cursor-pages hook takes — `@jini-ai/ui/fetch-query`'s `CursorPagesRequired`
 *  shape, restated for this list so the package does not depend on the UI library. */
export interface TimelineCursorPagesRequired {
  key: (required: { filters: TimelineFilters }) => QueryKey;
  fetchPage: (
    required: { filters: TimelineFilters },
    optional?: { cursor?: string | undefined },
  ) => Promise<{ items: AdminLedgerRow[]; nextCursor: string | null }>;
  initialFilters: TimelineFilters;
}

/** The part of the injected hook's result this list reads (restated, see above). */
export interface TimelineCursorPages {
  rows: AdminLedgerRow[] | null;
  nextCursor: string | null;
  failure: { error: unknown } | null;
  applyFilters: (filters: TimelineFilters) => void;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
}

const BLANK_FILTERS: TimelineFilters = { kind: "", outcome: "", fromDate: "", toDate: "" };

/** What the host supplies so this hook stays free of its locale query, HTTP client and query binding. */
export interface TimelineSectionHost {
  /** The admin's resolved UI locale (a React hook). */
  useLocale: () => string;
  /** Turns a thrown API error into the operator-facing message, `fallback` when it has none. */
  describeError: (required: { e: unknown; fallback: string }) => string;
  /** The cursor-paged list binding (`useCursorPages` from the host's fetch-query layer, a React hook). */
  useCursorPages: (required: TimelineCursorPagesRequired) => TimelineCursorPages;
}

export interface TimelineSectionDependencies {
  port: TimelineSectionPort;
  host: TimelineSectionHost;
}

/**
 * @param deps Injected dependencies — the `TimelineSectionPort` to read the ledger through.
 * @returns The Timeline's filter/paging state plus `applyFilters`/`loadMore`, and a bound `t`/
 * `locale` — see this file's header for the full rationale.
 */
export function useTimelineSection(deps: TimelineSectionDependencies, _optional: Record<string, never> = {}): TimelineSectionController {
  const { port, host } = deps;
  const locale = host.useLocale();
  const boundT = (key: string): string => t({ locale: locale, key: key });

  function fetchTimelinePage({ filters }: { filters: TimelineFilters }, { cursor }: { cursor?: string | undefined } = {}) {
    return port.getDatabaseTimeline({}, {
      options: {
        kind: filters.kind || undefined,
        outcome: filters.outcome || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
        cursor,
      },
    });
  }

  const [kind, setKind] = useState("");
  const [outcome, setOutcome] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // The COMMITTED filters the first page is keyed on live in `useCursorPages`, deliberately separate
  // from the draft `kind`/`outcome`/`fromDate`/`toDate` above (bound to the filter form's own inputs)
  // so typing does not itself trigger a reload. See this file's own header.
  const pages = host.useCursorPages({
    key: ({ filters }) => KEYS.timeline(filters),
    fetchPage: fetchTimelinePage,
    initialFilters: BLANK_FILTERS,
  });

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    pages.applyFilters({ kind, outcome, fromDate, toDate });
  }

  const rows = pages.rows;
  const error = pages.failure === null ? null : host.describeError({ e: pages.failure.error, fallback: t({ locale: locale, key: "failed to load the Database Timeline" }) });

  return {
    rows,
    nextCursor: pages.nextCursor,
    error,
    kind,
    setKind,
    outcome,
    setOutcome,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    loadingMore: pages.loadingMore,
    applyFilters,
    loadMore: pages.loadMore,
    t: boundT,
    locale,
  };
}
