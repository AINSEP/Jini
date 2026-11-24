import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EmailApi, MailActivityDetail, MailActivityFilter, MailActivityPage, MailSuppressionEntry, MailSuppressionRemovalPlan } from "../email-api.types.js";
import type { MailFeedbackSetupReport } from "@jini-ai/core/contracts/site/platform-mail";
import { errorMessage, isForbidden, useLoad, type LoadView, type EmailLoadApiError } from "./email-load.hooks.js";

/**
 * @file Activity tab state: recent sends (`GET …/mail-activity`, filters + cursor paging + one
 * send's feedback timeline), blocked addresses (`GET …/mail-suppressions`) and feedback setup
 * (`GET …/mail-feedback`).
 *
 * Removing a block is the server's two-step contract (`POST …/mail-suppressions/remove`): first
 * WITHOUT `confirmed` to get the plan (what was blocked, why, the warnings), then again with
 * `confirmed: true` and that plan's `revision`. The person must give a reason; the server records
 * it and refuses without one, and refuses anyone without `mail.suppressions.manage` (owner).
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
}

const MIN_REASON = 3;

type Page<T> = { items: T[]; nextCursor: string | null; empty: "none_recorded" | "no_matches" | null; access?: "full" | "masked" };

/** One paged read keyed on `fetchPage`'s identity: a new identity (new filter) starts over. */
function usePaged<T>(required: { fetchPage: (cursor?: string) => Promise<Page<T>>; ApiError: EmailLoadApiError }): PagedList<T> {
  const { fetchPage, ApiError } = required;
  const { view, reload, setData } = useLoad({ ApiError, load: useCallback(() => fetchPage(), [fetchPage]) });
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

/**
 * @param required.api - the Email API port; a fake in tests.
 * @param required.ApiError - the host's transport error class (`message`, `status`; 403 reads as forbidden).
 * @param optional.debounceMs - text-filter settle time; 0 in tests.
 */
export function useEmailActivity(
  required: { api: Pick<EmailApi, "listActivity" | "getActivity" | "listSuppressions" | "removeSuppression" | "readFeedback">; ApiError: EmailLoadApiError },
  optional: { debounceMs?: number } = {},
): EmailActivityController {
  const { api, ApiError } = required;
  const debounceMs = optional.debounceMs ?? 350;
  const [filter, setFilter] = useState<MailActivityFilter>({});
  const recipient = useDebounced({ value: filter.recipient?.trim() ?? "", ms: debounceMs });
  const outcome = filter.outcome;
  const fetchActivity = useCallback((cursor?: string) => api.listActivity({ filter: { outcome, recipient: recipient || undefined }, ...(cursor ? { cursor } : {}) }), [api, outcome, recipient]);
  const activity = usePaged({ fetchPage: fetchActivity, ApiError });

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
  const suppressions = usePaged({ fetchPage: fetchSuppressions, ApiError });

  const { removal, startRemoval, setRemovalReason, continueRemoval, cancelRemoval, removedNotice } = useRemovalFlow({ api, reloadSuppressions: suppressions.reload, ApiError });

  const { view: feedback } = useLoad({ ApiError, load: useCallback(() => api.readFeedback(), [api]) });

  return useMemo(() => ({
    filter, setFilter, activity, openId, detail, toggleDetail, search, setSearch, suppressions,
    removal, startRemoval, setRemovalReason, continueRemoval, cancelRemoval, removedNotice, feedback,
  }), [filter, activity, openId, detail, toggleDetail, search, suppressions, removal, startRemoval, setRemovalReason, continueRemoval, cancelRemoval, removedNotice, feedback]);
}
