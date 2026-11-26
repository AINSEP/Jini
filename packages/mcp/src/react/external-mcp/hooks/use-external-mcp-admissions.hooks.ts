import type { AdminHttpError } from "@jini-ai/core/admin-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AdminExternalMcpAdmissionsSnapshot } from "@jini-ai/core/contracts/hosted-mcp";
import type { useFetchMutation, useFetchQuery } from "@jini-ai/ui/fetch-query";
import type { hasPermission } from "@jini-ai/ui/panel-kit";

import type { admissionRestartHelps } from "@jini-ai/admin/screens/settings/external-mcp-tool-drift";
import type { describeAdmissionDrift } from "@jini-ai/admin/screens/settings/external-mcp-connection-drift";
import { type AdmissionDriftConnection, type SavedConnectionIntent } from "@jini-ai/admin/screens/settings/external-mcp-drift-types";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The transport behind Settings → External MCP's "what is the assistant actually running"
 * banner: three reads the app already had clients for, and never called together.
 *
 * ## The 503 is data, not an error to swallow
 *
 * `GET .../mcp-servers/admissions` answers a down or unreachable daemon with a distinguishable 503
 * (`code: "AGENT_DAEMON_UNAVAILABLE"`) rather than `{ connections: [] }`, precisely so "the
 * assistant is not running" and "it is running with nothing admitted" stay distinguishable — see
 * that route's own header. This hook preserves that: {@link ExternalMcpAdmissionsController.unavailable}
 * is a sentence to render, never a silently empty list.
 *
 * ## Why the restart button needs a permission read of its own
 *
 * `POST .../system/assistant-daemon/restart` is `system.write`-gated, while this whole tab is
 * `admin.integrations.manage`-gated — so an operator with integration rights and no system rights
 * would get a 403 from a button that looked available. The outline calls that out as decision D-4
 * and answers it: hide the button, and say who can do it instead. `hasPermission` (not a bare
 * `.includes`) is what makes that correct for a workspace owner, whose grant is the literal `"*"`.
 *
 * This is affordance-hiding, not authorization: the route re-checks server-side on every call.
 */

/** The three calls this hook makes, injectable so a test composes it with plain fakes. */
export interface ExternalMcpAdmissionsPort {
  getAdmissions(): Promise<AdminExternalMcpAdmissionsSnapshot>;
  me(): Promise<{ effectivePermissions?: string[] }>;
  restartAssistantDaemon(): Promise<{ ok: boolean; reason?: string }>;
}

export interface ExternalMcpAdmissionsController {
  readonly loading: boolean;
  /** A sentence to render when the daemon could not be asked AND the automatic wait for it is over.
   *  `null` when it answered, and `null` while {@link waitingForAssistant} is still true. */
  readonly unavailable: string | null;
  /** `true` while the daemon cannot be asked for a reason that normally clears on its own (it is
   *  booting or respawning) and this hook is still re-asking — see {@link useUnavailableRetry}. */
  readonly waitingForAssistant: boolean;
  /** Only connections with something to say — an agreeing roster renders nothing. */
  readonly connections: readonly AdmissionDriftConnection[];
  /** Whether any listed disagreement would change on a restart. Independent of permissions. */
  readonly restartHelps: boolean;
  /** D-4: whether this principal may actually restart the assistant. */
  readonly canRestart: boolean;
  readonly restarting: boolean;
  /** The restart route's own refusal reason (it answers 409 while shutting down), or `null`. */
  readonly restartError: string | null;
  /** `true` while a restart this hook triggered was ACCEPTED and the bounded re-read that follows it
   *  is still running — never "the assistant is back up", which no signal in this codebase can
   *  currently claim (see the restart route's own header). It goes false when the watch window
   *  closes, so the "Restarting…" line stops after {@link RESTART_WATCH_ATTEMPTS} attempts rather
   *  than standing for the rest of the mounted session (2026-09-07, ADM-002). */
  readonly restartAccepted: boolean;
  restart(): void;
}

const ADMISSIONS_KEY = ["external-mcp", "admissions"] as const;
const PERMISSIONS_KEY = ["auth", "me"] as const;

/** Splits the admissions read into "answered" and "could not be asked". Extracted so
 *  {@link useExternalMcpAdmissions} stays under the shop complexity ceiling; the fallback sentence
 *  is `describeApiError`'s job, so the route's own 503 body reaches the operator rather than being
 *  replaced by a generic one. */
