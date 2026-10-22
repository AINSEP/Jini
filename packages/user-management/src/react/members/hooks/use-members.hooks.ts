import type { IdentityRefreshPort } from "../../ports.js";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { AdminMember } from "../../models.js";
import { describeApiError, emptyRowState, type RowActionState } from "../rules.js";
import { useCachedLoader, useFetchMutation, useFetchQuery, useInvalidate } from "@jini-ai/ui/fetch-query";
import type { MembersPort } from "../../ports.js";
import type { Translate } from "@jini-ai/ui/panel-kit";

/**
 * @file Everything the Members screen does, so `Members.tsx` is only markup.
 *
 * Extracted verbatim — same state, same declaration order, same effect bodies, same error strings.
 * `RowActionState`/`emptyRowState`/`describeApiError` moved to `rules.ts` (they were already
 * module-scope free functions in the original, just private and untested); this hook imports them
 * back for `stateFor` and its own async handlers.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts` and `posts/hooks/use-posts.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/members` needs it.
 *
 * `deps.port` is injected (see `members-port.hooks.ts`) rather than reaching for `lib/api`'s `api`
 * directly — the same `useX(dependencies)` / `useWiredX()` split `redirects`/`widgets`/`plugins` use.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import): this hook already called
 * `useAdminLocale()` for its own error-string translations, so exposing that SAME already-resolved
 * `locale` as a bound `t` (plus the raw value, still needed for `rules.ts`'s `memberRowMenuItems`,
 * which takes `locale` directly) on the return value adds no new fetch — `Members.tsx` used to call
 * `useAdminLocale()` a second time and rebuild its own `translateMembers(locale, key)` closure,
 * entirely redundant with the resolution this hook was already doing internally.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass — see that hook's own header):
 * `load` is pulled into a `useCallback` so it can also be handed to that hook, which re-runs it
 * whenever `members_disable` (the host member tool contributor) changes a
 * member's status from an assistant run this screen otherwise has no way to learn about. No draft
 * to protect — every row's own edit state is per-action busy/error tracking, not typed text.
 */

export interface MembersDependencies {
  port: MembersPort;
  /** Same session/workspace scope as Users; isolated providers retain legacy composition. */
  queryScope?: string;
  translate: Translate;
}

export interface MembersController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  members: AdminMember[] | null;
  error: string | null;

  /** Per-row action state (Disable/Resend in-flight, error, notice), falling back to the empty
   *  state for a row with no action taken yet. */
  stateFor: (required: { id: string }) => RowActionState;
  onResendSignInLink: (member: AdminMember) => Promise<void>;

  /** The row whose detail panel is expanded — `null` when every row is collapsed. */
  expandedId: string | null;
  /** Detail already fetched for an expanded row, keyed by member id — a cache so re-expanding a
   *  row already visited this session doesn't re-fetch. */
  detailById: Record<string, AdminMember>;
  detailError: string | null;
  detailLoadingId: string | null;
  onToggleDetail: (member: AdminMember) => Promise<void>;

  /** The member a `RowMenu` "Disable" selection is asking to confirm; `null` when the dialog is
   *  shut. `ConfirmDialog` stays mounted unconditionally in the view (see its own doc comment on
   *  why); this is what drives its `open` prop. */
  confirmingDisable: AdminMember | null;
  setConfirmingDisable: Dispatch<SetStateAction<AdminMember | null>>;
  confirmDisable: () => Promise<void>;

  /** Bound translator — `key` already resolved against the caller's locale, so `Members.tsx` never
   *  imports `useAdminLocale`/`members-i18n` itself. See this file's header. */
  t: Translate;
  /** Raw resolved locale — `rules.ts`'s `memberRowMenuItems` takes `locale` directly rather than a
   *  bound translator. See this file's header. */
  translate: Translate;
}

export interface MembersOptions { refresh?: IdentityRefreshPort | undefined }

/**
 * The spinner row for the detail panel: the expanded row while its keyed observer is still
 * fetching with nothing cached, `null` otherwise. Pure so `useMembers` stays a flat wiring list.
 */
