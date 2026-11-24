import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

// Barrel import only — `no-deep-imports:platform/site-dir` is `error`-severity
// (`.dependency-cruiser.mjs`'s `PROMOTED_NO_DEEP_IMPORTS`), the same door `layout.ts` already opened
// for `resolveProductRoot` in this same feature. The persistence root is now injected from boot.

/**
 * @file The operator-set custom filesystem root — backs the third {@link FsRootId} `"custom"`
 * (`layout.ts`), holding whatever absolute directory the human operator has pointed the assistant at
 * through the chat composer's folder control (the admin app's `AssistantDock`), independent of the
 * `repo`/`site` roots.
 *
 * ## Path only, nothing read (2026-09-10 owner decision)
 *
 * "when we upload a folder we don't upload everything in the folder, that's disastrous, we are
 * uploading the filepath" — the owner's own words. {@link setCustomFsRoot} captures the path and
 * nothing else: the single `stat`/`realpath` call below confirms the entry's own existence and kind,
 * the same metadata `ls -d` would show, and touches nothing inside it. No file under the folder is
 * read, copied, indexed, or walked at set time, so a 76 GB folder costs exactly what an empty one
 * does until a later `fs_list_files`/`fs_read_file` call names a specific path — and THAT call
 * re-validates containment and the denylist independently of this module ever having been called
 * correctly, identical to how `repo`/`site` are re-checked (see `fs-files.ts`'s header).
 *
 * ## Persisted per workspace, one small JSON file (2026-09-10, follow-up to the slice above)
 *
 * Originally this held a single module-level scalar, forgotten on every process restart — the
 * dev-mode norm here is `tsx-watch` reloading on nearly every save under the host's website source tree, so the
 * operator had to retype the path after almost every edit. This module now persists a
 * `{ [workspaceId]: absolutePath }` map to `<site>/.fs-custom-root.json` (`persistenceFilePath`),
 * next to the site's other small standalone config files (`.site-meta.json`, `config.json`) rather
 * than in `content.db` — no schema, no migration, trivially inspectable, and it stays out of the way
 * of whoever owns `platform/db/**` right now. There is deliberately no in-memory cache: every read
 * (`getCustomFsRoot`/`getCustomFsRootStatus`) goes straight to disk and every write
 * (`setCustomFsRoot`) goes straight back, temp-file-then-rename, so "restart survives" is not a
 * separate code path to get right — it is the ONLY code path, and two processes (or `tsx-watch`
 * reloading mid-request) can never observe a value the file itself doesn't hold.
 *
 * Keyed by `workspaceId` (the same string `FsFilesToolDeps.workspaceId`/`RouteDeps.workspaceId`
 * already carry) because the admin-http route is already workspace-addressed
 * (`/workspaces/:workspaceId/fs-files/custom-root`) — a single scalar shared across every workspace
 * this process might ever serve would be the cruder shape, not the safer one.
 *
 * A path an operator set that no longer stats as a directory (folder moved or deleted since) is
 * reported honestly rather than folded back into "nothing was ever set": see
 * {@link getCustomFsRootStatus}'s `vanished`/`vanishedPath` fields. `getCustomFsRoot` — the plain
 * accessor `layout.ts`'s `resolveFsRoots` calls to actually resolve a usable directory — treats a
 * vanished path the same as an unset one (`undefined`), since either way there is no directory left
 * to read from; only the richer status accessor keeps the distinction, for the admin route to surface
 * to a human. Reading a corrupt or unparseable persistence file degrades to "nothing persisted" rather
 * than throwing, so a hand-edited or truncated `.fs-custom-root.json` can never crash a caller that
 * merely wanted to know the current root — though any other read failure (e.g. `EACCES` on the site
 * directory) still propagates.
 *
 * ## No permission model here, by design
 *
 * Every `fs_list_files`/`fs_read_file` call against the `custom` root passes through the exact same
 * `content.read`-gated `authorize()` check and the same denylist as `repo`/`site` (see
 * `tool-registrations.ts`), and the admin-http route that calls {@link setCustomFsRoot}
 * (the host's custom-root admin route) is gated by that identical permission. Whoever may set this path
 * is already trusted with `content.read`; no separate grant/approval/confirmation ceremony exists for
 * the path itself, and none should be added here — seeding one back in would re-introduce exactly the
 * restrictiveness `layout.ts`'s header records the owner rejecting.
 */