function resolveUnavailable({ error, t, describeApiError }: { error: unknown; t: Translate; describeApiError: Parameters<typeof useExternalMcpAdmissions>[0]["describeApiError"] }, _options = {}): string | null {
  if (!error) return null;
  return describeApiError({ e: error, fallback: t("The assistant is not reporting what it loaded — it may not be running.") });
}

/** The admissions route's own 503 code (`routes/external-mcp/admissions.ts`) for "the daemon could
 *  not be asked". */
const AGENT_DAEMON_UNAVAILABLE_CODE = "AGENT_DAEMON_UNAVAILABLE";

/**
 * Whether a failed admissions read is one that normally clears on its own: the daemon is booting or
 * respawning (the route's 503), or the API in front of it is (unreachable, timed out, or a 5xx from
 * the dev proxy). A 401/403/404 is not — waiting changes nothing about those.
 *
 * Why waiting is the right default (2026-09-29): the daemon only binds its port AFTER it has
 * connected every saved external MCP server, one after another (`agent-daemon-server.ts` `start()`),
 * and the dev API respawns it on every source save. A boot was measured at ~80s after the API's own
 * ~40s. Reading once on mount and showing "not reachable" for that whole window put a red error in
 * front of an assistant that was simply starting — and nothing re-read it afterwards.
 *
 * @complexity O(1).
 */
export function isAssistantStartingError({ error, isApiError, apiUnreachableCode, requestTimeoutCode }: { error: unknown } & Pick<Parameters<typeof useExternalMcpAdmissions>[0], "isApiError" | "apiUnreachableCode" | "requestTimeoutCode">, _options = {}): boolean {
  if (!isApiError(error)) return false;
  if (error.code === AGENT_DAEMON_UNAVAILABLE_CODE || error.code === apiUnreachableCode || error.code === requestTimeoutCode) return true;
  return error.status >= 500;
}

/** Gap between automatic re-reads while the assistant is starting. */
export const UNAVAILABLE_RETRY_INTERVAL_MS = 3_000;

/** How long the automatic wait lasts before the real error is shown: 60 × 3s = three minutes, which
 *  holds a dev API reload plus a slow daemon boot with room to spare. A daemon that is genuinely
 *  down still gets reported — just not during the window where "down" is the wrong reading. */
export const UNAVAILABLE_RETRY_ATTEMPTS = 60;

/**
 * Re-reads the admissions snapshot while it keeps failing with {@link isAssistantStartingError},
 * up to {@link UNAVAILABLE_RETRY_ATTEMPTS} times, and resets once a read succeeds (or fails for a
 * reason waiting cannot fix). Same `setTimeout`-chain-on-a-counter shape as {@link useRestartWatch},
 * for the same reasons. A read already in flight is never interrupted: `refetch` cancels an in-flight
 * request, so firing on a timer regardless would starve a slow-but-answering daemon forever.
 *
 * @returns `true` while still waiting — the caller shows a calm "starting" line instead of the error.
 * @complexity O(1) per attempt; at most {@link UNAVAILABLE_RETRY_ATTEMPTS} attempts per outage.
 */
function useUnavailableRetry(
  { failingTransiently, isFetching, refetch, setTimeout, clearTimeout }: {
    setTimeout: typeof globalThis.setTimeout; clearTimeout: typeof globalThis.clearTimeout;
    failingTransiently: boolean;
    isFetching: boolean;
    refetch: () => void;
  },
  _options = {},
): boolean {
  const [attempts, setAttempts] = useState(0);
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  // Judge the outage only on SETTLED reads. `@jini-ai/ui`'s fetch-query cache clears `error` while a
  // re-read of a never-answered query is in flight (Jini kept it), so reading the live value made
  // every retry look like a recovery: the counter reset to 0 each time and a daemon that is genuinely
  // down was polled forever and never reported. Holding the last settled value across the in-flight
  // read keeps the bound real and the "starting" line steady. (React's adjust-state-during-render
  // pattern, so the held value is never one render stale.)
  const [settledFailing, setSettledFailing] = useState(failingTransiently);
  if (!isFetching && settledFailing !== failingTransiently) setSettledFailing(failingTransiently);

  useEffect(() => {
    if (!settledFailing) setAttempts(0);
  }, [settledFailing]);

  const waiting = settledFailing && attempts < UNAVAILABLE_RETRY_ATTEMPTS;

  useEffect(() => {
    const handle =
      !waiting || isFetching
        ? undefined
        : setTimeout(() => {
            refetchRef.current();
            setAttempts((used) => used + 1);
          }, UNAVAILABLE_RETRY_INTERVAL_MS);
    return () => clearTimeout(handle);
  }, [waiting, isFetching, attempts]);

  return waiting;
}

