import fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaultPlatformMessages, type PlatformMessages } from "../messages.js";
import { errorCodeOf } from "./errno.js";

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
const DIRECTORY_SYNC_UNSUPPORTED = ["EPERM", "EISDIR", "EINVAL", "EACCES", "ENOTSUP"];
function hasErrorCode(error: unknown, codes: readonly string[]): boolean {
  const code = errorCodeOf(error);
  return code !== undefined && codes.includes(code);
}
function isMissing(error: unknown): boolean {
  return hasErrorCode(error, ["ENOENT"]);
}
/** Runs a probe where only ENOENT means absent; every other failure propagates. */
function ignoreMissing<T>(probe: () => T): T | undefined {
  try {
    return probe();
  } catch (error) {
    if (!isMissing(error)) throw error;
    return undefined;
  }
}
async function ignoreMissingAsync<T>(probe: () => Promise<T>): Promise<T | undefined> {
  try {
    return await probe();
  } catch (error) {
    if (!isMissing(error)) throw error;
    return undefined;
  }
}
/** Cleanup must never mask the failure that triggered it. */
function attempt(action: () => void): void {
  try { action(); } catch { /* preserve the original failure */ }
}
async function attemptAsync(action: () => Promise<unknown>): Promise<void> {
  try { await action(); } catch { /* preserve the original failure */ }
}
function messagesFor(options: AtomicWriteOptions): PlatformMessages {
  return options.messages ?? defaultPlatformMessages;
}
function validateMode(mode: number, options: AtomicWriteOptions): number {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) throw new RangeError(messagesFor(options).atomicModeInvalid());
  return mode;
}
/** Explicit mode wins, then the preserved destination mode, then the store default, then 0600. */
function resolveMode({ existingMode }: { existingMode: number | undefined }, options: AtomicWriteOptions): number {
  return validateMode(options.mode ?? existingMode ?? options.defaultMode ?? 0o600, options);
}
function defaultTempName(): string {
  return `${process.pid}.${randomUUID()}`;
}
function checkedTempPath({ filePath, temporary }: { filePath: string; temporary: string }, options: AtomicWriteOptions): string {
  if (path.resolve(path.dirname(temporary)) !== path.resolve(path.dirname(filePath)) || path.resolve(temporary) === path.resolve(filePath) || temporary.includes("\0")) throw new RangeError(messagesFor(options).atomicTempPathInvalid());
  return temporary;
}
const DOT_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);
function tokenTempPath({ filePath, token }: { filePath: string; token: string }, options: AtomicWriteOptions): string {
  if (!token || DOT_SEGMENTS.has(token) || token.includes("\0") || /[/\\]/.test(token)) throw new RangeError(messagesFor(options).atomicTempNameInvalid());
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${token}.tmp`);
}
function temporaryPath({ filePath }: { filePath: string }, options: AtomicWriteOptions): string {
  if (options.tempPath) return checkedTempPath({ filePath, temporary: options.tempPath({ filePath }) }, options);
  return tokenTempPath({ filePath, token: (options.tempName ?? defaultTempName)({ filePath }) }, options);
}
function assertNotSymlink(info: { isSymbolicLink(): boolean }, options: AtomicWriteOptions): void {
  if (info.isSymbolicLink()) throw new Error(messagesFor(options).atomicSymlinkRefused());
}
function assertOwnerOnly(mode: number, options: AtomicWriteOptions, platform: NodeJS.Platform): void {
  // Windows has no POSIX group/other bits; secret stores skip this verification there.
  if (options.verifyOwnerOnly && platform !== "win32" && (mode & 0o077) !== 0) throw new Error(messagesFor(options).atomicPermissionsRefused());
}
function isDirectorySyncUnsupported(error: unknown): boolean {
  return hasErrorCode(error, DIRECTORY_SYNC_UNSUPPORTED);
}
/** Destination mode with optional symlink refusal; ENOENT handling is left to the caller. */
function destinationModeSync({ filePath, filesystem }: { filePath: string; filesystem: AtomicFilesystemPort }, options: AtomicWriteOptions): number {
  if (!options.refuseSymlink) return filesystem.stat({ path: filePath }).mode & 0o777;
  const info = filesystem.lstat({ path: filePath }); assertNotSymlink(info, options);
  return info.mode & 0o777;
}
async function destinationModeAsync({ filePath, filesystem }: { filePath: string; filesystem: AtomicAsyncFilesystem }, options: AtomicWriteOptions): Promise<number> {
  if (!options.refuseSymlink) return (await filesystem.stat(filePath)).mode & 0o777;
  const info = await filesystem.lstat(filePath); assertNotSymlink(info, options);
  return info.mode & 0o777;
}
function serializeJson({ data }: { data: unknown }, options: AtomicWriteOptions): string {
  const content = JSON.stringify(data, null, 2);
  if (content === undefined) throw new TypeError(messagesFor(options).atomicJsonUnserializable());
  return content;
}
/** Flush directory metadata where supported; Windows cannot fsync directory handles.
 * Unsupported open/sync errors are ignored because replacement has already landed.
 * Other failures propagate, and an opened descriptor is always closed.
 * @complexity O(1) filesystem calls and space.
 */
export function syncDirectoryBestEffort(
  { directory, open, sync, close }: { directory: string; open: (path: string, flags: "r") => number; sync: (descriptor: number) => void; close: (descriptor: number) => void },
  { platform }: { platform: NodeJS.Platform },
): void {
  if (platform === "win32") return;
  let descriptor: number | undefined;
  try { descriptor = open(directory, "r"); sync(descriptor); }
  catch (error) { if (!isDirectorySyncUnsupported(error)) throw error; }
  finally { if (descriptor !== undefined) close(descriptor); }
}
/** Async directory flush with the same unsupported-error and handle-ownership contract.
 * @complexity O(1) filesystem calls and space.
 */
export async function syncDirectoryBestEffortAsync(
  { directory, open }: { directory: string; open: (path: string, flags: "r") => Promise<Pick<fsPromises.FileHandle, "sync" | "close">> },
  { platform }: { platform: NodeJS.Platform },
): Promise<void> {
  if (platform === "win32") return;
  let handle: Pick<fsPromises.FileHandle, "sync" | "close"> | undefined;
  try { handle = await open(directory, "r"); await handle.sync(); }
  catch (error) { if (!isDirectorySyncUnsupported(error)) throw error; }
  finally { if (handle !== undefined) await handle.close(); }
}
/** Same-directory rename; preserve existing mode exactly, default new files to 0600.
 * Only ENOENT means absent. Stat/write/chmod failures propagate before any rename.
 * Flush file bytes before rename so metadata cannot precede content; directory flush is best-effort:
 * skip Windows and ignore unsupported-code failures (EPERM/EISDIR/EINVAL/EACCES/ENOTSUP).
 * Other directory-flush failures are reported after replacement, because rename cannot be rolled back safely.
 */
export function writeFileAtomic(required: AtomicWriteRequired, options: AtomicWriteOptions = {}): void {
  const { filePath, content, fs: filesystem } = required;
  const platform = options.platform ?? process.platform;
  const existingMode = ignoreMissing(() => destinationModeSync({ filePath, filesystem }, options));
  const mode = resolveMode({ existingMode }, options);
  const temporary = temporaryPath(required, options);
  // A failed exclusive create does not grant ownership of an existing temporary file.
  let descriptor: number | undefined = filesystem.open({ path: temporary, flags: "wx", mode });
  let renamed = false;
  try {
    filesystem.write({ descriptor, content });
    filesystem.chmod({ path: temporary, mode });
    assertOwnerOnly(filesystem.stat({ path: temporary }).mode, options, platform);
    filesystem.sync({ descriptor });
    const fileDescriptor = descriptor; descriptor = undefined;
    filesystem.close({ descriptor: fileDescriptor });
    if (options.refuseSymlink) ignoreMissing(() => assertNotSymlink(filesystem.lstat({ path: filePath }), options));
    filesystem.rename({ from: temporary, to: filePath }); renamed = true;
    syncDirectoryBestEffort({ directory: path.dirname(filePath),
      open: (path, flags) => filesystem.open({ path, flags }),
      sync: descriptor => filesystem.sync({ descriptor }), close: descriptor => filesystem.close({ descriptor }),
    }, { platform });
  } catch (error) {
    const openDescriptor = descriptor;
    if (openDescriptor !== undefined) attempt(() => filesystem.close({ descriptor: openDescriptor }));
    if (!renamed) attempt(() => filesystem.remove({ path: temporary }));
    throw error;
  }
}
/** Pretty JSON delegates to the same mode-preserving atomic primitive. */
export function writeJsonFileAtomic(required: Omit<AtomicWriteRequired, "content"> & { data: unknown }, options: AtomicWriteOptions = {}): void {
  const { data, ...writer } = required;
  writeFileAtomic({ ...writer, content: serializeJson({ data }, options) }, options);
}
/** Async counterpart with the same ownership, permission and durability guarantees.
 * Parent creation supports runtime-state and secret stores without another writer implementation. */
export async function writeFileAtomicAsync(
  required: { filePath: string; content: string | Uint8Array },
  options: AtomicWriteOptions & { fs?: AtomicAsyncFilesystem; createParent?: boolean } = {},
): Promise<void> {
  const { filePath, content } = required;
  const platform = options.platform ?? process.platform;
  const filesystem = options.fs ?? fsPromises;
  if (options.createParent) await filesystem.mkdir(path.dirname(filePath), { recursive: true });
  const existingMode = await ignoreMissingAsync(() => destinationModeAsync({ filePath, filesystem }, options));
  const mode = resolveMode({ existingMode }, options);
  const temporary = temporaryPath(required, options);
  // Keep the exclusive create outside cleanup: EEXIST belongs to a different writer.
  const handle = await filesystem.open(temporary, "wx", mode);
  let closed = false, renamed = false;
  try {
    await handle.writeFile(content, "utf8");
    await handle.chmod(mode);
    assertOwnerOnly((await handle.stat()).mode, options, platform);
    await handle.sync();
    await handle.close(); closed = true;
    if (options.refuseSymlink) await ignoreMissingAsync(async () => assertNotSymlink(await filesystem.lstat(filePath), options));
    await renameWithRetry({ filesystem, from: temporary, to: filePath }); renamed = true;
    await syncDirectoryBestEffortAsync({ directory: path.dirname(filePath), open: (path, flags) => filesystem.open(path, flags) }, { platform });
  } catch (error) {
    if (!closed) await attemptAsync(() => handle.close());
    if (!renamed) await attemptAsync(() => filesystem.rm(temporary, { force: true }));
    throw error;
  }
}
/** Editors, antivirus and dev-server watchers can hold Windows destinations briefly.
 * Retry only transient rename refusals; retain the same temporary file and fail after 5 tries.
 * @complexity O(1) time/space, at most 150ms of backoff plus five filesystem calls.
 */
async function renameWithRetry({ filesystem, from, to }: {
  filesystem: AtomicAsyncFilesystem; from: string; to: string;
}): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await filesystem.rename(from, to); return; }
    catch (error) {
      if (attempt >= 4 || !hasErrorCode(error, ['EPERM', 'EBUSY'])) throw error;
      await new Promise<void>(resolve => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}
/** Pretty JSON can retain a state-store's trailing newline without changing its serialization. */
export async function writeJsonFileAtomicAsync(
  required: { filePath: string; data: unknown },
  options: AtomicWriteOptions & { fs?: AtomicAsyncFilesystem; createParent?: boolean; trailingNewline?: boolean } = {},
): Promise<void> {
  const { data, ...writer } = required;
  await writeFileAtomicAsync({ ...writer, content: serializeJson({ data }, options) + (options.trailingNewline ? "\n" : "") }, options);
}
