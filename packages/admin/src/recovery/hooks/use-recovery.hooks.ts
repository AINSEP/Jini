import { useCallback as useQueryFetchCallback } from "react";
import { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate } from "../../react/kit.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminRecoveryStatus, AdminRestorePoint } from "../../core/index.js";
import { RECOVERY_RESOURCE, parseDeepLinkEnvelope } from "../rules.js";

import { t } from "../recovery-i18n.js";
import type { RecoveryPort } from "./recovery-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Everything the Recovery SCREEN (the restore-points list + status/banner) does, so
 * `Recovery.tsx`'s exported `Recovery` component is only markup.
 *
 * Extracted verbatim — same state, same order, same two effects, same error strings. The restore
 * ceremony itself (`RestoreFlow`'s `plan`/`confirm`/`execute` state machine) is a separate
 * component with its own hook, `use-restore-flow.hooks.ts` — it is independent state with its own
 * lifecycle, keyed to whichever restore point is currently selected.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/recovery` needs it.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import): this hook already called
 * `useAdminLocale()` for its own error-string translations, so exposing that SAME already-resolved
 * `locale` as a bound `t` (plus the raw value, still needed for `Recovery.tsx`'s local
 * `DegradedBannerView`/`RestorePointsList` subcomponents, which take `locale` directly) on the
 * return value adds no new fetch — `Recovery.tsx` used to call `useAdminLocale()` a second time,
 * entirely redundant with the resolution this hook was already doing internally.
 *
 * DI seam (2026-08-14, Orc-BASH pass): `port` is injected — see `recovery-port.hooks.ts` — rather
 * than reaching `lib/api` directly, so a test can describe load/deep-link outcomes against
 * `createFakeRecoveryPort` instead of stubbing global `fetch`. The host's `useWiredRecovery` binding is
 * the zero-argument pair `Recovery.tsx` actually mounts.
 *
 * Host seam: the locale hook, the API-error describer, the router's `navigate`, the content-refresh
 * subscription hook and the error reporter all arrive on `host` (`RecoveryHost`), so this file
 * reaches neither the host's HTTP client nor the admin shell. Pass a module-level `host` object:
 * its two hooks are called on every render and must keep their identity.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass — see that hook's own header):
 * `load` is pulled into a `useCallback` so it can also be handed to that hook, which re-runs it
 * whenever `backup_create_restore_point` (the host's database agent tools)
 * mints a restore point this screen's `points` also lists, from an assistant run this screen
 * otherwise has no way to learn about — see `rules.ts`'s `RECOVERY_RESOURCE` for the full mapping.
 * `selected` is untouched by a reload (it is set once, either by the deep-link effect below or by
 * an operator's own row click, and never re-derived from `points` afterward), so a background
 * refresh cannot yank the operator out of an in-progress `RestoreFlow`.
 */

export interface RecoveryController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  status: AdminRecoveryStatus | null;
  points: AdminRestorePoint[] | null;
  error: string | null;
  /** `creating` reflects the in-flight no-argument restore-point creation request. */
  creating: boolean;
  createRestorePoint: () => Promise<void>;
  /** The restore point a "Restore…" row action selected, or the one a resolved deep link matched —
   *  `null` shows the plain list, non-null swaps in `RestoreFlow` (design-spec.md §0.1: a full
   *  inline swap, never a modal-over-list). */
  selected: AdminRestorePoint | null;
  setSelected: (point: AdminRestorePoint | null) => void;
  /** Bound translator — `key` already resolved against the caller's locale, so `Recovery.tsx` never
   *  imports `useAdminLocale`/`recovery-i18n` for the top-level screen. See this file's header. */
  t: Translate;
  /** Raw resolved locale — `Recovery.tsx`'s local `DegradedBannerView`/`RestorePointsList`
   *  subcomponents take `locale` directly rather than a bound translator. See this file's header. */
  locale: string;
}

/** What the host supplies so this hook stays free of its HTTP client, router and shell. */
export interface RecoveryHost {
  /** The admin's resolved UI locale (a React hook). */
  useLocale: () => string;
  /** Turns a thrown API error into the operator-facing message, `fallback` when it has none. */
  describeError: (required: { e: unknown; fallback: string }) => string;
  /** The admin router's navigation. */
  navigate: (required: { routePath: string }, optional?: { replace?: boolean }) => void;
  /** Re-runs `onRefresh` whenever an assistant run touches `resource` (a React hook). */
  useContentRefreshSubscription: (required: { resource: string; onRefresh: () => void }) => void;
  /** Where an unexpected failure is logged. */
  reportError: (required: { message: string; error: unknown }) => void;
}

export interface RecoveryDependencies {
  port: RecoveryPort;
  host: RecoveryHost;
}

/**
 * @param deps Injected dependencies — the `RecoveryPort` to load status/points/deep-link resolution
 * through, and the `RecoveryHost` collaborators.
 * @returns The Recovery screen's status/points/selected state plus `setSelected`, and a bound
 * `t`/`locale` — see this file's header for the full rationale.
 */
export function useRecovery(deps: RecoveryDependencies, _optional: Record<string, never> = {}): RecoveryController {
  const { port, host } = deps;
  const locale = host.useLocale();
  const boundT = (key: string): string => t({ locale: locale, key: key });
  const queryFetch = useQueryFetchCallback(async () => {
    try {
      const [status, result] = await Promise.all([port.getRecoveryStatus(), port.listRecoveryRestorePoints()]);
      return { status, points: result.items };
    } catch (error) { throw new Error(host.describeError({ e: error, fallback: t({ locale, key: "failed to load Recovery" }) })); }
  }, [port, host, locale]);
  // Mount reads and tool-progress refreshes can overlap. The shared query cache owns read
  // settlement order so an earlier status/list response cannot overwrite a newer refresh.
  const key = useMemo(() => ["recovery", "overview"] as const, []);
  const query = useFetchQuery({ key, fetch: queryFetch }, { staleTime: 0 });
  const loader = useCachedLoader({ key, fetch: queryFetch }, { staleTime: 0 });
  const status = query.data?.status ?? null;
  const points = query.data?.points ?? null;
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? query.error?.message ?? null;
  const invalidate = useInvalidate();
  const create = useFetchMutation({ run: () => port.createRestorePoint({}, { trigger: "manual", costAck: true }) }, { invalidates: [["recovery"]] });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<AdminRestorePoint | null>(null);
  // Read ordering and background data retention now belong to the shared query cache.
  const load = useCallback(() => { setError(null); invalidate({ key: ["recovery"] }); }, [invalidate]);
  host.useContentRefreshSubscription({ resource: RECOVERY_RESOURCE, onRefresh: load });

  /** Restore-point functionality consolidation (2026-09-10) — same no-capabilities-read shape
   *  Database's former create action used: no route exists yet to learn
   *  `costClass` ahead of time (design-spec.md §3.3 wants a cost/disk estimate the confirmer
   *  explicitly acknowledges first), so `costAck: true` is sent unconditionally; an `unavailable`
   *  site gets the server's own `RESTORE_POINT_UNAVAILABLE` rejection rather than a client-side
   *  guess. Mutation invalidation refreshes status/points through the shared cache, and the
   *  action awaits that read before clearing creating; costClass/banner remain authoritative.
   */
  const createRestorePoint = useCallback(async () => {
    setError(null);
    setCreating(true);
    try {
      await create.mutate({ input: {} });
      await loader.load().catch(() => {}); // Await settlement; query.error owns read failures, never retry an accepted capture.
    } catch (e) {
      setError(host.describeError({ e, fallback: t({ locale: locale, key: "Failed to create restore point" }) }));
    } finally {
      setCreating(false);
    }
  }, [create.mutate, loader, host, locale]);

  // Deep-link arrival (design-spec.md §4.5, ADR-041 §7/ADR-045 §5, INV-04): re-resolve any
  // envelope `Database.tsx` stashed before navigating here. A stale/forged/pruned envelope
  // resolves to `found: false` — an expected, non-exceptional case, not an error toast.
  useEffect(() => {
    if (!points) return;
    const raw = sessionStorage.getItem("recovery-deep-link-envelope");
    if (!raw) return;
    sessionStorage.removeItem("recovery-deep-link-envelope");
    const parsed = parseDeepLinkEnvelope({ raw: raw });
    if (!parsed.ok) return;
    port
      .resolveRecoveryDeepLink(parsed.envelope)
      .then((result) => {
        const restorePoint = result.restorePoint;
        if (result.found && restorePoint) {
          const match = points.find((p) => p.id === restorePoint.restorePointId);
          if (match) {
            setSelected(match);
            // Tabs (2026-09-10): a resolved deep link used to swap straight into `RestoreFlow` with
            // no tab bar in the way. Now that Recovery is tabbed, landing here also has to move the
            // URL onto the "restore" tab, or the operator would land on the Restore points list with
            // no visible sign the ceremony is one click away — same silent-regression risk this
            // effect's whole existence guards against.
            host.navigate({ routePath: "/recovery?tab=restore" }, { replace: true });
          }
        }
      }, () => undefined) // a failed re-verification falls back to the plain list, no alarm
      .catch((error: unknown) => {
        host.reportError({ message: "[recovery] Could not apply the recovery link", error });
        setError(t({ locale, key: "Failed to open recovery link" }));
      });
  }, [points, port, host, locale]);

  return { status, points, error, creating, createRestorePoint, selected, setSelected, t: boundT, locale };
}