/** Gap between post-restart re-reads. The daemon is a child of the API process and comes back in
 *  roughly three seconds, so this is a little under two boots — long enough that a slow boot is not
 *  spent on the first two attempts, short enough that the banner is not visibly lagging. */
const RESTART_WATCH_INTERVAL_MS = 2_500;

/** How many re-reads one accepted restart buys. Eight × 2.5s covers twenty seconds, which is far
 *  outside any observed daemon boot. Bounded rather than "until the snapshot changes" because
 *  nothing in the snapshot identifies WHICH daemon answered — a restart into an identical
 *  configuration produces a byte-identical reply, so "it changed" is not a signal that exists. */
const RESTART_WATCH_ATTEMPTS = 8;

/**
 * A bounded re-read of the admissions snapshot, armed by an accepted restart.
 *
 * Not `invalidates: [ADMISSIONS_KEY]` on the restart mutation, and that is the whole design point.
 * `POST .../system/assistant-daemon/restart` answers as soon as a restart has been INITIATED and
 * structurally cannot wait for the new daemon to be healthy (that route's own header states this
 * and points the caller at polling instead). A refetch fired on its 200 is therefore guaranteed to
 * read the dying daemon or a 503 — it would replace one wrong answer with another and then stop.
 *
 * A chain of `setTimeout`s driven by the remaining-attempt count, rather than one `setInterval`:
 * the count is the state the UI already needs to render (`watching`), so deriving the schedule from
 * it keeps one source of truth and makes React's own cleanup cancel the pending read on unmount.
 *
 * @param input.refetch - The admissions query's `refetch`. Read through a ref so a change of query
 *   identity cannot re-arm the timer on every render — a spin, not a schedule. Jini keeps
 *   the callable stable while the cache entry stays the same.
 * @complexity O(1) per attempt; at most {@link RESTART_WATCH_ATTEMPTS} attempts per accepted restart.
 */
function useRestartWatch({ refetch, setTimeout, clearTimeout }: { refetch: () => void; setTimeout: typeof globalThis.setTimeout; clearTimeout: typeof globalThis.clearTimeout }, _options = {}): { watching: boolean; begin: () => void } {
  const [attemptsLeft, setAttemptsLeft] = useState(0);
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  useEffect(() => {
    // One arming expression and one cleanup, rather than an early `return` for the idle case:
    // `clearTimeout(undefined)` is a specified no-op, so the idle render still yields a cleanup and
    // the effect has a single exit.
    const handle =
      attemptsLeft <= 0
        ? undefined
        : setTimeout(() => {
            refetchRef.current();
            setAttemptsLeft((left) => left - 1);
          }, RESTART_WATCH_INTERVAL_MS);
    return () => clearTimeout(handle);
  }, [attemptsLeft]);

  const begin = useCallback(() => setAttemptsLeft(RESTART_WATCH_ATTEMPTS), []);
  return { watching: attemptsLeft > 0, begin };
}

/** One restart outcome — a RESOLVED `{ok: false, reason}` is this route's "refused right now", not a
 *  rejection (`api.ts`'s own comment on `restartAssistantDaemon`). */
type RestartOutcome = { ok: boolean; reason?: string };

/**
 * The click handler: fire the restart, record its outcome, and arm the post-restart watch only when
 * the restart was ACCEPTED. A `{ok: false}` refusal ("shutting down") means nothing was restarted,
 * so there is no new daemon to catch up to and re-reading would just re-fetch the same snapshot
 * eight times.
 *
 * Split out of {@link useExternalMcpAdmissions} to keep that hook under the shop complexity ceiling.
 *
 * @complexity O(1).
 */
function useRestartAction(
  { mutate, setOutcome, beginRestartWatch, reportRestartFailure }: {
    reportRestartFailure: (error: unknown) => void;
    mutate: (required: { input: undefined }) => Promise<RestartOutcome>;
    setOutcome: (outcome: RestartOutcome | null) => void;
    beginRestartWatch: () => void;
  },
  _options = {},
): () => void {
  return useCallback(() => {
    setOutcome(null);
    // `mutate` reports a rejected restart through `restartCall.error`, but `.then` derives a new
    // promise that needs a handler too; a failure in its success callback needs its own diagnostic.
    void mutate({ input: undefined })
      .then((result) => {
        setOutcome(result);
        if (result.ok) beginRestartWatch();
      }, () => { /* restartCall.error exposes the failed restart. */ })
      .catch((error: unknown) => reportRestartFailure(error));
  }, [mutate, setOutcome, beginRestartWatch, reportRestartFailure]);
}