/** Raised when a caller tries to set a path that cannot be an fs-files root — a shape rejection, not
 *  an internal error, so the admin-http route can echo it straight back to the composer UI. */
export class CustomFsRootError extends Error {
  constructor({ message }: { message: string }, _optional = {}) {
    super(message);
    this.name = "CustomFsRootError";
  }
}

const PERSISTENCE_FILE_NAME = ".fs-custom-root.json";

export interface CustomFsRootStoreOptional {
  /** Absolute booted site directory to persist under. Tests MUST override this to a temp directory: there is
   *  deliberately no test-only default, so a forgotten override is a type error rather than a test
   *  that silently reads or writes the real site's `.fs-custom-root.json`. */
  readonly siteDir: string;
}

export interface CustomFsRootState {
  /** The currently usable custom root for this workspace, or `undefined` when either no path has
   *  ever been set, or the one that was set no longer resolves to a directory. */
  readonly path: string | undefined;
  /** `true` only when a path WAS persisted for this workspace but no longer stats as a directory —
   *  lets a caller say "the folder you set is gone" instead of conflating that with "never set". */
  readonly vanished: boolean;
  /** The persisted path that vanished. Present only when `vanished` is `true`. */
  readonly vanishedPath?: string;
}

function persistenceFilePath(optional: CustomFsRootStoreOptional): string {
  return join(optional.siteDir, PERSISTENCE_FILE_NAME);
}

/**
 * Reads the whole `{ [workspaceId]: path }` map from disk. An absent file (nothing ever persisted)
 * and a corrupt/unparseable one are both treated as "empty" — the second so a hand-edited or
 * truncated `.fs-custom-root.json` degrades to "nothing persisted" rather than taking down every
 * caller that only wanted to know the current root. Any other read failure (e.g. `EACCES` on the
 * site directory) propagates, matching the host's active-site `readPersistedActiveSite` discipline of
 * never silently reporting a real I/O failure as "absent".
 *
 * @complexity O(1) — one small file read plus a `JSON.parse` bounded by that same file's size, never
 *   by caller-controlled input.
 */
function readPersistedPaths({ filePath }: { filePath: string }, _optional = {}): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Malformed JSON — return an empty store rather than throwing. This file
    // holds nothing that cannot be re-derived (the operator can just re-set the folder), so refusing
    // every read until a human manually repairs the file would be a worse failure mode.
    return {};
  }
  return {};
}

/**
 * Writes `store` back to `filePath`, atomically: a temp file in the SAME directory (so `renameSync`
 * stays on one filesystem, where POSIX rename is atomic) is written first, then renamed over
 * `filePath` in one step — the same temp-file+rename discipline the host's atomic-write helper uses elsewhere in
 * `platform/site-dir`, reimplemented locally here rather than imported through the barrel: this
 * module's own value (an operator-chosen path, not a secret) has none of `writeFileAtomic`'s
 * mode-preservation concerns, and adding a second barrel export purely for this one caller would
 * widen a shared file two other agents are actively working near for no behavioral gain.
 *
 * @throws whatever the underlying `fs` call throws (e.g. `EACCES` on an unwritable site directory) —
 *   surfaced, never swallowed, so a caller learns immediately that a set/clear did not actually
 *   persist.
 * @complexity O(1) — one small JSON payload, two fs syscalls (write + rename).
 */
