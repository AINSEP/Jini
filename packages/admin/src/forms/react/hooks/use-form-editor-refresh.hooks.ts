import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { createFormEditorController } from "../../controllers/form-editor.controller.js";
import { formDraftIsDirty, formRefreshDecision, type FormRefreshDecision } from "../../form-editor-refresh.js";
import type { AdminFormDefinition } from "../../models.js";
import type { FormsEventsPort } from "../../ports.js";

/**
 * @file Version-aware refresh for the form editor. It replaces the old once-per-`formId` seed. That
 * seed protected in-progress drafts from a background refetch of the same form, but it also
 * meant an outside edit (an assistant changing the form) never reached an open editor, and a later
 * Save silently overwrote it. Now every read is applied by the same apply-or-prompt rule: a
 * clean editor follows a newer read; a dirty one keeps its draft and is offered a reload.
 *
 * Reads are tagged at fetch start with the route and a generation token. The token changes when a
 * route changes (including leaving and returning to the same route key) and when a write begins or
 * settles, so no read observed before or during a write is ever applied. A read dropped while busy
 * is re-read after settlement, never replayed. Write completions are scoped to the route object,
 * so a Save or status change from a previous form never seeds the current one.
 */

type StateController = ReturnType<typeof createFormEditorController> | null;
export interface FormReadTag { readonly formId: string; readonly token: object }
export interface TaggedFormRead { readonly data: AdminFormDefinition; readonly read: FormReadTag }
interface RouteState { readonly formId: string; token: object; writes: number }
export type FormEditorGeneration = ReturnType<typeof useFormEditorGeneration>;

/** Per-route read/write generation, shared by the read, the refresh rule and the write actions.
 * @complexity O(1) per call; no I/O. */
export function useFormEditorGeneration({ formId }: { formId: string }, _optional = {}) {
  const ref = useRef<RouteState>({ formId, token: {}, writes: 0 });
  // Reset during render, before the new key's read can start, so nothing begun for an earlier
  // route (or an earlier visit to this same route) can carry the current route's identity.
  if (ref.current.formId !== formId) ref.current = { formId, token: {}, writes: 0 };
  return useMemo(() => ({
    readTag: (): FormReadTag => ({ formId: ref.current.formId, token: ref.current.token }),
    isCurrentRead: ({ read }: { read: FormReadTag }) => read.token === ref.current.token && read.formId === ref.current.formId,
    busy: () => ref.current.writes > 0,
    beginWrite: (): object => { const route = ref.current; route.writes += 1; route.token = {}; return route; },
    /** False when the route changed since `beginWrite`: that completion belongs to another form. */
    settleWrite: (route: object): boolean => {
      if (route !== ref.current) return false;
      ref.current.writes -= 1; ref.current.token = {};
      return true;
    },
    invalidateReads: (): object => { ref.current.token = {}; return ref.current.token; },
  }), []);
}

export interface FormEditorReload {
  /** An outside change (or a refused stale Save) is waiting; the draft is untouched. */
  available: boolean;
  confirmOpen: boolean;
  pending: boolean;
  request: () => void;
  confirm: () => void;
  cancel: () => void;
}
const IDLE = { available: false, confirmOpen: false, pending: false };
type ReloadState = typeof IDLE;
type ListQuery = { data: TaggedFormRead | undefined; isFetching: boolean; refetch: () => void };
type Refs = { list: { current: ListQuery }; pendingRefresh: { current: boolean }; forceToken: { current: object | null }; sawFetch: { current: boolean } };

/** One read result: drop other routes and stale generations, defer while busy, else apply. */
function consumeRead({ tagged, formId, generation, refs, requestRead, applyIncoming, setReload }: {
  tagged: TaggedFormRead; formId: string; generation: FormEditorGeneration; refs: Refs; requestRead: () => void;
  applyIncoming: (input: { form: AdminFormDefinition; force?: boolean }) => FormRefreshDecision; setReload: (update: (r: ReloadState) => ReloadState) => void;
}) {
  if (tagged.read.formId !== formId) return;
  if (!generation.isCurrentRead(tagged)) { requestRead(); return; }
  if (generation.busy()) { refs.pendingRefresh.current = true; return; }
  const force = refs.forceToken.current === tagged.read.token;
  if (force) { refs.forceToken.current = null; setReload(r => ({ ...r, pending: false })); }
  applyIncoming({ form: tagged.data, force });
}