/** The route's own refusal reason, or `null`. Its 409 body carries `reason`; an older build that
 *  refuses without one still has to say something, so the fallback is a sentence rather than a
 *  silent `null` that would render as "the restart worked". */
function resolveRefusal({ outcome, t }: { outcome: RestartOutcome | null; t: Translate }, _options = {}): string | null {
  if (!outcome || outcome.ok) return null;
  return outcome.reason ?? t("the restart was refused");
}

/**
 * @param deps.port - See {@link ExternalMcpAdmissionsPort}.
 * @param deps.savedAllowedToolNamesById - Each roster card's own `allowedToolNames` field value,
 *   keyed by server id, plus its on/off toggle, so the banner can state saved-vs-live rather than
 *   only live — including for a saved connection the daemon never reported (ADM-001).
 * @complexity O(c · t) in connections and their refused tools.
 * @overallScore 100
 */
export function useExternalMcpAdmissions(deps: {
  port: ExternalMcpAdmissionsPort;
  savedAllowedToolNamesById: Readonly<Record<string, SavedConnectionIntent>>;
  t: Translate;
  useFetchQuery: typeof useFetchQuery; useFetchMutation: typeof useFetchMutation;
  hasPermission: typeof hasPermission; describeAdmissionDrift: typeof describeAdmissionDrift; admissionRestartHelps: typeof admissionRestartHelps;
  driftCopy: Parameters<typeof describeAdmissionDrift>[0]["copy"];
  describeApiError: (required: { e: unknown; fallback: string }) => string;
  isApiError: (error: unknown) => error is AdminHttpError;
  apiUnreachableCode: string; requestTimeoutCode: string;
  setTimeout: typeof globalThis.setTimeout; clearTimeout: typeof globalThis.clearTimeout;
  reportRestartFailure: (error: unknown) => void;
}, _optional: Record<string, never> = {}): ExternalMcpAdmissionsController {
  const { port, savedAllowedToolNamesById, t, useFetchQuery, useFetchMutation, hasPermission, describeAdmissionDrift, admissionRestartHelps, driftCopy, describeApiError, isApiError, apiUnreachableCode, requestTimeoutCode, setTimeout, clearTimeout, reportRestartFailure } = deps;

  const admissions = useFetchQuery({ key: ADMISSIONS_KEY, fetch: () => port.getAdmissions() });
  const permissions = useFetchQuery({ key: PERMISSIONS_KEY, fetch: () => port.me() });
  const restartCall = useFetchMutation({ run: () => port.restartAssistantDaemon() });
  // `MutationResult` carries `status`/`error` but no `data`, and this route's "refused right now"
  // outcome is a RESOLVED `{ ok: false, reason }` rather than a rejection (`api.ts`'s own comment on
  // `restartAssistantDaemon`) — so the refusal reason has to be captured here or it is lost.
  const [outcome, setOutcome] = useState<RestartOutcome | null>(null);

  const connections = useMemo(
    () => describeAdmissionDrift({ snapshot: admissions.data, savedById: savedAllowedToolNamesById, copy: driftCopy }),
    [admissions.data, savedAllowedToolNamesById, describeAdmissionDrift, driftCopy],
  );

  const { watching, begin: beginRestartWatch } = useRestartWatch({ refetch: admissions.refetch, setTimeout, clearTimeout });
  const restart = useRestartAction({ mutate: restartCall.mutate, setOutcome, beginRestartWatch, reportRestartFailure });
  const waitingForAssistant = useUnavailableRetry({ failingTransiently: isAssistantStartingError({ error: admissions.error, isApiError, apiUnreachableCode, requestTimeoutCode }), isFetching: admissions.isFetching, refetch: admissions.refetch, setTimeout, clearTimeout });

  const refusal = resolveRefusal({ outcome, t });

  return {
    loading: admissions.status === "loading",
    unavailable: waitingForAssistant ? null : resolveUnavailable({ error: admissions.error, t, describeApiError }),
    waitingForAssistant,
    connections,
    restartHelps: admissionRestartHelps({ connections }),
    canRestart: hasPermission({ permissions: permissions.data?.effectivePermissions ?? [], permission: "system.write" }),
    restarting: restartCall.status === "pending",
    restartError: refusal ?? (restartCall.error ? describeApiError({ e: restartCall.error, fallback: t("Could not restart the assistant.") }) : null),
    restartAccepted: outcome?.ok === true && watching,
    restart,
  };
}

