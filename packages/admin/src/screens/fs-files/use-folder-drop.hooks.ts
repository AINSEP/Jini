import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, MutableRefObject, RefObject } from "react";
import { orFallback } from "@jini-ai/core/errors/idioms";

import { useSerialWrites, useSettlementGeneration } from "../../react/kit.js";
import type { FolderDropPort } from "./folder-drop-port.js";
import {
  confirmationNotice,
  dropHasFolder,
  reasonForCustomRootFailure,
  type CustomRootFailure,
  type FolderDropNotice,
} from "./folder-drop.rules.js";

/**
 * @file SPEC-053: wires a dropped folder in the admin chat composer (`AssistantDock`) to (a) the
 * message's folder chips (owner 11-01: picked/dropped folders are chips, never message text or
 * uploads) and (b) the `fs-files` `custom` root, so the very next `fs_list_files(root:"custom")`
 * call resolves to the dropped folder with no separate manual step (REQ-02). Mirrors
 * `use-composer-voice-input.hooks.ts`'s "component logic belongs in hooks" split:
 * `AssistantDock.tsx` only renders whatever this returns.
 *
 * **Staging always happens; the custom-root set is best-effort on top of it** (`ui.spec.md` §4: a
 * failed custom-root set must never roll back or block the folder already staged). Paths come from
 * `@jini-ai/ui`'s `folderPathsFromDataTransfer` in the capture phase, before the bubble-phase
 * uploader can expand a directory into per-file attachments.
 *
 * **Multiple folders in one drop event.** `feature.spec.md`/`behavior.spec.md` only ever describe
 * SEQUENTIAL drops for the "last write wins" custom-root rule (§1.2) — dropping two folders at once
 * in a single `DragEvent` is not named. Every recovered folder is staged, in drop order. For the
 * SINGLE `custom` root value (INV-02: at most one at a time), this applies the same "most recent
 * wins" rule one level down and uses the LAST folder in that same drop — a judgment call, not a spec
 * requirement, made because no other rule in the approved spec package covers this case and "last"
 * is the only choice consistent with §1.2's own tie-break for the sequential case.
 *
 * **"Last folder wins" now holds across OVERLAPPING drops, not just sequential ones.** Each drop's
 * `applyCustomRoot` call used to run its own independent read-then-write, so a slow read or a slow
 * write for an older drop could resolve after a newer drop and overwrite it — the server, and the
 * notice shown to the operator, could disagree about which drop was actually last (2026-09-20 fix).
 * `applyCustomRoot` now mints a `useSettlementGeneration` generation synchronously, before any
 * `await`, and runs its read/write through a `useSerialWrites` chain that keeps writes in strict
 * drop order. A drop superseded before its own read starts skips the read entirely; one superseded
 * mid-read never issues its write; one superseded mid-write still completes (the in-flight PUT is
 * not cancelled) but its notice — confirmation or error — is suppressed. The newer drop then runs
 * on an uncontested chain and its own confirmation names the older path as replaced.
 *
 * **Reading the previous root before overwriting it** (`applyCustomRoot`'s `getCustomRoot()` call)
 * is purely cosmetic — it only feeds `FolderDropConfirmation`'s `replacedPreviousPath` wording
 * (`ui.spec.md` §2.1). Its failure is swallowed on purpose: REQ-02's actual set call is unaffected
 * either way, so a flaky read never blocks the feature this hook exists to deliver. Because it now
 * runs inside the same generation-guarded chain, `replacedPreviousPath` reflects the root as it
 * stood after the PRIOR drop's write actually settled, not merely whatever was on the server when
 * this drop started.
 */

export interface UseFolderDrop {
  /** The notice to render (`FolderDropConfirmation`/`FolderDropError`), or `null` when neither
   *  should be visible. */
  readonly notice: FolderDropNotice | null;
  /** Dismisses the current notice immediately — `FolderDropConfirmation`/`FolderDropError`'s
   *  `onDismiss`. A no-op when nothing is showing. */
  readonly dismiss: () => void;
  /** Re-attempts the custom-root call for the last path this hook tried — `FolderDropError`'s
   *  `onRetry`. A no-op before any drop has been handled. */
  readonly retry: () => void;
  /** Pass through `AssistantDock`'s imperative handle to the wrapping `<aside onDropCapture={...}>`
   *  in the host app (capture phase, same reasoning as the desktop original: this must see the raw
   *  event before `@jini-ai/chat`'s own bubble-phase drop handling expands a folder into per-leaf
   *  files). A drop with no folder falls through to the ordinary attachment-upload path. A folder
   *  whose path cannot be read (a plain browser tab has no desktop files bridge) is still swallowed —
   *  a folder drop never becomes an upload — and sets the `path-unavailable` notice. Its identity never
   *  changes for the hook's lifetime (the raw-drop path recovery), so `useFolderDropBridge`
   *  publishes it once per mount. */
  readonly handleDropCapture: (event: DragEvent<HTMLElement>) => void;
  /** Handles a folder path that arrived without a drop (the composer's folder button) exactly as a
   *  desktop folder drop: stage the exact path as a folder reference, then set the
   *  `custom` root with the same confirmation/error notice. */
  readonly insertFolderPath: (path: string) => void;
  /** Shows the `path-unavailable` notice (paste the path instead), replacing any other notice. */
  readonly showPathHint: () => void;
}

