import { useCallback, useEffect, useRef, useState } from "react";

import type { ExportRunSnapshot as AdminExportRunSnapshot } from "@jini-ai/core/contracts/site/export-run";
import type { useFetchQuery } from "@jini-ai/ui/fetch-query";
import type { useContentRefreshSubscription } from "@jini-ai/admin/shell/hooks/use-content-refresh-subscription.hooks";
import { DEPLOYMENT_EXPORT_RESOURCE } from "@jini-ai/devops/deploy/react/rules";

import type { StaticExportPort } from "@jini-ai/core/contracts/site/deployment-admin";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Everything the Static Site tab's "Build static export" action does, so `StaticSiteTab.tsx`
 * is only markup. Wired 2026-08-15 against `POST`/`GET .../system/export`
 * (`apps/website/src/server/inbound/admin-http/routes/system/export-site.ts`) — see that route's header for the trigger+poll
 * shape this hook mirrors: a real export is seconds to minutes, so a click starts the run and this
 * hook polls the status route until it settles, rather than holding one request open.
 *
 * `run` is seeded from a `getSiteExportStatus()` read on mount (via `useFetchQuery`, once — see
 * `seededRef` below) so a reload mid-export, or a second browser tab, still shows the real state
 * instead of a blank "not started". After that first paint, `run` is owned entirely by
 * {@link trigger} and the poll loop, never by a background refetch of the query — same "no
 * `invalidates`, set state from the write's own response" reasoning `use-dockerfile-source.hooks.ts`'s
 * header documents, extended here to the poll (which is this hook's OWN repeated read, not the
 * query's).
 *
 * `clean` defaults to `false` and is never silently flipped by this hook — `exportSite` itself
 * refuses to overwrite a non-empty output directory, and surfacing that refusal honestly (rather
 * than working around it here) is the point: see `StaticSiteTab.tsx`'s own reason text for the
 * checkbox.
 *
 * ## `useContentRefreshSubscription` — a bespoke reload, not the usual one-liner
 *
 * Staleness-bug generalization pass (see that hook's own header): an assistant run that called
 * `deployment_trigger_export` (`apps/website/src/features/deployments/agent-tools.ts`) from a
 * DIFFERENT tab/session should not leave this tab showing "Not started" indefinitely. This can't be
 * the usual `useInvalidate()` one-liner (`use-media.hooks.ts`'s shape) because `run` is not read
 * from `query.data` after the FIRST load — `seededRef` above deliberately blocks a later background
 * refetch of the SAME `useFetchQuery` from re-seeding it, so invalidating that query would silently
 * do nothing. Instead, {@link refreshRun} calls `port.getSiteExportStatus()` directly and sets
 * `run` from the response, bypassing the query entirely — the same "reach past the query, call the
 * port directly" shape `use-access-tokens.hooks.ts`'s own `reloadAllStores` uses for the identical
 * reason. This is safe unconditionally, unlike a re-seed of `use-dockerfile-source.hooks.ts`'s
 * `draft`: `run` is a pure status snapshot the operator only ever VIEWS, never types into, so there
 * is no in-progress edit a background refresh could clobber. If the fresh status comes back
 * `"running"`, the poll effect below picks it up on its own next render (it re-arms whenever
 * `isRunning` flips true) — this function does not need to start polling itself.
 */
export interface StaticExportController {
  /** The current/most recent run this hook knows about — `undefined` until the first status read
   *  resolves (mirrors `DeploymentOverviewController.snapshot`'s own "undefined = still loading"
   *  convention). */
  run: AdminExportRunSnapshot | undefined;
  /** True whenever `run.status === "running"` AND polling can still reach the status endpoint —
   *  drives the poll loop and the button's disabled state (never trigger a second export while one
   *  is in flight; the server would 409 anyway, but disabling here avoids a round trip that can only
   *  fail). Also requires {@link pollError} to be `null`: once bounded polling has given up, this
   *  flips false so the button re-enables even though the server-side run may still be in progress —
   *  see {@link pollError}'s own doc. */
  isRunning: boolean;
  /** Already-formatted, translated error from the INITIAL status read — `null` while loading or
   *  once loaded successfully. Distinct from {@link triggerError}: a failed initial read and a
   *  failed trigger are different failures (same split `use-dockerfile-source.hooks.ts`'s
   *  `error`/`saveError` draws). */
  loadError: string | null;
  /** Already-formatted, translated error from the poll loop giving up after
   *  {@link StaticExportController.isRunning}'s own consecutive-failure bound — `null` while polling
   *  is healthy (or hasn't started) and reset to `null` at the start of every new {@link trigger}.
   *  Distinct from both {@link loadError} (the one-shot initial read) and {@link triggerError} (the
   *  POST that starts a run): this is the REPEATED read that keeps a `"running"` run's status
   *  current. Without a bound, an unreachable status endpoint (routine in local dev — `tsx watch`
   *  restarts kill the in-flight poll on every file save) retried forever behind a stuck spinner with
   *  the action disabled and no way out. */
  pollError: string | null;
  /** Already-formatted, translated error from the most recent {@link trigger} call — `null` until a
   *  trigger fails, reset to `null` at the start of every new attempt. Covers both a genuine
   *  rejection (malformed request) and the expected `409` from clicking while a run is already in
   *  flight. */
  triggerError: string | null;
  /** True while the trigger POST is in flight — briefer than {@link isRunning}, which stays true for
   *  the whole export, not just the initial request. */
  triggering: boolean;
  /** Whether the next {@link trigger} should ask the server to remove the output directory's
   *  existing contents first. See this file's header for why this is never set anywhere but by the
   *  operator's own gesture. */
  clean: boolean;
  setClean: (value: boolean) => void;
  /** Starts a new export run with the current {@link clean} value. Resolves either way (a failure is
   *  surfaced through {@link triggerError}, not a thrown rejection) — callers don't need a try/catch
   *  of their own. */
  trigger: () => Promise<void>;
  /** Bound translator — see `use-deployment-overview.hooks.ts`'s header for this app's standing i18n
   *  rule. */
  t: Translate;
}

/** How often the poll loop re-checks the run's status while it is `"running"`. Short enough that a
 *  ~1s local export (the fastest one this feature has been observed to take) still shows more than
 *  one "Exporting…" frame, long enough not to flood the server for a run documented as "seconds to
 *  minutes". */
const EXPORT_POLL_INTERVAL_MS = 1500;

/** How many CONSECUTIVE poll failures the loop below tolerates before giving up and surfacing
 *  {@link StaticExportController.pollError} instead of retrying forever. At `EXPORT_POLL_INTERVAL_MS`
 *  (1.5s) this is ~4.5s of tolerance — enough to ride out a `tsx watch` restart (the routine local-dev
 *  cause the audit finding this closes calls out, C2) without stranding a genuinely permanent failure
 *  (server crash, revoked auth) on a dead spinner indefinitely. */
const POLL_FAILURE_LIMIT = 3;

export function useStaticExport(required: {
  port: StaticExportPort; t: Translate; locale: string;
  useFetchQuery: typeof useFetchQuery; useContentRefreshSubscription: typeof useContentRefreshSubscription;
  describeApiError: (required: { e: unknown; fallback: string }) => string;
  exportLoadErrorMessage: (required: { locale: string; error: string }) => string;
  exportPollErrorMessage: (required: { locale: string; error: string }) => string;
  exportTriggerErrorMessage: (required: { locale: string; error: string }) => string;
  setTimeout: typeof globalThis.setTimeout; clearTimeout: typeof globalThis.clearTimeout;
}, _options = {}): StaticExportController {
  const { port, t, locale, describeApiError, exportTriggerErrorMessage, exportPollErrorMessage, setTimeout, clearTimeout } = required;
  const {
    run, setRun, clean, setClean, triggering, setTriggering, triggerError, setTriggerError, pollError, setPollError, seededRef, loadError, pollFailuresRef,
    isRunning, pollInputs,
  } = useStaticExportState(required);
  useStaticExportPolling({ isRunning, pollInputs, pollFailuresRef, setRun, setPollError, describeApiError, exportPollErrorMessage, setTimeout, clearTimeout });

  // Synchronous duplicate-submit guard — same reasoning as `use-static-publish.hooks.ts`'s
  // `publishingRef` (C4): two calls in one tick both read this render's `triggering: false`
  // (terra review 2026-09-20, finding 5).
  const triggeringRef = useRef(false);

  async function trigger() {
    if (triggeringRef.current) return;
    triggeringRef.current = true;
    // Local action supersedes any still-pending bootstrap read: mark it consumed BEFORE the request
    // even starts, so a bootstrap GET that resolves late — after this trigger's own response already
    // set `run` — cannot land on top of it and silently kill polling for a run the server is still
    // actually running (C1). Ordering is what makes this safe: this write is synchronous and
    // happens-before the `await` below, so it wins the race regardless of how late the bootstrap
    // read resolves.
    seededRef.current = true;
    // A fresh trigger also clears any earlier poll-failure standoff (C2) — the operator retrying via
    // this same button is exactly the recovery path a stalled `pollError` is meant to unblock.
    pollFailuresRef.current = 0;
    setPollError(null);
    setTriggerError(null);
    setTriggering(true);
    try {
      const started = await port.triggerSiteExport({}, { options: { clean } });
      setRun(started);
    } catch (err) {
      setTriggerError(exportTriggerErrorMessage({ locale, error: describeApiError({ e: err, fallback: "unknown error" }) }));
    } finally {
      triggeringRef.current = false;
      setTriggering(false);
    }
  }

  return { run, isRunning, loadError, pollError, triggerError, triggering, clean, setClean, trigger, t };
}

function useStaticExportPolling(
  { isRunning, pollInputs, pollFailuresRef, setRun, setPollError, describeApiError, exportPollErrorMessage, setTimeout, clearTimeout }:
    Pick<ReturnType<typeof useStaticExportState>, "isRunning" | "pollInputs" | "pollFailuresRef" | "setRun" | "setPollError"> & Pick<Parameters<typeof useStaticExport>[0], "describeApiError" | "exportPollErrorMessage" | "setTimeout" | "clearTimeout">
) {
  // Poll loop: re-armed only when `isRunning` FLIPS to true (mount-while-running counts), not on
  // every `run` update the loop itself produces — a dependency on `run` here would re-schedule (or,
  // worse, fail to reschedule after a transient fetch error that never touched `run`) on every tick
  // instead of running as one self-scheduling loop. Each iteration decides whether to continue from
  // the STATUS IT JUST FETCHED, not from the outer `isRunning` closure, which is correctly stale
  // inside a single effect run. A fetch failure retries on the same schedule rather than silently
  // giving up — a transient network hiccup must not strand the UI on "Exporting…" forever.
  useEffect(() => {
    if (!isRunning) return undefined;
    const { port: pollPort, locale: pollLocale } = pollInputs.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function scheduleNext() {
      timer = setTimeout(poll, EXPORT_POLL_INTERVAL_MS);
    }
    async function poll() {
      try {
        const status = await pollPort.getSiteExportStatus();
        if (cancelled) return;
        pollFailuresRef.current = 0;
        setRun(status);
        if (status.status === "running") scheduleNext();
      } catch (err) {
        if (cancelled) return;
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= POLL_FAILURE_LIMIT) {
          // Bounded (C2): give up rather than retry forever. Setting `pollError` also flips
          // `isRunning` false on the next render, which re-arms this very effect's cleanup and
          // re-enables the Build button — but `return` here (no `scheduleNext()`) is what actually
          // stops the loop; it must not depend on that later render having happened yet.
          setPollError(exportPollErrorMessage({ locale: pollLocale, error: describeApiError({ e: err, fallback: "unknown error" }) }));
          return;
        }
        scheduleNext();
      }
    }
    scheduleNext();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isRunning]);
}

function useStaticExportState(
  { port, locale, useFetchQuery, useContentRefreshSubscription, describeApiError, exportLoadErrorMessage }:
    Parameters<typeof useStaticExport>[0]
) {
  const query = useFetchQuery({ key: ["deployment", "export"], fetch: () => port.getSiteExportStatus() });
  const [run, setRun] = useState<AdminExportRunSnapshot | undefined>(undefined);
  const [clean, setClean] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  // Seeds `run` from the query's first successful load, exactly once — see this file's header.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || query.status === "loading" || !query.data) return;
    seededRef.current = true;
    setRun(query.data);
  }, [query.status, query.data]);

  const loadError = query.error ? exportLoadErrorMessage({ locale, error: describeApiError({ e: query.error, fallback: "unknown error" }) }) : null;

  // See this file's header for why this bypasses the query/`seededRef` entirely rather than being
  // the usual `useInvalidate()` one-liner. A failed background refresh is swallowed rather than
  // surfaced through `loadError`/`triggerError` — this is a best-effort catch-up read, not a load or
  // trigger the operator directly asked for, and the visible `run` simply stays what it was.
  const refreshRun = useCallback(async () => {
    try {
      const status = await port.getSiteExportStatus();
      setRun(status);
    } catch {
      // best-effort; see comment above
    }
  }, [port]);
  // `useContentRefreshSubscription`'s `onRefresh` is a synchronous `() => void` — wrapping rather
  // than passing `refreshRun` directly, mirroring `use-access-tokens.hooks.ts`'s identical
  // `reloadAllStores`/`triggerReload` split, so the subscription never hands the bus a dangling
  // Promise.
  const triggerRefresh = useCallback(() => {
    void refreshRun();
  }, [refreshRun]);
  useContentRefreshSubscription({ resource: DEPLOYMENT_EXPORT_RESOURCE, onRefresh: triggerRefresh });

  // Counts CONSECUTIVE poll failures for the `POLL_FAILURE_LIMIT` bound below — a ref, not state,
  // because it is read and written only from inside the poll loop's own effect and must never itself
  // trigger a render (only the `pollError` it may eventually set does that).
  const pollFailuresRef = useRef(0);

  const isRunning = run?.status === "running" && pollError === null;
  const pollInputs = useRef({ port, locale });
  pollInputs.current = { port, locale };
  return {
    run, setRun, clean, setClean, triggering, setTriggering, triggerError, setTriggerError, pollError, setPollError, seededRef, loadError, pollFailuresRef,
    isRunning, pollInputs,
  };
}

