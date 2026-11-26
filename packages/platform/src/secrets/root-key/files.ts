import { parseRootKeyHex as parseSiteKeyHex, fingerprintRootKeyHex as fingerprintSiteKeyHex, type RootKeyRejection } from "../keyring.env.js";
import { matchesFingerprint } from "./decide.js";
import type { SiteKeySource, SiteKeySourceMaterial } from "./material.js";
import { dirname, join, basename } from "node:path";


/**
 * Renames a wrong site key file to `<name>.wrong-<timestamp>` beside it (`0600`) so a key is never
 * lost, even one that turned out to be the wrong one. Only moves the file when it still holds
 * `expectedContent`: another instance that already replaced it must not have its fix moved aside.
 * A file already gone (another instance moved it first) is not an error.
 *
 * @returns the backup path, or `undefined` when nothing was moved.
 * @throws whatever `fs` throws other than `ENOENT`.
 * @complexity O(1) — one read, one rename, one chmod.
 */
export function moveSiteKeyFileAside(
  { filePath, expectedContent, fs, nowIso, randomHex, fileMode }: { filePath: string; expectedContent: string; fs: Pick<typeof import("node:fs"), "readFileSync" | "renameSync" | "chmodSync">; nowIso: () => string; randomHex: (required: { bytes: number }) => string; fileMode: number },
  _optional = {}
): string | undefined {
  const { readFileSync, renameSync, chmodSync } = fs;
  let current: string;
  try {
    current = readFileSync(filePath, "utf8");
  } catch (err) {
    if (isErrorCode({ err, code: "ENOENT" })) return undefined;
    throw err;
  }
  if (current !== expectedContent) return undefined;
  const stamp = nowIso().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.wrong-${stamp}-${randomHex({ bytes: 2 })}`;
  try {
    renameSync(filePath, backupPath);
  } catch (err) {
    if (isErrorCode({ err, code: "ENOENT" })) return undefined;
    throw err;
  }
  chmodSync(backupPath, fileMode);
  return backupPath;
}


/**
 * Writes `hex` to `filePath`, race-safe with no single-instance lock (site-key plan §A.2): write a
 * temp file in the same directory (`0600`, fsynced), then `linkSync` it onto `filePath` — `link(2)`
 * fails atomically with `EEXIST` if anything is already there, so at most one process's bytes ever
 * become the file. The loser's temp file is still removed; its `EEXIST` is swallowed, not
 * propagated. Both the winner and every loser then read `filePath` back and return THAT (never
 * their own `hex` argument), so two instances racing on the same `siteKeyId` always converge on
 * the one file that won, whichever process actually wrote it. Also the project key's publisher
 * (`server/runtime/composition/project-store.ts`), for the same race (web + desktop first start).
 *
 * @param required.filePath - the target `~/.tovu/site-keys/<id>.hex`. Its containing directory is created
 *   (`0700`) if missing.
 * @param required.hex - this call's own candidate key material, used only if no one else wins the race.
 * @returns the final file's content (trimmed) — always read from disk, never `hex` verbatim.
 * @throws whatever `fs` throws other than `EEXIST` from the `linkSync` step.
 * @complexity O(1) — a fixed number of syscalls, independent of `hex`'s length.
 */
export function atomicCreateSiteKeyFile({ filePath, hex, fs, pid, randomHex, directoryMode, fileMode }: {
  filePath: string; hex: string;
  fs: Pick<typeof import("node:fs"), "mkdirSync" | "openSync" | "writeSync" | "fsyncSync" | "closeSync" | "chmodSync" | "linkSync" | "unlinkSync" | "readFileSync">;
  pid: number; randomHex: (required: { bytes: number }) => string; directoryMode: number; fileMode: number;
}, _optional = {}): string {
  const { mkdirSync, openSync, writeSync, fsyncSync, closeSync, chmodSync, linkSync, unlinkSync, readFileSync } = fs;
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: directoryMode });
  const tmpPath = join(dir, `.${basename(filePath)}.tmp-${pid}-${randomHex({ bytes: 4 })}`);
  const fd = openSync(tmpPath, "w", fileMode);
  try {
    writeSync(fd, hex);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmpPath, fileMode);
  try {
    linkSync(tmpPath, filePath);
  } catch (err) {
    if (!isErrorCode({ err, code: "EEXIST" })) throw err;
    // Lost the race — another process's file is now canonical; fall through to read it back.
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Already gone (e.g. a concurrent cleanup of the same temp name) — nothing left to remove.
    }
  }
  return readFileSync(filePath, "utf8").trim();
}


/** Whether a failed fs call failed with exactly `code` (e.g. `EEXIST`: the target path was already
 *  taken), as opposed to a genuine I/O or permission fault that must keep propagating. Shared by
 *  {@link atomicCreateSiteKeyFile}'s `linkSync` and {@link mintMinimalSiteMetaJson}'s `writeFileSync(…,
 *  {flag:"wx"})` — both are "only the FIRST writer wins, everyone else reads the result back"
 *  primitives — and by {@link moveSiteKeyFileAside}'s `ENOENT` (another instance moved it first). */
function isErrorCode({ err, code }: { err: unknown; code: "EEXIST" | "ENOENT" }, _optional = {}): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  return (err as { code?: unknown }).code === code;
}

export interface InstallSiteKeyInput {
  readonly siteDir: string;
  readonly hex: string;
  readonly resolveInstallSources: (input: InstallSiteKeyInput) => { env: Record<string, string | undefined>; sources: SiteKeySource[] } | undefined;
  readonly readSiteKeySourceMaterial: (required: { source: SiteKeySource; env: Record<string, string | undefined> }) => SiteKeySourceMaterial | undefined;
  readonly moveSiteKeyFileAside: (required: { filePath: string; expectedContent: string }) => string | undefined;
  readonly atomicCreateSiteKeyFile: (required: { filePath: string; hex: string }) => string;
  readonly stampFingerprint: (required: { siteDir: string; fingerprint: string }) => void;
  readonly invalidKeyError: (reason: RootKeyRejection) => Error;
  readonly noFileError: () => Error;
  readonly concurrentWriteError: () => Error;
}

/** `installed`: the key file now holds `hex` and the stamp names it. `env-key-set`: an env var
 *  holding a DIFFERENT key outranks every file (production), so nothing was written. */
export type InstallSiteKeyResult =
  | { readonly outcome: "installed"; readonly keyFilePath: string; readonly fingerprint: string }
  | { readonly outcome: "env-key-set" };

/**
 * Makes `hex` this site's key — the site key tab's recovery writer (design §4.3/§4.6: "Unlock
 * with token", "Start fresh"). The caller has already decided `hex` is right; this only writes it.
 *
 * The target is the first key file in this site's source order (the per-site file locally, the
 * durable-volume file in production). An env var ahead of it that holds a different key would
 * outrank any file, so that is refused (`env-key-set`); one holding `hex` already is fine. A target
 * file holding a different key (or garbage) is moved aside as a backup, never deleted. Then
 * `.site-meta.json`'s `siteKeyFingerprint` is set to `hex`'s (other fields kept; a missing meta
 * file is minted locally, left alone in production).
 *
 * @returns `undefined` when no `siteKeyId` resolves in local mode (an unreadable meta file).
 * @throws {Error} `hex` is not a valid key (nothing written), or the file ends up holding another
 *   key (a concurrent writer won the race), or whatever `fs` throws.
 * @complexity O(n) in the (fixed-size) source list, plus a few small file reads/writes.
 */
export function installSiteKey(input: InstallSiteKeyInput, _optional = {}): InstallSiteKeyResult | undefined {
  const parsed = parseSiteKeyHex({ raw: input.hex });
  if (!parsed.ok) throw input.invalidKeyError(parsed.reason);
  const resolved = input.resolveInstallSources(input);
  if (resolved === undefined) return undefined;
  const target = { input, siteDir: input.siteDir, hex: parsed.hex, fingerprint: fingerprintSiteKeyHex({ hex: parsed.hex }) };

  for (const source of resolved.sources) {
    const installed = installIntoSource({ ...target, source, env: resolved.env });
    if (installed !== undefined) return installed;
  }
  throw input.noFileError();
}

interface InstallTarget {
  readonly input: InstallSiteKeyInput;
  readonly siteDir: string;
  readonly hex: string;
  readonly fingerprint: string;
}

/** One step of {@link installSiteKey}'s scan: an env source decides only when it holds material,
 *  a file source with a path is always the target; anything else is skipped (`undefined`). */
function installIntoSource(required: InstallTarget & { source: SiteKeySource; env: Record<string, string | undefined> }, _optional = {}): InstallSiteKeyResult | undefined {
  const { source, env, ...target } = required;
  if (source.kind === "env") return installAgainstEnvKey({ ...target, material: required.input.readSiteKeySourceMaterial({ source, env }) });
  if (source.path === undefined) return undefined;
  return installIntoKeyFile({ ...target, path: source.path, current: required.input.readSiteKeySourceMaterial({ source, env })?.raw });
}

/** An env var ahead of every key file: holding a DIFFERENT key it outranks any file, so nothing is
 *  written (`env-key-set`); holding `hex` already, only the stamp is set. */
function installAgainstEnvKey(required: InstallTarget & { material: SiteKeySourceMaterial | undefined }, _optional = {}): InstallSiteKeyResult | undefined {
  const { siteDir, fingerprint, material } = required;
  if (material === undefined) return undefined;
  if (!matchesFingerprint({ parsed: parseSiteKeyHex({ raw: material.raw }), fingerprint })) return { outcome: "env-key-set" };
  required.input.stampFingerprint({ siteDir, fingerprint });
  return { outcome: "installed", keyFilePath: `env:${material.envVarName}`, fingerprint };
}

/** Writes `hex` into the target key file, backing up a different (or garbage) one first. */
function installIntoKeyFile(required: InstallTarget & { path: string; current: string | undefined }, _optional = {}): InstallSiteKeyResult {
  const { siteDir, hex, fingerprint, path, current } = required;
  if (current !== undefined && !matchesFingerprint({ parsed: parseSiteKeyHex({ raw: current }), fingerprint })) required.input.moveSiteKeyFileAside({ filePath: path, expectedContent: current });
  const written = required.input.atomicCreateSiteKeyFile({ filePath: path, hex });
  if (fingerprintSiteKeyHex({ hex: written }) !== fingerprint) throw required.input.concurrentWriteError();
  required.input.stampFingerprint({ siteDir, fingerprint });
  return { outcome: "installed", keyFilePath: path, fingerprint };
}

