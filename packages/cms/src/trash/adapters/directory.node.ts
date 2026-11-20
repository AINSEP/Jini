import { chmod, lstat, mkdir, readdir, realpath, rename, rm, rmdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { TrashAdapter, TrashMarkerResult, TrashPurgeOutcome } from "../ports.js";

export interface DirectoryTrashLocation {
  liveParent: string;
  liveNames: readonly string[];
  parkedDir: string;
}

export interface DirectoryTrashAdapterDeps {
  entityType: string;
  locate(required: { workspaceId: string; entityId: string }): DirectoryTrashLocation | Promise<DirectoryTrashLocation>;
  forget?(required: { workspaceId: string; entityId: string }): Promise<void>;
}

function errorCode({ error }: { error: unknown }, _optional = {}): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function exists({ path }: { path: string }, _optional = {}): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode({ error }) === "ENOENT") return false;
    throw error;
  }
}

function validateLocation({ location }: { location: DirectoryTrashLocation }, _optional = {}): void {
  const liveParent = resolve(location.liveParent);
  const parkedDir = resolve(location.parkedDir);
  const parkedRelative = relative(liveParent, parkedDir);
  if (parkedRelative === "" || (!parkedRelative.startsWith("..") && !isAbsolute(parkedRelative))) {
    throw new Error(`directory Trash parking path '${parkedDir}' must be outside live parent '${liveParent}'`);
  }
  for (const name of location.liveNames) {
    if (name === "" || name === "." || name === ".." || basename(name) !== name) {
      throw new Error(`directory Trash live name '${name}' must be one path segment`);
    }
  }
}

async function assertSameFilesystem({ liveParent, parkedDir }: { liveParent: string; parkedDir: string }, _optional = {}): Promise<void> {
  await mkdir(dirname(parkedDir), { recursive: true });
  const [live, parked] = await Promise.all([stat(liveParent), stat(dirname(parkedDir))]);
  if (live.dev !== parked.dev) {
    throw new Error(`directory Trash requires atomic rename on one filesystem: '${liveParent}' -> '${parkedDir}'`);
  }
  // Symlinks can defeat validateLocation's lexical check; the parking root must stay outside the
  // live parent after resolving them too.
  const [realLive, realParkedParent] = await Promise.all([realpath(liveParent), realpath(dirname(parkedDir))]);
  const realRelative = relative(realLive, realParkedParent);
  if (realRelative === "" || (!realRelative.startsWith("..") && !isAbsolute(realRelative))) {
    throw new Error(`directory Trash parking path '${parkedDir}' resolves inside live parent '${liveParent}'`);
  }
}

/** Move one root with its exact original mode, restoring that mode even when rename throws.
 * @complexity O(1) filesystem operations; rename errors propagate to the adapter's rollback. */
async function moveDir(required: { from: string; to: string }, optional: { readonly rename?: typeof rename } = {}): Promise<void> {
  const { from, to } = required;
  const renameDirectory = optional.rename ?? rename;
  const entry = await lstat(from);
  if (entry.isSymbolicLink()) {
    await renameDirectory(from, to);
    return;
  }
  const originalMode = entry.mode & 0o7777;
  await chmod(from, originalMode | 0o700);
  let current = from;
  try {
    await renameDirectory(from, to);
    current = to;
  } catch (error) {
    if (errorCode({ error }) === "EXDEV") {
      throw new Error(`directory Trash cannot move '${from}' across filesystems`);
    }
    throw error;
  } finally {
    await chmod(current, originalMode);
  }
}

async function removeEmptyDir({ path }: { path: string }, _optional = {}): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (!new Set(["ENOENT", "ENOTEMPTY"]).has(errorCode({ error }) ?? "")) throw error;
  }
}

async function makeTreeWritable({ path }: { path: string }, _optional = {}): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) return;
  if (!entry.isDirectory()) {
    await chmod(path, entry.mode | 0o600);
    return;
  }
  await chmod(path, entry.mode | 0o700);
  for (const child of await readdir(path)) {
    await makeTreeWritable({ path: join(path, child) });
  }
}

async function parkedCount({ parkedDir }: { parkedDir: string }, _optional = {}): Promise<number> {
  return Math.max(1, (await readdir(parkedDir)).length);
}

/** Reserve the park atomically; another hide that wins the mkdir race is already in Trash. */
async function reservePark(required: { parkedDir: string }, _options: Record<string, never> = {}): Promise<Extract<TrashMarkerResult, { ok: false }> | null> {
  try {
    await mkdir(required.parkedDir);
    return null;
  } catch (error) {
    if (errorCode({ error }) === "EEXIST") {
      return { ok: false, reason: "blocked", code: "ALREADY_IN_TRASH", count: await parkedCount({ parkedDir: required.parkedDir }) };
    }
    throw error;
  }
}

/** Restore staged roots in reverse order through the same rename port as the forward moves.
 * @complexity O(n) time and space in staged roots; filesystem errors propagate. */
async function rollbackMoves(required: { moved: readonly { from: string; to: string }[] }, optional: { readonly rename?: typeof rename } = {}): Promise<void> {
  for (const move of [...required.moved].reverse()) {
    if (await exists({ path: move.from })) await moveDir(move, optional);
  }
}

/** Stage roots through the rename port, recording inverse moves even if a rename moved then threw.
 * @complexity O(n) filesystem moves; the caller owns rollback and error classification. */