/** The one member of `@jini-ai/chat`'s `ChatPaneComposerHandle` this hook uses. */
export interface FolderDropComposerHandle {
  addFolders(required: { folders: readonly string[] }, optional?: {}): void;
}

export interface UseFolderDropInput {
  /** Populated by `ChatPane` itself once mounted — the same ref `use-composer-voice-input.hooks.ts`
   *  already inserts a voice transcript through. */
  readonly composerHandle: RefObject<FolderDropComposerHandle | null>;
}

export interface UseFolderDropDeps {
  /** The host's desktop folder-drop port lookup (`getFolderDropPort` with its own bridge key). Called
   *  at render, not at drop; a drop uses the latest committed render's port. */
  readonly getPort: () => FolderDropPort | null;
  /** The host's custom-root write (its admin API PUT). */
  readonly setCustomRoot: (path: string) => Promise<unknown>;
  /** The host's custom-root read (its admin API GET). */
  readonly getCustomRoot: () => Promise<{ readonly path: string | null }>;
  /** `@jini-ai/ui`'s `folderPathsFromDataTransfer`: the absolute folder paths a drop carries. */
  readonly folderPathsFromDataTransfer: (required: { dataTransfer: DataTransfer; port: FolderDropPort }) => readonly string[];
  /** Reads the host's API error off a failed write (`null` when it is not one). */
  readonly readFailure: (error: unknown) => CustomRootFailure;
  /** Milliseconds before a confirmation auto-dismisses. Defaults to `ui.spec.md`'s `4000`. */
  readonly autoDismissMs?: number;
}

const DEFAULT_AUTO_DISMISS_MS = 4000;

/**
 * The custom root in place before this drop, so the confirmation can say what it replaced.
 *
 * @param required.getCustomRoot The fs-files custom-root read.
 * @returns The previous root's path, or `null` when there was none or the read failed.
 * @complexity O(1) plus one request.
 */
async function readPreviousCustomRoot(required: { readonly getCustomRoot: () => Promise<{ readonly path: string | null }> }): Promise<string | null> {
  // Best-effort only — see this module's own doc on why a failed read never blocks REQ-02.
  return orFallback({ work: async () => {
    return (await required.getCustomRoot()).path;
  }, fallback: null, step: "Read previous custom root" });
}

interface NoticeState {
  readonly notice: FolderDropNotice | null;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly showConfirmation: (notice: FolderDropNotice) => void;
  readonly showError: (notice: FolderDropNotice) => void;
  readonly showPathHint: () => void;
  readonly dismiss: () => void;
}

/**
 * The single notice slot, its auto-dismiss timer and the mounted guard every async `setState` checks.
 *
 * @complexity O(1) per call.
 */
function useFolderDropNotice({ autoDismissMs }: { autoDismissMs: number }): NoticeState {
  const [notice, setNotice] = useState<FolderDropNotice | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards every `setState` below against firing after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (dismissTimer.current !== null) clearTimeout(dismissTimer.current);
    };
  }, []);
  const clearTimer = useCallback(() => {
    if (dismissTimer.current !== null) clearTimeout(dismissTimer.current);
  }, []);
  const showConfirmation = useCallback((next: FolderDropNotice) => {
    setNotice(next);
    clearTimer();
    // No mounted check: the only pending timer is `dismissTimer.current` (cleared just above before
    // a new one is set), and the unmount cleanup clears it, so it never fires after unmount.
    dismissTimer.current = setTimeout(() => {
      setNotice(null);
    }, autoDismissMs);
  }, [autoDismissMs, clearTimer]);
  // An error is not auto-dismissed, so an earlier success's pending timer must not wipe it.
  const showError = useCallback((next: FolderDropNotice) => { clearTimer(); setNotice(next); }, [clearTimer]);
  const showPathHint = useCallback(() => { clearTimer(); setNotice({ kind: "path-unavailable" }); }, [clearTimer]);
  const dismiss = useCallback(() => { clearTimer(); setNotice(null); }, [clearTimer]);
  return { notice, mountedRef, showConfirmation, showError, showPathHint, dismiss };
}

type ApplyDeps = Pick<UseFolderDropDeps, "setCustomRoot" | "getCustomRoot" | "readFailure">;

