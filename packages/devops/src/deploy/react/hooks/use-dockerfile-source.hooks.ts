import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { FetchQueryAdapter, MutationResult } from "@jini-ai/core/fetch";
import type { DockerfileSourceSnapshot } from "../../site/dockerfile.js";
import { type Translate } from '@jini-ai/core/text';

/**
 * @file Everything the Dockerfile tab does — load, edit, save, and the copy-to-clipboard
 * interaction — so `DockerfileTab.tsx` is only markup.
 *
 * ## 2026-08-15 — the tab gained a write half
 *
 * The backend (`PUT .../system/dockerfile`, `api.setDockerfileSource`,
 * `features/deployments/dockerfile.ts`'s `writeDockerfileSource`) landed the same day as this
 * change and was already wired through `dockerfile-source-port.hooks.ts` (in `@jini-ai/admin`)/
 * `dockerfile-source-dependencies.hooks.ts` before this hook touched it — see those files' own
 * headers. `DockerfileTab.tsx`'s OWN header used to claim "there is no write route" as the reason
 * this tab was read-only; that had gone stale (the write route existed, the frontend just hadn't
 * been wired to it yet) and is corrected as part of this pass, not left standing.
 *
 * `snapshot`/`draft` are deliberately two different pieces of state, not one: `snapshot` is the
 * last value this hook knows the SERVER holds (from the initial load, or echoed back by a
 * successful save); `draft` is the operator's live edit buffer, seeded from `snapshot` once and
 * otherwise touched only by `setDraft`/a successful `save()`. Same split `Jini forms/react/hooks/use-form-editor.hooks.ts`
 * draws between `list.data` and `form`/`name`/`slug`/etc., and for the identical reason: an
 * in-progress edit must survive a background refresh of the same query key without being clobbered
 * (see `seededRef` below).
 *
 * `save()` calls `setDockerfileSource` through `useFetchMutation` with NO `invalidates` — there is
 * no sibling list resource for a single repo-root file, and the mutation's own response is a fresher
 * answer than a redundant re-`GET` of the same key would be. `snapshot`/`draft` are set directly
 * from that response instead, mirroring `Jini forms/react/hooks/use-form-editor.hooks.ts`'s `handleSave` (which invalidates
 * only the sibling `KEYS.list`, never its own `KEYS.form(id)` read) and
 * `use-widget-region-editor.hooks.ts`'s `save()` (though that one DOES re-`load()`, for a reason
 * that does not apply here — it reconciles a version counter for OTHER placements that may have
 * changed shape; a Dockerfile write has no analogous server-side transform to reconcile).
 *
 * ## 2026-08-15 — optimistic concurrency (Terra audit finding C5)
 *
 * `snapshot.etag` (from `AdminDockerfileSource.etag`, itself read off the server's `ETag` response
 * header — see that field's own doc in `lib/api.ts`) is sent as `save()`'s `ifMatch`, so a save that
 * is based on stale contents — e.g. the AI assistant's own `deployment_set_dockerfile` tool saved a
 * different version in between this hook's last load and this `save()` call — is refused by the
 * server (`412`) instead of silently overwriting it. On that refusal, {@link save} does the opposite
 * of every other failure path here: it does NOT let the generic `saveError` machinery describe it,
 * and it does NOT touch `draft` at all. Instead it populates {@link saveConflict} with the real
 * current contents the `412` response carried, so `DockerfileTab.tsx` can show them next to the
 * operator's own untouched `draft` for a side-by-side comparison — "a generic save error" is
 * explicitly the thing this is not (the brief for this change named that distinction directly).
 * {@link reloadAfterConflict} is the operator's way out: a fresh `GET`, replacing `snapshot` (and
 * therefore the etag the NEXT `save()` will use) with the server's current state, while still
 * leaving `draft` alone — the operator reconciles their own edit by hand against what
 * {@link saveConflict} showed them, then saves again.
 */

