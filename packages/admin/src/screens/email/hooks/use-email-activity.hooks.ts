import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EmailApi, MailActivityDetail, MailActivityFilter, MailActivityPage, MailSuppressionEntry, MailSuppressionRemovalPlan } from "../email-api.types.js";
import { MAIL_CAPTURE_CLEAR_PERMISSION, type MailCaptureClearPlan } from "@jini-ai/core/contracts/mail";
import type { MailFeedbackSetupReport } from "@jini-ai/core/contracts/site/platform-mail";
import { errorMessage, isForbidden, type useLoad, type LoadView, type EmailLoadApiError } from "./email-load.hooks.js";

/**
 * @file Activity tab state: recent sends (`GET …/mail-activity`, filters + cursor paging + one
 * send's feedback timeline), blocked addresses (`GET …/mail-suppressions`) and feedback setup
 * (`GET …/mail-feedback`).
 *
 * Removing a block is the server's two-step contract (`POST …/mail-suppressions/remove`): first
 * WITHOUT `confirmed` to get the plan (what was blocked, why, the warnings), then again with
 * `confirmed: true` and that plan's `revision`. The person must give a reason; the server records
 * it and refuses without one, and refuses anyone without `mail.suppressions.manage` (owner).
 *
 * "Clear all test emails" (`POST …/mail-capture/clear`) is the same two steps: a bodyless preview
 * answers the count and a `revision`, and only a confirmed request carrying that revision deletes.
 * It is offered only to a holder of `mail.capture.clear` (owner).
 */

/** A list that grows by "Load more"; a failed later page keeps what is shown. */
export interface PagedList<T> {
  view: LoadView<{ items: T[]; nextCursor: string | null; empty: "none_recorded" | "no_matches" | null; access?: "full" | "masked" }>;
  loadingMore: boolean;
  moreError: string | null;
  loadMore: () => Promise<void>;
  reload: () => void;
}

export type RemovalStep =
  | { kind: "reason"; entry: MailSuppressionEntry; reason: string; error: string | null; pending: boolean }
  | { kind: "confirm"; entry: MailSuppressionEntry; plan: MailSuppressionRemovalPlan; error: string | null; pending: boolean };


/** Shown when the captured emails changed between the preview and the confirm (HTTP 400). */
export const STALE_CAPTURE_MESSAGE = "The test emails changed. Review and confirm again.";

export type CaptureClearState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "confirm"; plan: MailCaptureClearPlan; revision: string; error: string | null; pending: boolean }
  | { kind: "empty" }
  | { kind: "cleared"; deleted: number }
  | { kind: "error"; message: string };

/** Clearing captured test emails: preview → confirm with that preview's revision. */
export interface CaptureClearFlow {
  /** Whether the person holds `mail.capture.clear` and the host can clear at all. */
  canClear: boolean;
  state: CaptureClearState;
  start: () => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => void;
}

export interface EmailActivityController {
  filter: MailActivityFilter;
  setFilter: (next: MailActivityFilter) => void;
  activity: PagedList<MailActivityPage["items"][number]>;
  openId: string | null;
  detail: LoadView<MailActivityDetail> | null;
  toggleDetail: (id: string) => void;
  search: string;
  setSearch: (value: string) => void;
  suppressions: PagedList<MailSuppressionEntry>;
  removal: RemovalStep | null;
  startRemoval: (entry: MailSuppressionEntry) => void;
  setRemovalReason: (reason: string) => void;
  continueRemoval: () => Promise<void>;
  cancelRemoval: () => void;
  removedNotice: string | null;
  feedback: LoadView<MailFeedbackSetupReport>;
  capture: CaptureClearFlow;
}

const MIN_REASON = 3;

type Page<T> = { items: T[]; nextCursor: string | null; empty: "none_recorded" | "no_matches" | null; access?: "full" | "masked" };

/** One paged read keyed on `fetchPage`'s identity: a new identity (new filter) starts over. */
function usePaged<T>(required: { fetchPage: (cursor?: string) => Promise<Page<T>>; ApiError: EmailLoadApiError; useLoadHook: typeof useLoad }): PagedList<T> {
  const { fetchPage, ApiError } = required;
  const { view, reload, setData } = required.useLoadHook({ ApiError, load: useCallback(() => fetchPage(), [fetchPage]) });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const loadMore = useCallback(async () => {
    if (view.kind !== "loaded" || !view.data.nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await fetchPage(view.data.nextCursor);
      setData({ ...next, items: [...view.data.items, ...next.items], empty: null });
    } catch (error) {
      setMoreError(errorMessage({ error, ApiError }));
    } finally {
      setLoadingMore(false);
    }
  }, [view, fetchPage, setData]);
  return { view, loadingMore, moreError, loadMore, reload };
}