async function stageMoves(
  required: { names: readonly string[]; fromParent: string; toParent: string; moved: { from: string; to: string }[] },
  optional: { readonly rename?: typeof rename } = {},
): Promise<void> {
  for (const name of required.names) {
    const from = join(required.fromParent, name);
    const to = join(required.toParent, name);
    try {
      await moveDir({ from, to }, optional);
      required.moved.push({ from: to, to: from });
    } catch (error) {
      if ((await exists({ path: to })) && !(await exists({ path: from }))) required.moved.push({ from: to, to: from });
      throw error;
    }
  }
}

/**
 * Wraps a bound remove so a throw after the adapter already moved the folder (e.g. the Trash row
 * insert failed) best-effort moves it back before the error propagates. The Trash core has no
 * revert hook for filesystem adapters, so each composition root binds removal through this.
 */
export function unhideIfRemoveThrows<R extends { workspaceId: string; id: string; at: string }, T>(
  { adapter, remove, onRollbackError }: { adapter: TrashAdapter; remove: (required: R) => Promise<T>; onRollbackError: (required: { error: unknown }) => void }, _optional = {},
): (required: R) => Promise<T> {
  return async (required) => {
    try {
      return await remove(required);
    } catch (error) {
      await adapter
        .unhide({ workspaceId: required.workspaceId, entityId: required.id, at: required.at, expectedVersion: null })
        .catch((rollbackError: unknown) => onRollbackError({ error: rollbackError }));
      throw error;
    }
  };
}

/** Bind directory Trash operations; optional rename injection keeps failure probes on real files.
 * @example createDirectoryTrashAdapter({ entityType: "plugin", locate }, { rename });
 * @complexity O(1) composition; each operation retains its existing errors and side effects. */
export function createDirectoryTrashAdapter(deps: DirectoryTrashAdapterDeps, optional: { readonly rename?: typeof rename } = {}): TrashAdapter {
  async function locate(required: { workspaceId: string; entityId: string }): Promise<DirectoryTrashLocation> {
    const location = await deps.locate(required);
    validateLocation({ location });
    return location;
  }

  return {
    entityType: deps.entityType,

    async hide(required) {
      return hideDirectory({ location: await locate(required) }, optional);
    },

    async unhide(required) {
      return unhideDirectory({ location: await locate(required) }, optional);
    },

    async purge(required) {
      return purgeDirectory({ location: await locate(required), deps, identity: required });
    },
  };
}

async function hideDirectory({ location }: { location: DirectoryTrashLocation }, optional: { readonly rename?: typeof rename } = {}): Promise<TrashMarkerResult> {
      if (await exists({ path: location.parkedDir })) {
        return { ok: false, reason: "blocked", code: "ALREADY_IN_TRASH", count: await parkedCount({ parkedDir: location.parkedDir }) };
      }
      if (location.liveNames.length === 0) return { ok: false, reason: "not-found" };
      for (const name of location.liveNames) {
        if (!(await exists({ path: join(location.liveParent, name) }))) return { ok: false, reason: "not-found" };
      }

      await assertSameFilesystem({ liveParent: location.liveParent, parkedDir: location.parkedDir });
      const reservation = await reservePark({ parkedDir: location.parkedDir });
      if (reservation) return reservation;

      const moved: { from: string; to: string }[] = [];
      try {
        await stageMoves({ names: location.liveNames, fromParent: location.liveParent, toParent: location.parkedDir, moved }, optional);
      } catch (error) {
        await rollbackMoves({ moved }, optional);
        await removeEmptyDir({ path: location.parkedDir });
        if (errorCode({ error }) === "ENOENT") return { ok: false, reason: "not-found" };
        throw error;
      }
      return { ok: true, version: null };
    }

async function unhideDirectory({ location }: { location: DirectoryTrashLocation }, optional: { readonly rename?: typeof rename } = {}): Promise<TrashMarkerResult> {
      if (!(await exists({ path: location.parkedDir }))) return { ok: false, reason: "not-found" };
      const parkedNames = await readdir(location.parkedDir);
      if (parkedNames.length === 0) return { ok: false, reason: "not-found" };
      if (location.liveNames.length > 0) return { ok: false, reason: "version-changed" };
      for (const name of parkedNames) {
        if (await exists({ path: join(location.liveParent, name) })) return { ok: false, reason: "version-changed" };
      }

      await assertSameFilesystem({ liveParent: location.liveParent, parkedDir: location.parkedDir });
      const moved: { from: string; to: string }[] = [];
      try {
        await stageMoves({ names: parkedNames, fromParent: location.parkedDir, toParent: location.liveParent, moved }, optional);
      } catch (error) {
        await rollbackMoves({ moved }, optional);
        throw error;
      }
      await removeEmptyDir({ path: location.parkedDir });
      return { ok: true, version: null };
    }

async function purgeDirectory({ location, deps, identity }: { location: DirectoryTrashLocation; deps: DirectoryTrashAdapterDeps; identity: Parameters<TrashAdapter["purge"]>[0] }, _optional = {}): Promise<TrashPurgeOutcome> {
      if (!(await exists({ path: location.parkedDir }))) return "already-gone";
      const purgingDir = `${location.parkedDir}.purging-${randomUUID()}`;
      await rename(location.parkedDir, purgingDir);
      try {
        await deps.forget?.({ workspaceId: identity.workspaceId, entityId: identity.entityId });
      } catch (error) {
        await rename(purgingDir, location.parkedDir);
        throw error;
      }
      await makeTreeWritable({ path: purgingDir });
      await rm(purgingDir, { recursive: true, force: true });
      return "purged";
    }