function writePersistedPaths({ filePath, store }: { filePath: string; store: Record<string, string> }, _optional = {}): void {
  const tempPath = join(dirname(filePath), `.${PERSISTENCE_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  renameSync(tempPath, filePath);
}

/** Resolves a persisted path (or its absence) to today's on-disk reality. A path that no longer
 *  exists, or that now names something other than a directory, is reported as `vanished` rather than
 *  silently treated as `path`-usable or conflated with "never set". */
function resolveState({ persistedPath }: { persistedPath: string | undefined }, _optional = {}): CustomFsRootState {
  if (persistedPath === undefined) return { path: undefined, vanished: false };
  if (existsSync(persistedPath) && statSync(persistedPath).isDirectory()) {
    return { path: persistedPath, vanished: false };
  }
  return { path: undefined, vanished: true, vanishedPath: persistedPath };
}

/**
 * The full current state of `workspaceId`'s custom root, including whether a previously-set path has
 * since vanished — the admin-http route (the host's custom-root admin route) uses this, rather than
 * {@link getCustomFsRoot}, so the composer can eventually tell an operator "the folder you set is
 * gone" instead of showing the same "no folder set" it would show before anything was ever chosen.
 *
 * @complexity O(1) — one file read plus one `stat` of the persisted path, never proportional to that
 *   directory's own contents.
 */
export function getCustomFsRootStatus({ workspaceId, optional }: { workspaceId: string; optional: CustomFsRootStoreOptional }, _optional = {}): CustomFsRootState {
  const store = readPersistedPaths({ filePath: persistenceFilePath(optional) });
  return resolveState({ persistedPath: store[workspaceId] });
}

/**
 * `workspaceId`'s currently usable custom root, or `undefined` when none has been set, or the one
 * that was set no longer resolves to a directory. {@link resolveFsRoots} (`layout.ts`) folds this
 * into its `custom` entry on every call, so a set/clear/vanish takes effect on the very next tool
 * call — nothing caches this value across the call, on disk or in memory.
 *
 * @complexity O(1). See {@link getCustomFsRootStatus}.
 */
export function getCustomFsRoot({ workspaceId, optional }: { workspaceId: string; optional: CustomFsRootStoreOptional }, _optional = {}): string | undefined {
  return getCustomFsRootStatus({ workspaceId, optional }).path;
}

/**
 * Sets (or, given `null`, clears) `workspaceId`'s custom root, persisting the change immediately.
 *
 * Validates only the directory's own existence and kind — never its contents — before accepting it:
 * an absolute path that does not exist, or that names a file rather than a directory, is refused
 * immediately with a message the composer UI can surface directly, rather than accepted and left to
 * silently produce empty listings later. Resolves through `realpath` so a symlinked path is stored in
 * its canonical form, matching the form {@link resolveFsFilePath} in `fs-files.ts` compares every
 * subsequent request against.
 *
 * @param required.workspaceId - Which workspace's custom root to change. Two workspaces never share a value —
 *   each is its own key in the persisted map.
 * @param required.path - An absolute directory path, or `null` to clear the current custom root.
 * @throws {CustomFsRootError} If `path` is not absolute, does not exist, or is not a directory.
 * @throws whatever the underlying `fs` call throws while persisting (e.g. `EACCES` on the site
 *   directory) — surfaced, never swallowed.
 * @complexity O(1) — one `stat`/`realpath` call plus one small JSON read+write, never proportional to
 *   the directory's own contents.
 */
export function setCustomFsRoot({ workspaceId, path, optional }: { workspaceId: string; path: string | null; optional: CustomFsRootStoreOptional }, _optional = {}): void {
  const filePath = persistenceFilePath(optional);
  const store = readPersistedPaths({ filePath });

  if (path === null) {
    delete store[workspaceId];
    writePersistedPaths({ filePath, store });
    return;
  }
  assertExistingAbsoluteDirectory({ path }, {});

  store[workspaceId] = realpathSync(path);
  writePersistedPaths({ filePath, store });
}

/**
 * Test-only reset: overwrites `siteDir`'s persistence file with an empty object, creating it
 * if absent — it is not deleted. `siteDir` is REQUIRED, as it is for every store operation, so this can
 * never be called bare and reach for the real site directory by accident — every caller must name the
 * temp directory it wants cleared.
 */
export function resetCustomFsRootForTests({ siteDir }: { siteDir: string }, _optional = {}): void {
  try {
    writePersistedPaths({ filePath: persistenceFilePath({ siteDir }), store: {} });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Validate a directory reference without canonicalizing the user's path or changing the custom root. */
export function assertExistingAbsoluteDirectory({ path }: { path: string }, _options = {}): void {
  if (!isAbsolute(path)) {
    throw new CustomFsRootError({ message: `'${path}' is not an absolute path` });
  }
  if (!existsSync(path)) {
    throw new CustomFsRootError({ message: `'${path}' does not exist` });
  }
  if (!statSync(path).isDirectory()) {
    throw new CustomFsRootError({ message: `'${path}' is not a directory` });
  }
}