export interface DockerfileSourceController {
  /** The last value this hook knows the server holds — `undefined` until the first successful
   *  load. Distinct from {@link draft}: see this file's header for why the split exists. */
  snapshot: DockerfileSourceSnapshot | undefined;
  /** The editable buffer `DockerfileTab.tsx`'s textarea is bound to. Seeded from `snapshot` once
   *  it first loads (or once a save creates it, for the "no Dockerfile yet" case), and otherwise
   *  driven entirely by {@link setDraft} and a successful {@link save}. */
  draft: string;
  setDraft: (value: string) => void;
  /** Whether `draft` differs from `snapshot`'s own contents — drives the "Unsaved changes" pill
   *  and, via `useDirtyGuard`, a native `beforeunload` prompt against losing an un-saved edit by
   *  closing or reloading the tab. Always `false` before `snapshot` has loaded. */
  isDirty: boolean;
  /** Already-formatted, translated LOAD error — `null` while loading or once loaded successfully.
   *  Distinct from {@link saveError}: a failed load and a failed save are different failures that
   *  can both be true at once (load succeeded earlier, THIS save attempt just failed). */
  error: string | null;
  /** True while a `save()` call is in flight. */
  saving: boolean;
  /** Already-formatted, translated SAVE error from the most recent {@link save} call — `null` until
   *  a save fails, and reset to `null` at the start of every new attempt. A `412` conflict does NOT
   *  populate this — see {@link saveConflict} instead, and this file's header for why the two are
   *  kept deliberately distinct. */
  saveError: string | null;
  /** Set only when the most recent {@link save} was refused with a `412` conflict — the real current
   *  `{exists, contents}` the server reported at that moment, for `DockerfileTab.tsx` to show next to
   *  the operator's own {@link draft} so they can reconcile by hand. `null` otherwise, and reset to
   *  `null` at the start of every new {@link save} attempt (a fresh attempt deserves a fresh
   *  judgment, not a stale conflict banner left over from a previous one) and by
   *  {@link reloadAfterConflict}. */
  saveConflict: { exists: boolean; contents: string | null } | null;
  /** Recovery action for a {@link saveConflict}: re-reads the Dockerfile from the server, replacing
   *  {@link snapshot} (and therefore the etag the next {@link save} call will use) with the fresh
   *  result, and clears {@link saveConflict}. Deliberately does NOT touch {@link draft} — the
   *  operator's in-progress edit survives so they can reconcile it by hand against what
   *  {@link saveConflict} just showed them before saving again. Resolves either way; a failed reload
   *  simply leaves {@link saveConflict} exactly as it was (nothing new to surface — the operator can
   *  still read the conflict's own contents and retry this action). */
  reloadAfterConflict: () => Promise<void>;
  /** True for a short window right after a successful {@link save} — drives a transient "Saved"
   *  confirmation next to the Save button, on the theory that "the Unsaved-changes pill went away"
   *  is not, by itself, an obviously-noticed success signal. Same `setTimeout(..., 1500)` reset
   *  idiom as {@link copied}. */
  saved: boolean;
  /** True for a short window right after a successful {@link copy} — drives the button's
   *  "Copied!" label. Mirrors `copyHash`'s `setTimeout(..., 1500)` reset in
   *  `use-edit-media-panel.hooks.ts`. */
  copied: boolean;
  /** Writes {@link draft} (not `snapshot` — the operator's current edit, which is what's actually
   *  on screen) to the clipboard, if there's anything to write. Swallows a denied clipboard
   *  permission the same way `copyHash`/`copyUrl` do. */
  copy: () => Promise<void>;
  /** Persists {@link draft} via `PUT .../system/dockerfile` (with `snapshot`'s etag as `ifMatch`),
   *  creating the file if it didn't exist yet. Resolves either way — a failure surfaces through
   *  {@link saveError} for an ordinary failure, or {@link saveConflict} for a `412` — never a thrown
   *  rejection, so callers don't need a try/catch of their own. */
  save: () => Promise<void>;
  /** Bound translator — see this file's header. */
  t: Translate;
}

