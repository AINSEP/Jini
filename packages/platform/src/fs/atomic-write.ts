import fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaultPlatformMessages, type PlatformMessages } from "../messages.js";

/** Synchronous seam preserves the original fail-before-rename and permission contract.
 * Descriptor ownership separates failed exclusive creates from failures after creating a temp. */
export interface AtomicFilesystemPort {
  stat(required: { path: string }): { mode: number };
  lstat(required: { path: string }): { mode: number; isSymbolicLink(): boolean };
  open(required: { path: string; flags: "wx" | "r"; mode?: number }): number;
  write(required: { descriptor: number; content: string }): void;
  sync(required: { descriptor: number }): void;
  close(required: { descriptor: number }): void;
  chmod(required: { path: string; mode: number }): void;
  rename(required: { from: string; to: string }): void;
  remove(required: { path: string }): void;
}
export type AtomicNativeFilesystem = Pick<typeof fs, "statSync" | "lstatSync" | "openSync" | "writeFileSync" | "fsyncSync" | "closeSync" | "chmodSync" | "renameSync" | "rmSync">;
export type AtomicAsyncFilesystem = Pick<typeof fsPromises, "stat" | "lstat" | "open" | "chmod" | "rename" | "rm" | "mkdir">;
export interface AtomicWriteRequired {
  filePath: string;
  content: string;
  fs: AtomicFilesystemPort;
}
export interface AtomicWriteOptions {
  messages?: PlatformMessages;
  /** Optional collision token; native pid + UUID restores the original default. */
  tempName?: (required: { filePath: string }) => string;
  /** Explicit mode overrides preservation, e.g. secret-bearing files must use 0600. */
  mode?: number;
  /** Default for a missing destination; shared durable stores retain their former 0666 create mode. */
  defaultMode?: number;
  refuseSymlink?: boolean;
  /** Verify owner-only permissions before rename on POSIX, as secret stores require. */
  verifyOwnerOnly?: boolean;
  platform?: NodeJS.Platform;
  /** Same-directory legacy temp layout, for stores that expose their temp path publicly. */
  tempPath?: (required: { filePath: string }) => string;
}
/** Optional adapter wiring: no layout, env key, or application name is selected here. */
export function createNodeAtomicFilesystem(_required: Record<string, never>, { filesystem = fs }: { filesystem?: AtomicNativeFilesystem } = {}): AtomicFilesystemPort {
  return {
    stat: ({ path }) => filesystem.statSync(path),
    lstat: ({ path }) => filesystem.lstatSync(path),
    open: ({ path, flags, mode }) => filesystem.openSync(path, flags, mode),
    write: ({ descriptor, content }) => filesystem.writeFileSync(descriptor, content),
    sync: ({ descriptor }) => filesystem.fsyncSync(descriptor),
    close: ({ descriptor }) => filesystem.closeSync(descriptor),
    chmod: ({ path, mode }) => filesystem.chmodSync(path, mode),
    rename: ({ from, to }) => filesystem.renameSync(from, to),
    remove: ({ path }) => filesystem.rmSync(path, { force: true }),
  };
}
function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function validateMode(mode: number, options: AtomicWriteOptions): number {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) throw new RangeError((options.messages ?? defaultPlatformMessages).atomicModeInvalid());
  return mode;
}
function temporaryPath({ filePath }: { filePath: string }, options: AtomicWriteOptions): string {
  const { tempName = () => `${process.pid}.${randomUUID()}` } = options;
  if (options.tempPath) {
    const temporary = options.tempPath({ filePath });
    if (path.resolve(path.dirname(temporary)) !== path.resolve(path.dirname(filePath)) || path.resolve(temporary) === path.resolve(filePath) || temporary.includes("\0")) throw new RangeError((options.messages ?? defaultPlatformMessages).atomicTempPathInvalid());
    return temporary;
  }
  const token = tempName({ filePath });
  if (!token || token === "." || token === ".." || /[/\\\x00]/.test(token)) throw new RangeError((options.messages ?? defaultPlatformMessages).atomicTempNameInvalid());
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${token}.tmp`);
}
function assertNotSymlink(info: { isSymbolicLink(): boolean }, options: AtomicWriteOptions): void {
  if (info.isSymbolicLink()) throw new Error((options.messages ?? defaultPlatformMessages).atomicSymlinkRefused());
}
function assertOwnerOnly(mode: number, options: AtomicWriteOptions): void {
  // Windows has no POSIX group/other bits; secret stores skip this verification there.
  if (options.verifyOwnerOnly && (options.platform ?? process.platform) !== "win32" && (mode & 0o077) !== 0) throw new Error((options.messages ?? defaultPlatformMessages).atomicPermissionsRefused());
}
/** Same-directory rename; preserve existing mode exactly, default new files to 0600.
 * Only ENOENT means absent. Stat/write/chmod failures propagate before any rename.
 * Flush file bytes before rename so metadata cannot precede content; then flush the parent dir.
 * A directory-sync failure is reported after replacement, because rename cannot be rolled back safely.
 */
export function writeFileAtomic(required: AtomicWriteRequired, options: AtomicWriteOptions = {}): void {
  const { filePath, content, fs: filesystem } = required;
  let existingMode: number | undefined;
  try {
    if (options.refuseSymlink) {
      const info = filesystem.lstat({ path: filePath }); assertNotSymlink(info, options); existingMode = info.mode & 0o777;
    } else { existingMode = filesystem.stat({ path: filePath }).mode & 0o777; }
  } catch (error) { if (!isMissing(error)) throw error; }
  const mode = validateMode(options.mode ?? existingMode ?? options.defaultMode ?? 0o600, options);
  const temporary = temporaryPath(required, options);
  // A failed exclusive create does not grant ownership of an existing temporary file.
  let descriptor: number | undefined = filesystem.open({ path: temporary, flags: "wx", mode });
  let renamed = false;
  try {
    filesystem.write({ descriptor, content });
    filesystem.chmod({ path: temporary, mode });
    assertOwnerOnly(filesystem.stat({ path: temporary }).mode, options);
    filesystem.sync({ descriptor });
    const fileDescriptor = descriptor; descriptor = undefined;
    filesystem.close({ descriptor: fileDescriptor });
    if (options.refuseSymlink) {
      try { assertNotSymlink(filesystem.lstat({ path: filePath }), options); } catch (error) { if (!isMissing(error)) throw error; }
    }
    filesystem.rename({ from: temporary, to: filePath }); renamed = true;
    const directory = filesystem.open({ path: path.dirname(filePath), flags: "r" });
    try { filesystem.sync({ descriptor: directory }); } finally { filesystem.close({ descriptor: directory }); }
  } catch (error) {
    if (descriptor !== undefined) { try { filesystem.close({ descriptor }); } catch { /* preserve the original failure */ } }
    if (!renamed) { try { filesystem.remove({ path: temporary }); } catch { /* preserve the original failure */ } }
    throw error;
  }
}
/** Pretty JSON delegates to the same mode-preserving atomic primitive. */
export function writeJsonFileAtomic(required: Omit<AtomicWriteRequired, "content"> & { data: unknown }, options: AtomicWriteOptions = {}): void {
  const { data, ...writer } = required;
  const content = JSON.stringify(data, null, 2);
  if (content === undefined) throw new TypeError((options.messages ?? defaultPlatformMessages).atomicJsonUnserializable());
  writeFileAtomic({ ...writer, content }, options);
}
/** Async counterpart with the same ownership, permission and durability guarantees.
 * Parent creation supports runtime-state and secret stores without another writer implementation. */
export async function writeFileAtomicAsync(
  required: { filePath: string; content: string },
  options: AtomicWriteOptions & { fs?: AtomicAsyncFilesystem; createParent?: boolean } = {},
): Promise<void> {
  const { filePath, content } = required;
  const filesystem = options.fs ?? fsPromises;
  if (options.createParent) await filesystem.mkdir(path.dirname(filePath), { recursive: true });
  let existingMode: number | undefined;
  try {
    const info = options.refuseSymlink ? await filesystem.lstat(filePath) : await filesystem.stat(filePath);
    if (options.refuseSymlink) assertNotSymlink(info, options);
    existingMode = info.mode & 0o777;
  } catch (error) { if (!isMissing(error)) throw error; }
  const mode = validateMode(options.mode ?? existingMode ?? options.defaultMode ?? 0o600, options);
  const temporary = temporaryPath(required, options);
  // Keep the exclusive create outside cleanup: EEXIST belongs to a different writer.
  const handle = await filesystem.open(temporary, "wx", mode);
  let closed = false, renamed = false;
  try {
    await handle.writeFile(content, "utf8");
    await handle.chmod(mode);
    assertOwnerOnly((await handle.stat()).mode, options);
    await handle.sync();
    await handle.close(); closed = true;
    if (options.refuseSymlink) {
      try { assertNotSymlink(await filesystem.lstat(filePath), options); } catch (error) { if (!isMissing(error)) throw error; }
    }
    await filesystem.rename(temporary, filePath); renamed = true;
    const directory = await filesystem.open(path.dirname(filePath), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (!closed) { try { await handle.close(); } catch { /* preserve the original failure */ } }
    if (!renamed) { try { await filesystem.rm(temporary, { force: true }); } catch { /* preserve the original failure */ } }
    throw error;
  }
}
/** Pretty JSON can retain a state-store's trailing newline without changing its serialization. */
export async function writeJsonFileAtomicAsync(
  required: { filePath: string; data: unknown },
  options: AtomicWriteOptions & { fs?: AtomicAsyncFilesystem; createParent?: boolean; trailingNewline?: boolean } = {},
): Promise<void> {
  const { data, ...writer } = required;
  const content = JSON.stringify(data, null, 2);
  if (content === undefined) throw new TypeError((options.messages ?? defaultPlatformMessages).atomicJsonUnserializable());
  await writeFileAtomicAsync({ ...writer, content: content + (options.trailingNewline ? "\n" : "") }, options);
}
