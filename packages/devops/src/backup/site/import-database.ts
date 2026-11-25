import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, readFile, rm, statfs, readdir, mkdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileLockTimeoutError } from "@jini-ai/core/contracts/runtime";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { SiteShareRefusal, archiveRefusalName } from "./share-refusal.js";

/** The slice of a forked helper this module drives: its failure/exit events and a kill switch. */
export interface ImportWorkerChild {
  readonly stderr?: Readable | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
}

/** The exclusive file lock the host owns (its `withFileLock`), as far as this module drives it. */
export type ImportFileLock = <T>(
  required: { lockPath: string; run: () => Promise<T> | T },
  optional?: { timeoutMs?: number; staleMs?: number; timeoutMessage?: () => string },
) => Promise<T>;

/** Host ports, defaulted at this composition edge; tests substitute the space probe, limits and helper. */
export interface RebuildImportDatabaseOptions {
  signal?: AbortSignal;
  limits?: { readonly maxExpandedBytes: number };
  statfs?: (root: string) => Promise<{ bavail: number; bsize: number }>;
  fork?: (modulePath: string, args: string[], options: childProcess.ForkOptions) => ImportWorkerChild;
}

/** Host values and collaborators the import-database helper cannot own. Every member is REQUIRED. */
export interface ImportDatabaseHost {
  /** Redacts secret shapes from helper diagnostics before they reach server logs. */
  redact(required: { text: string }): { text: string };
  /** Exclusive lock around one staging root. */
  withFileLock: ImportFileLock;
  /** The expanded-size cap for the incoming snapshot and the rebuilt database. */
  limits: { readonly maxExpandedBytes: number };
  /** Name prefix of every staging directory (and its sibling `.lock`) in the OS temp directory. */
  stagingPrefix: string;
  /** The helper entrypoint, relative to the module URL and without extension (`.ts` in source mode, `.js` in a build). */
  helperStem: string;
  /** The refusal shown when the helper reports a schema-version mismatch. */
  versionMismatchMessage: string;
  /** The helper's exit code for a schema-version mismatch. */
  schemaMismatchExitCode: number;
  /** The helper's exit code for a typed refusal whose message it wrote to `refusal.txt`. */
  refusalExitCode: number;
  /** Host-specific environment entries for the helper, minted under its private root. */
  workerEnv(required: { root: string }): Record<string, string | undefined>;
}

/** The helper entrypoint beside `moduleUrl` and the Node flags it needs (heap ceiling; tsx in source mode). */
export function importWorkerLaunch({ moduleUrl, helperStem }: { moduleUrl: string; helperStem: string }): { helper: string; execArgv: string[] } {
  const sourceMode = moduleUrl.endsWith(".ts");
  const helper = fileURLToPath(new URL(helperStem + (sourceMode ? ".ts" : ".js"), moduleUrl));
  return { helper, execArgv: [...(sourceMode ? ["--import", "tsx"] : []), "--max-old-space-size=512"] };
}

/** Maps the helper's private exit contract to the refusal the person sees.
 * Only the trusted helper's typed refusals have a message file; native errors stay private.
 * Reads at most refusal.txt from the private staging root; O(message bytes).
 * @throws SiteShareRefusal INVALID_DATABASE for any non-zero exit.
 */
async function requireWorkerSuccess(required: { code: number | null; root: string; host: ImportDatabaseHost }, _optional = {}): Promise<void> {
  const { host } = required;
  if (required.code === 0) return;
  const message = required.code === host.refusalExitCode ? `Import database refused: ${await readFile(path.join(required.root, "refusal.txt"), "utf8")}`
    : required.code === host.schemaMismatchExitCode ? host.versionMismatchMessage : "Import database has unsupported schema, invalid references or unsafe data.";
  throw new SiteShareRefusal({ code: "INVALID_DATABASE", message });
}

/** No inherited deployment credentials, startup injection or archived executable input. */
function workerEnvironment({ root, host }: { root: string; host: ImportDatabaseHost }, _optional = {}): Record<string, string | undefined> {
  return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TMPDIR: root, TMP: root, TEMP: root,
    HOME: root, USERPROFILE: root, ...host.workerEnv({ root }),
    XDG_DATA_HOME: path.join(root, "data"), XDG_CONFIG_HOME: path.join(root, "config"), APPDATA: path.join(root, "appdata"),
  };
}