/** Seeds the section controller from the loaded definition. Apply-or-prompt for every read of
 * `KEYS.form(formId)`, the scoped refresh subscription, and the reload controller slice.
 * @complexity O(f) per applied read; one definition read per refresh request. */
export function useFormEditorRefresh({ stateController, formId, isNew, list, events, generation }: {
  stateController: StateController; formId: string; isNew: boolean; list: ListQuery; events?: FormsEventsPort | undefined; generation: FormEditorGeneration;
}, _optional = {}) {
  const [reload, setReload] = useState<ReloadState>(IDLE);
  const refs: Refs = { list: useRef(list), pendingRefresh: useRef(false), forceToken: useRef<object | null>(null), sawFetch: useRef(false) };
  refs.list.current = list;
  const handledRef = useRef<TaggedFormRead | null>(null);
  const seededRouteRef = useRef<string | null>(null);
  useEffect(() => { setReload(IDLE); refs.pendingRefresh.current = false; refs.forceToken.current = null; }, [formId]);
  const requestRead = useCallback(() => {
    if (generation.busy()) { refs.pendingRefresh.current = true; return; }
    refs.sawFetch.current = false;
    refs.list.current.refetch();
  }, [generation]);
  // Stable callback, so the scoped subscription is made once per events port and cleaned up.
  useEffect(() => (isNew || !events ? undefined : events.subscribe({ onRefresh: requestRead })), [events, isNew, requestRead]);
  const applyIncoming = useCallback(({ form, force = false }: { form: AdminFormDefinition; force?: boolean }): FormRefreshDecision => {
    if (!stateController) return "ignore";
    const state = stateController.getSnapshot();
    // The section controller outlives a route change; another route's applied form is no basis here.
    const applied = seededRouteRef.current === formId ? state.form : null;
    const decision = formRefreshDecision({ applied, incoming: form, dirty: applied !== null && formDraftIsDirty({ state }) }, { force });
    if (decision === "seed") { seededRouteRef.current = formId; stateController.seed({ form }); setReload(IDLE); }
    if (decision === "offer") setReload(r => ({ ...r, available: true }));
    return decision;
  }, [stateController, formId]);
  // Declared before the pending watcher: a confirmed read must be applied before that watcher can
  // mistake its settled fetch for a failure.
  useEffect(() => {
    const tagged = list.data;
    if (!stateController || isNew || !tagged || handledRef.current === tagged) return;
    handledRef.current = tagged;
    consumeRead({ tagged, formId, generation, refs, requestRead, applyIncoming, setReload });
  }, [list.data, stateController, isNew, formId, generation, requestRead, applyIncoming]);
  useEffect(() => {
    if (!reload.pending) { refs.sawFetch.current = false; return; }
    if (list.isFetching) { refs.sawFetch.current = true; return; }
    // The confirmed read settled without an eligible result: keep the draft and the notice.
    if (refs.sawFetch.current && refs.forceToken.current) { refs.forceToken.current = null; setReload(r => ({ ...r, pending: false })); }
  }, [reload.pending, list.isFetching]);
  const confirm = () => {
    // Fresh reads only: anything begun before this confirmation (the conflict's own re-read
    // included) carries an older token and cannot be the result that discards the draft.
    refs.forceToken.current = generation.invalidateReads();
    setReload(r => ({ ...r, confirmOpen: false, pending: true }));
    requestRead();
  };
  const request = () => {
    const state = stateController?.getSnapshot();
    if (state && formDraftIsDirty({ state })) setReload(r => ({ ...r, confirmOpen: true }));
    else confirm();
  };
  return {
    reload: { ...reload, request, confirm, cancel: () => setReload(r => ({ ...r, confirmOpen: false })) } satisfies FormEditorReload,
    applyIncoming,
    /** A typed 409: keep the draft, show the notice, and ask for a fresh read. */
    conflict: () => { setReload(r => ({ ...r, available: true })); requestRead(); },
    /** Re-read once writes settle if a refresh was requested or a read was dropped meanwhile. */
    afterWrite: () => { if (refs.pendingRefresh.current && !generation.busy()) { refs.pendingRefresh.current = false; requestRead(); } },
  };
}
export type FormEditorRefresh = ReturnType<typeof useFormEditorRefresh>;