/** The value a text filter commits after the person stops typing. */
function useDebounced({ value, ms }: { value: string; ms: number }, _options = {}): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** Removing a block: reason → the server's plan → confirm with that plan's `revision`. */
interface RemovalFlow {
  removal: RemovalStep | null;
  startRemoval: (entry: MailSuppressionEntry) => void;
  setRemovalReason: (reason: string) => void;
  continueRemoval: () => Promise<void>;
  cancelRemoval: () => void;
  removedNotice: string | null;
}

/**
 * The suppression-removal steps of the Activity tab (see the file header for the two-step contract).
 * @param required.reloadSuppressions - refreshes the blocked-addresses list after a confirmed removal.
 */
function useRemovalFlow(required: { api: Pick<EmailApi, "removeSuppression">; reloadSuppressions: () => void; ApiError: EmailLoadApiError }): RemovalFlow {
  const { api, reloadSuppressions, ApiError } = required;
  const [removal, setRemoval] = useState<RemovalStep | null>(null);
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);
  const startRemoval = useCallback((entry: MailSuppressionEntry) => {
    setRemovedNotice(null);
    setRemoval({ kind: "reason", entry, reason: "", error: null, pending: false });
  }, []);
  const setRemovalReason = useCallback((reason: string) => setRemoval((step) => (step?.kind === "reason" ? { ...step, reason, error: null } : step)), []);
  const cancelRemoval = useCallback(() => setRemoval(null), []);

  const refusal = ({ error }: { error: unknown }, _options = {}) => (isForbidden({ error, ApiError }) ? "Only the site owner can remove a block." : errorMessage({ error, ApiError }));
  const submitReason = useCallback(async (step: Extract<RemovalStep, { kind: "reason" }>) => {
    const reason = step.reason.trim();
    if (reason.length < MIN_REASON) {
      setRemoval({ ...step, error: "Say why this address may get email again." });
      return;
    }
    setRemoval({ ...step, pending: true });
    try {
      const answer = await api.removeSuppression({ address: step.entry.address, scope: step.entry.scope, reason });
      setRemoval(answer.plan ? { kind: "confirm", entry: step.entry, plan: answer.plan, error: null, pending: false } : null);
    } catch (error) {
      setRemoval({ ...step, pending: false, error: refusal({ error }) });
    }
  }, [api]);
  const submitConfirm = useCallback(async (step: Extract<RemovalStep, { kind: "confirm" }>) => {
    setRemoval({ ...step, pending: true });
    try {
      const { plan } = step;
      await api.removeSuppression({ address: plan.address, scope: plan.scope, reason: plan.reason }, { confirm: { revision: plan.revision } });
      setRemoval(null);
      setRemovedNotice(plan.address);
      reloadSuppressions();
    } catch (error) {
      setRemoval({ ...step, pending: false, error: refusal({ error }) });
    }
  }, [api, reloadSuppressions]);
  const continueRemoval = useCallback(async () => {
    if (!removal || removal.pending) return;
    await (removal.kind === "reason" ? submitReason(removal) : submitConfirm(removal));
  }, [removal, submitReason, submitConfirm]);
  return { removal, startRemoval, setRemovalReason, continueRemoval, cancelRemoval, removedNotice };
}

/** The words for a failed clear: the owner-only refusal, a changed set, or the server's own safe message. */
function captureFailure({ error, ApiError }: { error: unknown; ApiError: EmailLoadApiError }, _options = {}): string {
  if (isForbidden({ error, ApiError })) return "Only the site owner can clear test emails.";
  if (error instanceof ApiError && error.status === 400) return STALE_CAPTURE_MESSAGE;
  return errorMessage({ error, ApiError });
}

/**
 * The clear-all-test-emails steps of the Activity tab (see the file header for the two-step contract).
 * A changed set (400) ends the flow with a plain-words error: the next `start` previews afresh, so an
 * outdated revision is never resent. Nothing is deleted unless `confirm` runs on a `confirm` state.
 * @param required.api - only `clearCaptured`; absent when the host has no capture store.
 * @param required.permissions - the session's effective permissions (`undefined` while unknown).
 * @param optional.onCleared - runs once after a confirmed clear, e.g. to refresh the send list.
 */