/** Loads the file once and seeds the editable draft from it; later refetches never clobber an unsaved edit. */
function useDockerfileDraft({ port, locale, useFetchQueryHook, describeFailure }: Pick<Parameters<typeof useDockerfileSource>[0], "port" | "locale" | "useFetchQueryHook" | "describeFailure">) {
  const query = useFetchQueryHook({
    key: ["deployment", "dockerfile"],
    fetch: () => port.getDockerfileSource(),
  });
  const [snapshot, setSnapshot] = useState<DockerfileSourceSnapshot | undefined>(undefined);
  const [draft, setDraft] = useState("");

  // Seeds `snapshot`/`draft` from the query's first successful load, exactly once — a LATER
  // background refetch of the same `["deployment", "dockerfile"]` key (the 10s `staleTime` window,
  // or a remount) must not clobber an in-progress, unsaved edit. Same guard shape
  // `Jini forms/react/hooks/use-form-editor.hooks.ts`'s `seededFormIdRef` uses; a plain boolean here rather than an
  // identity comparison because this key has no id to key off — it names one fixed file.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || query.status === "loading" || !query.data) return;
    seededRef.current = true;
    setSnapshot(query.data);
    setDraft(query.data.contents ?? "");
  }, [query.status, query.data]);

  const error = query.error
    ? describeFailure({ error: query.error, locale, operation: "load" })
    : null;

  return { snapshot, setSnapshot, draft, setDraft, error };
}

/** The "Copied!" confirmation window and the clipboard write of the current draft. */
function useDockerfileCopy({ draft, writeClipboard }: { draft: string; writeClipboard: Parameters<typeof useDockerfileSource>[0]["writeClipboard"] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!draft) return;
    try {
      await writeClipboard({ contents: draft });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) — see this file's header.
    }
  }

  return { copied, copy };
}

type DockerfileDraft = ReturnType<typeof useDockerfileDraft>;

async function saveDockerfile({ snapshot, draft, savingRef, setSaveConflict, saveMutation, setSnapshot, setDraft, setSaved, readSaveConflict }: {
  snapshot: DockerfileSourceSnapshot | undefined;
  draft: string;
  savingRef: { current: boolean };
  setSaveConflict: Dispatch<SetStateAction<{ exists: boolean; contents: string | null } | null>>;
  saveMutation: MutationResult<{ contents: string; ifMatch: string }, DockerfileSourceSnapshot>;
  setSnapshot: DockerfileDraft["setSnapshot"];
  setDraft: DockerfileDraft["setDraft"];
  setSaved: Dispatch<SetStateAction<boolean>>;
  readSaveConflict: Parameters<typeof useDockerfileSource>[0]["readSaveConflict"];
}) {
    // No etag to compare `ifMatch` against before the initial load has resolved — unreachable via
    // the UI anyway (`DockerfileTab.tsx` shows "Loading…" and renders no Save button while
    // `!snapshot`), but a direct caller (a test, or a future caller) gets a clean no-op instead of
    // sending a request the server would refuse for a reason that has nothing to do with THIS call.
    if (!snapshot) return;
    // A second call while the first is still in flight is a duplicate submit — ignore it here too,
    // not just via the UI's `saving`-gated disabled Save button, so the race can't still send two
    // PUTs (C4 fix; see `savingRef`'s own doc above for why this check must be synchronous).
    if (savingRef.current) return;
    savingRef.current = true;
    // A fresh attempt deserves a fresh judgment, not a conflict banner left over from a previous
    // one — see this file's header.
    setSaveConflict(null);
    const sent = draft;
    try {
      const updated = await saveMutation.mutate({ input: { contents: sent, ifMatch: snapshot.etag } });
      setSnapshot(updated);
      // The response describes what was SENT. An edit typed while the PUT was in flight is newer than
      // both, so the buffer adopts the server's copy only if it still holds exactly what was sent
      // (terra review 2026-09-20, finding 4) — otherwise it stays, dirty against the new snapshot.
      setDraft((current) => (current === sent ? (updated.contents ?? "") : current));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      const conflict = readSaveConflict({ error: err });
      if (conflict !== null) {
        setSaveConflict(conflict);
        // A conflict is deliberately NOT a generic save error (see this file's header) — `reset()`
        // clears the mutation's own error state so the `saveError` derivation below reports `null`
        // on the next render instead of describing this same rejection a second, blander way.
        saveMutation.reset();
        return;
      }
      // any other failure: already surfaced through saveMutation.error -> saveError below
    } finally {
      // Unconditional and in `finally` specifically — every branch above (success, conflict,
      // ordinary failure) must release this guard, or one failed save would permanently wedge
      // every future Save click into a silent no-op with no error surfaced anywhere.
      savingRef.current = false;
    }
  }