/** Forwards the helper's stderr, one sanitized line at a time, to the server log. */
function relayWorkerDiagnostics({ child, host }: { child: ImportWorkerChild; host: ImportDatabaseHost }, _optional = {}): void {
  if (!child.stderr) return;
  createInterface({ input: child.stderr, crlfDelay: Infinity }).on("line", line => {
    // Redact the raw line (stripping a tab can break a shape like "Bearer\t<token>"), then
    // the control-free form (stripping can join key fragments), and only then truncate:
    // clipping a credential first could hide its recognizable shape and leak its head.
    const visible = host.redact({ text: line }).text.replace(/[\p{Cc}\p{Cf}]/gu, "");
    console.error(archiveRefusalName({ name: host.redact({ text: visible }).text }));
  });
}

/** Run the helper to completion under a 90 s deadline and the caller's cancellation; resolves its exit code. */
function runWorker(required: { host: ImportDatabaseHost; root: string; moduleUrl: string; fork: NonNullable<RebuildImportDatabaseOptions["fork"]> }, optional: { signal?: AbortSignal | undefined } = {}): Promise<number | null> {
  const { host, root, fork } = required;
  const { helper, execArgv } = importWorkerLaunch({ moduleUrl: required.moduleUrl, helperStem: host.helperStem });
  return new Promise<number | null>((resolve, reject) => {
    const child = fork(helper, [root], {
      execArgv,
      // Trusted code logs redacted diagnostics to stderr; keep them in server logs,
      // independently of the fixed public refusal written to refusal.txt. Crashes and
      // native warnings bypass worker logging, so the parent sanitizes every line.
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: workerEnvironment({ root, host }) as NodeJS.ProcessEnv,
    });
    relayWorkerDiagnostics({ child, host });
    let reason: unknown;
    const abort = () => { reason = new SiteShareRefusal({ code: "CANCELLED", message: "Import database verification was cancelled." }); child.kill("SIGKILL"); };
    const timer = setTimeout(() => { reason = new SiteShareRefusal({ code: "DATABASE_TIMEOUT", message: "Import database verification exceeded 90 seconds." }); child.kill("SIGKILL"); }, 90_000);
    optional.signal?.addEventListener("abort", abort, { once: true });
    if (optional.signal?.aborted) abort();
    child.once("error", error => { reason = error; });
    child.once("close", code => {
      clearTimeout(timer); optional.signal?.removeEventListener("abort", abort);
      if (reason) reject(reason);
      else resolve(code);
    });
  });
}

/** Read back the rebuilt database and its manifests from the helper's private root. */
async function readWorkerOutputs<TProjection extends { bytes: Buffer }>(required: { root: string; limits: { readonly maxExpandedBytes: number } }, _optional = {}): Promise<TProjection> {
  const { root } = required;
  const bytes = await readFile(path.join(root, "output.db"));
  if (bytes.length > required.limits.maxExpandedBytes) throw new SiteShareRefusal({ code: "LIMIT_EXCEEDED", message: "Rebuilt import database exceeds 300 MiB." });
  const media = JSON.parse(await readFile(path.join(root, "media.json"), "utf8")) as unknown;
  const documents = JSON.parse(await readFile(path.join(root, "documents.json"), "utf8")) as unknown;
  const notices = JSON.parse(await readFile(path.join(root, "notices.json"), "utf8")) as unknown;
  const credentialWarnings = JSON.parse(await readFile(path.join(root, "credential-warnings.json"), "utf8")) as unknown;
  return { bytes, media, documents, notices, credentialWarnings } as unknown as TProjection;
}

/** Stage the snapshot inside an owned root, run the helper and read its outputs back. */
async function rebuildInRoot<TProjection extends { bytes: Buffer }>(required: { host: ImportDatabaseHost; root: string; snapshot: Buffer; moduleUrl: string; omittedMediaIds?: readonly string[]; limits: { readonly maxExpandedBytes: number }; readSpace: NonNullable<RebuildImportDatabaseOptions["statfs"]>; fork: NonNullable<RebuildImportDatabaseOptions["fork"]> }, optional: { signal?: AbortSignal | undefined } = {}): Promise<TProjection> {
  const { root } = required;
  const space = await required.readSpace(root);
  if (space.bavail * space.bsize < required.snapshot.length * 3 + 16 * 1024 * 1024) throw new SiteShareRefusal({ code: "INSUFFICIENT_STORAGE", message: "Not enough private staging space to verify this database." });
  await writeFile(path.join(root, "input.db"), required.snapshot, { flag: "wx", mode: 0o600 });
  await writeFile(path.join(root, "omitted-media.json"), JSON.stringify(required.omittedMediaIds ?? []), { flag: "wx", mode: 0o600 });
  const code = await runWorker({ host: required.host, root, moduleUrl: required.moduleUrl, fork: required.fork }, { signal: optional.signal });
  await requireWorkerSuccess({ code, root, host: required.host });
  return readWorkerOutputs<TProjection>({ root, limits: required.limits });
}