export function useCaptureClearFlow(required: { api: Pick<EmailApi, "clearCaptured">; permissions: readonly string[] | undefined; ApiError: EmailLoadApiError }, optional: { onCleared?: () => void } = {}): CaptureClearFlow {
  const { api, permissions, ApiError } = required;
  const { onCleared } = optional;
  const clear = api.clearCaptured;
  const canClear = clear !== undefined && permissions !== undefined && (permissions.includes("*") || permissions.includes(MAIL_CAPTURE_CLEAR_PERMISSION));
  const [state, setState] = useState<CaptureClearState>({ kind: "idle" });
  const start = useCallback(async () => {
    if (!canClear || !clear) return;
    setState({ kind: "checking" });
    try {
      const answer = await clear();
      if (answer.cleared) throw new Error("The server did not say what would be cleared.");
      const { plan, revision } = answer;
      setState(plan.count === 0 ? { kind: "empty" } : { kind: "confirm", plan, revision, error: null, pending: false });
    } catch (error) {
      setState({ kind: "error", message: captureFailure({ error, ApiError }) });
    }
  }, [canClear, clear, ApiError]);
  const confirm = useCallback(async () => {
    if (!canClear || !clear || state.kind !== "confirm" || state.pending) return;
    const { plan, revision } = state;
    setState({ ...state, pending: true, error: null });
    try {
      const answer = await clear({ confirm: { revision } });
      setState({ kind: "cleared", deleted: answer.cleared ? answer.deleted : plan.count });
      onCleared?.();
    } catch (error) {
      const message = captureFailure({ error, ApiError });
      setState(error instanceof ApiError && error.status === 400 ? { kind: "error", message } : { ...state, pending: false, error: message });
    }
  }, [canClear, clear, state, ApiError, onCleared]);
  const cancel = useCallback(() => setState({ kind: "idle" }), []);
  return { canClear, state, start, confirm, cancel };
}

/**
 * @param required.api - the Email API port; a fake in tests.
 * @param required.ApiError - the host's transport error class (`message`, `status`; 403 reads as forbidden).
 * @param required.useLoadHook - the host's one-shot loader (`useLoad`), used for the feedback setup.
 * @param required.useCaptureClearFlowHook - the host's clear-test-emails flow (`useCaptureClearFlow`).
 * @param optional.debounceMs - text-filter settle time; 0 in tests.
 * @param optional.permissions - the session's effective permissions; "Clear test emails" shows only with `mail.capture.clear`.
 */
export function useEmailActivity(
  required: {
    api: Pick<EmailApi, "listActivity" | "getActivity" | "listSuppressions" | "removeSuppression" | "readFeedback" | "clearCaptured">; ApiError: EmailLoadApiError;
    useLoadHook: typeof useLoad; useCaptureClearFlowHook: typeof useCaptureClearFlow;
  },
  optional: { debounceMs?: number; permissions?: readonly string[] | undefined } = {},
): EmailActivityController {
  const { api, ApiError, useLoadHook, useCaptureClearFlowHook } = required;
  const debounceMs = optional.debounceMs ?? 350;
  const [filter, setFilter] = useState<MailActivityFilter>({});
  const recipient = useDebounced({ value: filter.recipient?.trim() ?? "", ms: debounceMs });
  const outcome = filter.outcome;
  const fetchActivity = useCallback((cursor?: string) => api.listActivity({ filter: { outcome, recipient: recipient || undefined }, ...(cursor ? { cursor } : {}) }), [api, outcome, recipient]);
  const activity = usePaged({ fetchPage: fetchActivity, ApiError, useLoadHook });

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LoadView<MailActivityDetail> | null>(null);
  const detailFor = useRef<string | null>(null);
  const toggleDetail = useCallback((id: string) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail({ kind: "loading" });
    detailFor.current = id;
    api.getActivity({ id }).then(
      (data) => { if (detailFor.current === id) setDetail({ kind: "loaded", data }); },
      (error: unknown) => { if (detailFor.current === id) setDetail(isForbidden({ error, ApiError }) ? { kind: "forbidden" } : { kind: "error", message: errorMessage({ error, ApiError }) }); },
    );
  }, [api, openId]);

  const [search, setSearch] = useState("");
  const settledSearch = useDebounced({ value: search.trim(), ms: debounceMs });
  const fetchSuppressions = useCallback((cursor?: string) => api.listSuppressions({ search: settledSearch || undefined, ...(cursor ? { cursor } : {}) }), [api, settledSearch]);
  const suppressions = usePaged({ fetchPage: fetchSuppressions, ApiError, useLoadHook });

  const { removal, startRemoval, setRemovalReason, continueRemoval, cancelRemoval, removedNotice } = useRemovalFlow({ api, reloadSuppressions: suppressions.reload, ApiError });

  const { view: feedback } = useLoadHook({ ApiError, load: useCallback(() => api.readFeedback(), [api]) });
  const capture = useCaptureClearFlowHook({ api, permissions: optional.permissions, ApiError }, { onCleared: activity.reload });

  return useMemo(() => ({
    filter, setFilter, activity, openId, detail, toggleDetail, search, setSearch, suppressions,
    removal, startRemoval, setRemovalReason, continueRemoval, cancelRemoval, removedNotice, feedback, capture,
  }), [filter, activity, openId, detail, toggleDetail, search, suppressions, removal, startRemoval, setRemovalReason, continueRemoval, cancelRemoval, removedNotice, feedback, capture]);
}