/** Saving with an `If-Match` etag: duplicate-submit guard, 412 conflict capture and the transient "Saved" flag. */
function useDockerfileSave({ port, locale, source, useFetchMutationHook, readSaveConflict, describeFailure }: Pick<Parameters<typeof useDockerfileSource>[0], "port" | "locale" | "useFetchMutationHook" | "readSaveConflict" | "describeFailure"> & { source: DockerfileDraft }) {
  const { snapshot, setSnapshot, draft, setDraft } = source;
  const [saved, setSaved] = useState(false);
  const [saveConflict, setSaveConflict] = useState<{ exists: boolean; contents: string | null } | null>(null);

  // No `invalidates` — see this file's header for why a redundant re-`GET` of this hook's own read
  // key would be strictly worse than the response already in hand.
  const saveMutation = useFetchMutationHook({
    run: ({ input }: { input: { contents: string; ifMatch: string } }) => port.setDockerfileSource(input),
  });

  // Synchronous duplicate-submit guard for `save()` — a ref, not the `saving` (state) value below,
  // because a true double-click/double-Enter can fire two `save()` calls in the same synchronous
  // tick, before React has re-rendered with `saving: true`. `saving` (derived from
  // `saveMutation.status`) still exists to let the UI disable the Save button, but the guard that
  // actually stops a second PUT from ever being sent has to be synchronous — same shape and same
  // reasoning as `use-static-publish.hooks.ts`'s own `publishingRef` (C4 fix, fixed the same night).
  // Without this, two rapid Saves could both read the SAME `snapshot.etag` as `ifMatch` (neither has
  // committed yet), send two writes, and let the second one's `412` come back for a save the
  // operator never actually made twice on purpose — a self-inflicted version of the exact race this
  // whole change exists to close.
  const savingRef = useRef(false);

  function save() {
    return saveDockerfile({ snapshot, draft, savingRef, setSaveConflict, saveMutation, setSnapshot, setDraft, setSaved, readSaveConflict });
  }

  const saveError = saveMutation.error
    ? describeFailure({ error: saveMutation.error, locale, operation: "save" })
    : null;

  async function reloadAfterConflict() {
    try {
      const fresh = await port.getDockerfileSource();
      setSnapshot(fresh);
      setSaveConflict(null);
      // `draft` is deliberately left untouched here — see this file's header for why: the
      // operator's in-progress edit must survive so they can reconcile it by hand against what
      // `saveConflict` just showed them, then save again.
    } catch {
      // A failed reload leaves `saveConflict` exactly as it was — the operator can still read the
      // conflict's own contents and retry this action; nothing new needs surfacing here.
    }
  }

  return { saving: saveMutation.status === "pending", saveError, saveConflict, reloadAfterConflict, saved, save };
}

export function useDockerfileSource(
  { port, t, locale, useFetchQueryHook, useFetchMutationHook, useDirtyGuardHook, readSaveConflict, describeFailure, writeClipboard }: {
    port: { getDockerfileSource(): Promise<DockerfileSourceSnapshot>; setDockerfileSource(required: { contents: string; ifMatch: string }, optional?: Record<string, never>): Promise<DockerfileSourceSnapshot> };
    t: Translate; locale: string;
    useFetchQueryHook: FetchQueryAdapter["useFetchQuery"];
    useFetchMutationHook: FetchQueryAdapter["useFetchMutation"];
    useDirtyGuardHook(required: { current: string; original: string | null }): { isDirty: boolean };
    readSaveConflict(required: { error: unknown }): { exists: boolean; contents: string | null } | null;
    describeFailure(required: { error: unknown; locale: string; operation: "load" | "save" }): string;
    writeClipboard(required: { contents: string }): Promise<void>;
  },
  _options = {},
): DockerfileSourceController {
  const source = useDockerfileDraft({ port, locale, useFetchQueryHook, describeFailure });
  const { snapshot, draft, setDraft, error } = source;
  // No `translate`: this hook reads only `isDirty`, never the guard's translated leave-confirm, so
  // the identity translator it used to pass was never called (and equals the guard's own default).
  const { isDirty } = useDirtyGuardHook({ current: draft, original: snapshot ? (snapshot.contents ?? "") : null });

  const { copied, copy } = useDockerfileCopy({ draft, writeClipboard });
  const save = useDockerfileSave({ port, locale, source, useFetchMutationHook, readSaveConflict, describeFailure });

  return {
    snapshot,
    draft,
    setDraft,
    isDirty,
    error,
    ...save,
    copied,
    copy,
    t,
  };
}