/** Read hostile SQLite only in a disposable helper with a deadline and heap ceiling.
 * IPC carries no DB bytes or secrets. Input/output paths are minted here, never supplied by tools.
 * The helper runs trusted source only and reuses A's sanitizer after checking schema objects.
 * @complexity O(database bytes) memory/disk, capped at 300 MiB; one helper per import lane.
 */
export async function rebuildImportDatabase<TProjection extends { bytes: Buffer }>(required: { host: ImportDatabaseHost; snapshot: Buffer; moduleUrl: string; omittedMediaIds?: readonly string[] }, optional: RebuildImportDatabaseOptions = {}): Promise<TProjection> {
  const { host } = required;
  const { limits = host.limits, statfs: readSpace = statfs, fork = childProcess.fork } = optional;
  optional.signal?.throwIfAborted();
  if (required.snapshot.length > limits.maxExpandedBytes) throw new SiteShareRefusal({ code: "LIMIT_EXCEEDED", message: "Import database exceeds 300 MiB." });
  const root = path.join(tmpdir(), host.stagingPrefix + randomUUID());
  return host.withFileLock({ lockPath: root + ".lock", run: async () => {
    // No staging directory exists until this parent owns its sibling lock.
    await mkdir(root, { mode: 0o700 });
    try {
      return await rebuildInRoot<TProjection>({ host, root, snapshot: required.snapshot, moduleUrl: required.moduleUrl, ...(required.omittedMediaIds ? { omittedMediaIds: required.omittedMediaIds } : {}), limits, readSpace, fork }, { signal: optional.signal });
    } finally { await rm(root, { recursive: true, force: true }); }
  } }, { staleMs: Infinity, timeoutMessage: () => "The temporary import database is still being cleaned up. Try importing again." });
}

/** Startup cleanup of interrupted database helpers; unrelated temp entries are left alone.
 * Reuse the lock's dead-owner/staleness rule; a live owner is never removed for age.
 * @complexity O(temp entries + removed bytes), one short lock attempt per matching directory or leftover lock. */
export async function tidyImportDatabases(required: { host: ImportDatabaseHost }, _optional: Record<string, never> = {}): Promise<void> {
  const temp = tmpdir();
  for (const entry of await readdir(temp, { withFileTypes: true })) {
    if (!isImportDatabaseLeftover({ entry, prefix: required.host.stagingPrefix })) continue;
    const root = path.join(temp, entry.isDirectory() ? entry.name : entry.name.slice(0, -5));
    try {
      await required.host.withFileLock({ lockPath: root + ".lock", run: () => rm(root, { recursive: true, force: true }) }, { timeoutMs: 100, staleMs: 86_400_000 });
    } catch (error) {
      if (!isLockedByAnotherOwner({ error })) throw error;
    }
  }
}

/** An interrupted helper's directory or its leftover `.lock` file; anything else in temp is not ours. */
function isImportDatabaseLeftover({ entry, prefix }: { entry: Dirent; prefix: string }, _optional = {}): boolean {
  return entry.name.startsWith(prefix) && (entry.isDirectory() || (entry.isFile() && entry.name.endsWith(".lock")));
}

/** Another owner still holds the lock, or the OS still holds a handle: skip this leftover. */
function isLockedByAnotherOwner({ error }: { error: unknown }, _optional = {}): boolean {
  return error instanceof FileLockTimeoutError || ["EBUSY", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "");
}

/** The helper's three entry points, bound to one host's values. */
export interface ImportDatabase<TProjection extends { bytes: Buffer }> {
  rebuildImportDatabase(required: { snapshot: Buffer; moduleUrl: string; omittedMediaIds?: readonly string[] }, optional?: RebuildImportDatabaseOptions): Promise<TProjection>;
  tidyImportDatabases(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
  importWorkerLaunch(required: { moduleUrl: string }): { helper: string; execArgv: string[] };
}

/** Bind the import-database helper to one host's redactor, lock, limits, staging names and exit-code contract. */
export function createImportDatabase<TProjection extends { bytes: Buffer }>(required: { host: ImportDatabaseHost }, _optional = {}): ImportDatabase<TProjection> {
  const { host } = required;
  return {
    rebuildImportDatabase: (input, options = {}) => rebuildImportDatabase<TProjection>({ host, ...input }, options),
    tidyImportDatabases: () => tidyImportDatabases({ host }),
    importWorkerLaunch: ({ moduleUrl }) => importWorkerLaunch({ moduleUrl, helperStem: host.helperStem }),
  };
}