function detailLoadingIdFor(
  { expandedId, detail }: { expandedId: string | null; detail: { data?: unknown; isFetching: boolean } },
): string | null {
  return expandedId !== null && !detail.data && detail.isFetching ? expandedId : null;
}

export function useMembers({ port, translate, queryScope = "members" }: MembersDependencies, { refresh }: MembersOptions = {}): MembersController {
  const scopeRef = useRef(queryScope); scopeRef.current = queryScope;
  const describeError = (error: unknown, fallback: string) => describeApiError({ error, fallback, translate });
  /** `null` when there is nothing to describe, so each derived error string stays one line. */
  const describeIfError = (error: unknown, fallback: string) => (error ? describeError(error, fallback) : null);
  const listKey = [queryScope, 'members', 'list'] as const;
  const detailRoot = [queryScope, 'members', 'detail'] as const;
  const invalidate = useInvalidate();
  // One request description shared by the observer and the imperative loader, so both read the
  // same key through the same fetch.
  const listRequest = { key: listKey, fetch: () => port.listMembers({}) };
  // Mount reads and assistant refreshes can overlap; the shared cache owns list settlement
  // order so a slow earlier success or failure cannot replace a newer roster.
  const list = useFetchQuery(listRequest);
  const members = list.data?.members ?? null;
  const error = describeIfError(list.error, translate("failed to load members"));
  const listLoader = useCachedLoader(listRequest, { staleTime: 0 });
  const disable = useFetchMutation({ run: ({ input: id }: { input: string }) => port.disableMember({ id }) }, { invalidates: [listKey, detailRoot] });
  // Sending a link changes no list/detail fields; do not refetch the roster on success.
  const resend = useFetchMutation({ run: ({ input: email }: { input: string }) => port.requestMemberMagicLink({ email }) });
  const [rowState, setRowState] = useState<Record<string, RowActionState>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, AdminMember>>({});


  // Disable now confirms via a `RowMenu` item -> `ConfirmDialog` modal (replacing the in-place
  // two-click `ConfirmButton`, which has no menu-item equivalent — same migration Posts.tsx/
  // Redirects.tsx/Users.tsx already made). `null` when the dialog is closed.
  const [confirmingDisable, setConfirmingDisable] = useState<AdminMember | null>(null);
  // Which row's detail panel is actually open (C7, plan-access.md §8, N2) — a ref, not just
  // expandedId state, because onToggleDetail reads it after await, when a closure can be stale.
  // Expanding slow/failing A then B must not let A's failure or finally blank B's panel/spinner.
  const expandedIdRef = useRef<string | null>(null);
  const detailGenerations = useRef<Record<string, number>>({});
  const [detailGeneration, setDetailGeneration] = useState(0);
  // Entity keys own settlement: a late A response cannot paint B's error/spinner. Detail
  // data remains cached on collapse, while successful disables invalidate both resources.
  const detailRequest = { key: [...detailRoot, expandedId ?? '', detailGeneration], fetch: () => port.getMember({ id: expandedId! }) };
  const detail = useFetchQuery(detailRequest, { enabled: expandedId !== null, staleTime: Infinity });
  const detailLoader = useCachedLoader(detailRequest, { staleTime: Infinity });
  useEffect(() => {
    expandedIdRef.current = null;
    detailGenerations.current = {};
    setExpandedId(null);
    setDetailGeneration(0);
    setDetailById({});
    setRowState({});
    setConfirmingDisable(null);
  }, [queryScope]);
  // Only paint the failure onto the panel that is still expanded: the observer's entity key
  // selects the current row, so a late rejection for a collapsed row cannot surface here.
  const detailError = describeIfError(detail.error, translate("Failed to load member detail."));
  // A superseded load leaves the spinner to its successor. Derive it from the current keyed
  // observer instead of letting an old request's finally clear the new row's loading state.
  const detailLoadingId = detailLoadingIdFor({ expandedId, detail });
  useEffect(() => {
    if (expandedId && detail.data) setDetailById(current => ({ ...current, [expandedId]: detail.data!.member }));
  }, [expandedId, detail.data]);
  useEffect(() => refresh?.subscribe({ onRefresh: () => {
    invalidate({ key: listKey });
    invalidate({ key: detailRoot });
  } }), [refresh, invalidate, queryScope]);

  function stateFor({ id }: { id: string }): RowActionState {
    return rowState[id] ?? emptyRowState({});
  }

  function patchRowState(id: string, patch: Partial<RowActionState>) {
    setRowState((current) => ({ ...current, [id]: { ...emptyRowState({}), ...current[id], ...patch } }));
  }

  async function onDisable(member: AdminMember) {
    if (stateFor({ id: member.id }).disabling) return;
    patchRowState(member.id, { disabling: true, error: null, notice: null });
    try {
      const result = await disable.mutate({ input: member.id });
      await listLoader.load().catch(() => {}); // Await roster settlement; list.error owns a failed read, not the accepted disable.
      setDetailById(current => current[member.id] ? { ...current, [member.id]: result.member } : current);
      patchRowState(member.id, { disabling: false, notice: translate("Member disabled.") });
    } catch (e) {
      patchRowState(member.id, { disabling: false, error: describeError(e, translate("Failed to disable member.")) });
    }
  }

  async function onResendSignInLink(member: AdminMember) {
    if (stateFor({ id: member.id }).resending) return;
    patchRowState(member.id, { resending: true, error: null, notice: null });
    try {
      await resend.mutate({ input: member.email });
      patchRowState(member.id, { resending: false, notice: translate("Sign-in link sent.") });
    } catch (e) {
      patchRowState(member.id, { resending: false, error: describeError(e, translate("Failed to send sign-in link.")) });
    }
  }

  /** Confirms the Disable that `RowMenu`'s "Disable" item asked about. Closes the dialog either
   *  way (matching Posts.tsx/Redirects.tsx/Users.tsx's own Disable/Delete `ConfirmDialog`
   *  convention) — a failure surfaces via the row's own `rs.error`, not by leaving the modal open. */
  async function confirmDisable() {
    if (!confirmingDisable) return;
    await onDisable(confirmingDisable);
    setConfirmingDisable(null);
  }

  async function onToggleDetail(member: AdminMember) {
    if (expandedIdRef.current === member.id) {
      expandedIdRef.current = null;
      setExpandedId(null);
      return;
    }
    expandedIdRef.current = member.id;
    setExpandedId(member.id);
    // A collapsed unfinished request cannot own a reopened panel. A primitive generation
    // creates a new read fence for that member, preserving the prior latest-wins contract;
    // successful details keep their current generation so reopen reuses the cache.
    // Claimed before await: even two loads of the SAME row must be distinguishable, since a
    // row-id key alone cannot fence an unfinished request after collapse/reopen.
    const generation = detailById[member.id] ? detailGenerations.current[member.id] ?? 1 : (detailGenerations.current[member.id] ?? 0) + 1;
    detailGenerations.current[member.id] = generation;
    setDetailGeneration(generation);
    // Start through the same cache synchronously so imperative callers still await the
    // detail read; the reactive observer joins it when React commits the selected identity.
    const requestedScope = queryScope;
    try {
      const result = await detailLoader.load({ key: [...detailRoot, member.id, generation], fetch: () => port.getMember({ id: member.id }) });
      if (scopeRef.current === requestedScope && detailGenerations.current[member.id] === generation) setDetailById(current => ({ ...current, [member.id]: result.member }));
    } catch { /* The keyed observer owns the failure for the panel that is still expanded. */ }
  }

  return {
    members,
    error,

    stateFor,
    onResendSignInLink,

    expandedId,
    detailById,
    detailError,
    detailLoadingId,
    onToggleDetail,

    confirmingDisable,
    setConfirmingDisable,
    confirmDisable,

    t: translate,
    translate,
  };
}