/**
 * The generation-guarded, serialized read-then-write of the custom root, plus `retry` of the last one.
 *
 * @complexity O(1) per call plus one read and one write request, queued behind earlier drops.
 */
function useApplyCustomRoot({ deps, state }: { deps: ApplyDeps; state: NoticeState }) {
  const { setCustomRoot, getCustomRoot, readFailure } = deps;
  const { mountedRef, showConfirmation, showError } = state;
  const lastAttempt = useRef<{ path: string; paths: readonly string[] | undefined } | null>(null);
  // See this file's "Last folder wins now holds across OVERLAPPING drops" doc above. `settlement`
  // tells a superseded drop's read/write/notice apart from the newest one; `writes` keeps every
  // drop's read-then-write in strict drop order so a newer drop's PUT never races an older one's.
  const settlement = useSettlementGeneration();
  const writes = useSerialWrites();
  const applyCustomRoot = useCallback((path: string, paths?: readonly string[]): Promise<void> => {
    lastAttempt.current = { path, paths };
    // Minted HERE, synchronously, before this drop even joins the write chain — not inside the
    // queued task below. Two drops handled in the same tick must each see the other's claim before
    // either one's chained task starts running, so the later drop's mint always outranks the
    // earlier one by the time the chain gets to it.
    const generation = settlement.next();
    return writes.run({ task: async () => {
      // A newer drop was minted behind this one before this task got its turn on the chain — skip
      // the read, the write and the notice entirely; this drop has nothing left to contribute.
      if (!settlement.isCurrent({ generation })) return;
      const previousPath = await readPreviousCustomRoot({ getCustomRoot });
      // A newer drop arrived while this one was reading — never issue this drop's write over it.
      if (!settlement.isCurrent({ generation })) return;
      const settlesHere = () => mountedRef.current && settlement.isCurrent({ generation });
      try {
        await setCustomRoot(path);
        if (settlesHere()) showConfirmation(confirmationNotice({ path, previousPath }, { paths }));
      } catch (err) {
        // The write itself is not cancelled — it already reached the server — but a superseded
        // drop's failure must not replace whatever the newer drop already confirmed.
        if (!settlesHere()) return;
        showError({ kind: "error", path, reason: reasonForCustomRootFailure({ failure: readFailure(err) }) });
      }
    } });
  }, [getCustomRoot, setCustomRoot, readFailure, mountedRef, showConfirmation, showError, settlement, writes]);
  const retry = useCallback(() => {
    const last = lastAttempt.current;
    if (last !== null) void applyCustomRoot(last.path, last.paths);
  }, [applyCustomRoot]);
  return { applyCustomRoot, retry };
}

/**
 * Owns the folder-drop notice state and the composer/custom-root side effects a drop triggers.
 *
 * @complexity Time: O(n) in the number of dragged items per drop (via the injected
 *   `folderPathsFromDataTransfer`); space: O(n) in recovered paths.
 */
export function useFolderDrop(input: UseFolderDropInput, deps: UseFolderDropDeps): UseFolderDrop {
  const { getPort, folderPathsFromDataTransfer } = deps;
  const state = useFolderDropNotice({ autoDismissMs: deps.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS });
  const { applyCustomRoot, retry } = useApplyCustomRoot({ deps, state });
  const { showPathHint } = state;
  // Read at render and dereference on drop so the capture handler stays stable across rerenders.
  const portRef = useRef(getPort());
  portRef.current = getPort();
  const pathsRef = useRef(folderPathsFromDataTransfer);
  pathsRef.current = folderPathsFromDataTransfer;

  const { composerHandle } = input;
  const handleDropCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!dropHasFolder({ dataTransfer: event.dataTransfer })) return;
    // A folder must never fall through to the uploader, which expands it into per-file attachments
    // (owner 2026-10-27: "You can attach at most 10 files to one message"), even with no path to stage.
    event.preventDefault();
    event.stopPropagation();
    const port = portRef.current;
    const paths = port ? pathsRef.current({ dataTransfer: event.dataTransfer, port }) : [];
    if (paths.length === 0) { showPathHint(); return; }
    composerHandle.current?.addFolders({ folders: paths });
    // See this module's own doc ("Multiple folders in one drop event") for why the LAST path wins.
    void applyCustomRoot(paths[paths.length - 1] as string, paths);
  }, [composerHandle, applyCustomRoot, showPathHint]);

  const insertFolderPath = useCallback((path: string) => {
    composerHandle.current?.addFolders({ folders: [path] });
    void applyCustomRoot(path);
  }, [composerHandle, applyCustomRoot]);

  return { notice: state.notice, dismiss: state.dismiss, retry, handleDropCapture, insertFolderPath, showPathHint };
}
