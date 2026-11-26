import { reconcileRootKey } from "./reconcile.js";
import { atomicCreateSiteKeyFile as atomicCreate, moveSiteKeyFileAside as moveAside, installSiteKey as install } from "./files.js";
import type { SiteKeyEnsureAction } from "./decide.js";
import type { RootKeyRejection as SiteKeyRejection } from "../keyring.env.js";
import type { SiteKeySource } from "./material.js";
import type { createSiteKeySources } from "./sources.js";
import type { RuntimeMode } from "@jini-ai/core/contracts/site/core-runtime-mode";
import { join } from "node:path";

/**
 * @file Site-key plan (`ADS-memory/.local-artifacts/plan-site-key-2026-09-24.md`) §A.2 — the ONE
 * writer for a site's key file. The CLI's old `host site-key ensure` command
 * (`cli/commands/site-key.ts`) was absorbed into {@link ensureSiteKeyForBoot} and deleted outright
 * (Stage A3b, `abc4807d5`) — `planSiteKeyEnsure`/`SiteKeyEnsurePlan` (that command's own pure
 * decision table) went with it as dead code (site-key plan §A.6: zero callers once the CLI command
 * was gone). `findSiteKeyDependentData` (the per-site scan `ensureSiteKey` uses, on every storage
 * kind) lives in the host's dependent-data reader on the storage kernel; the admin site key
 * route imports it there, and the boot callers inject it here ({@link KeyDependentDataScan}), so
 * this feature never value-imports the host storage kernel.
 *
 * Purpose:
 * `ensureSiteKey` runs once per server boot, local mode only (A.2): a per-site file already there
 * and valid is a no-op; missing with an env/legacy-file key already in effect ADOPTS that exact
 * material into the per-site file (never re-keys, never orphans); missing with nothing anywhere
 * and no key-dependent data yet MINTS a fresh one; missing with key-dependent data already sealed
 * REFUSES rather than silently starting a new key nothing can decrypt with. Production is always a
 * no-op — it never had a per-site file to begin with (A.1's "why per-site rather than one key per
 * OS user"; A.3's "production never mints").
 *
 * The write itself is race-safe with no single-instance lock (A.2's "atomic write, safe with many
 * instances running at once"): a temp file is written and fsynced, then linked onto the final
 * path — `link(2)` refuses `EEXIST` atomically, so at most one process's bytes ever become the
 * file. Both the winner and every loser then read the FINAL file back rather than trusting their
 * own in-memory candidate, so two instances racing (one adopting, one minting) always converge on
 * the same key — see {@link atomicCreateSiteKeyFile}.
 *
 * Architectural role:
 * Configured domain writer. Depends on `keyring.env.ts` (shared hex validator and
 * fingerprint) and `site-key-sources.ts` (candidate ordering) — never the reverse: both keyrings
 * stay readers (`allowFileAutoGenerate: false`), and this module is the only place `randomBytes`
 * feeds a site key file. Nothing under `server/inbound/**` may import this module (site-key plan
 * §A.3) — Stage A3a's own wiring test enforces that; this file does not import anything from
 * `server/inbound` in either direction. The one request path that runs it, the admin site key
 * `generate` (2026-09-29), receives {@link ensureSiteKeyForSite} from the composition root, so a
 * request writes a key only by these same rules and never by a writer of its own.
 */

// ---------------------------------------------------------------------------
// ensureSiteKey — the per-site decision table and its one writer.
// ---------------------------------------------------------------------------

export function createSiteKeyEnsurer(required: {
  env: () => NodeJS.ProcessEnv;
  resolveRuntimeMode: (required: { env: NodeJS.ProcessEnv }) => RuntimeMode;
  home: () => string; cwd: () => string;
  siteKeySources: ReturnType<typeof createSiteKeySources>["siteKeySources"];
  readSiteKeySourceMaterial: ReturnType<typeof createSiteKeySources>["readSiteKeySourceMaterial"];
  readSiteMetaJson: ReturnType<typeof createSiteKeySources>["readSiteMetaJson"];
  resolveSiteKeyId: ReturnType<typeof createSiteKeySources>["resolveSiteKeyId"];
  resolveSiteKeyFingerprint: ReturnType<typeof createSiteKeySources>["resolveSiteKeyFingerprint"];
  findSiteKeyDependentData: KeyDependentDataScan;
  randomUUID: () => string; randomBytes: (size: number) => Buffer;
  metadataFilename: string; fields: { siteKeyId: string; fingerprint: string };
  buildSiteMetaForNewKey: (required: { dir: string; siteKeyId: string }) => Promise<object | undefined>;
  writeJsonFileAtomic: (required: { filePath: string; data: Record<string, unknown> }) => void;
  logBootError: (required: { siteDir: string; error: unknown }) => void;
  fs: Pick<typeof import("node:fs"), "chmodSync" | "closeSync" | "fsyncSync" | "linkSync" | "mkdirSync" | "openSync" | "readFileSync" | "renameSync" | "unlinkSync" | "writeFileSync" | "writeSync">;
  nowIso: () => string; pid: number; directoryMode: number; fileMode: number;
}, _optional = {}) {
  return {
    ensureSiteKey: (input: EnsureSiteKeyInput, _optional = {}) => ensureSiteKey({ input, config: required }),
    ensureSiteKeyForBoot: (input: EnsureSiteKeyForBootInput, _optional = {}) => ensureSiteKeyForBoot({ input, config: required }),
    ensureSiteKeyForSite: (input: EnsureSiteKeyForBootInput, _optional = {}) => ensureSiteKeyForSite({ input, config: required }),
    mintSiteKeyHex: (_required = {}, _optional = {}) => mintSiteKeyHex(required),
    installSiteKey: (input: InstallSiteKeyInput, _optional = {}) => installSiteKey({ input, config: required }),
    atomicCreateSiteKeyFile: (input: { filePath: string; hex: string }, _optional = {}) => atomicCreateSiteKeyFile({ ...input, config: required }),
  };
}

export interface EnsureSiteKeyInput {
  /** This site's own directory — only this site's store is scanned for key-dependent data (A.2:
   *  per-site keys), never every sibling site the way the CLI's `host site-key ensure` did. */
  readonly siteDir: string;
  /** `.site-meta.json`'s `siteKeyId` (A.1/A.4). */
  readonly siteKeyId: string;
  /** Defaults to {@link resolveRuntimeMode}. Test-injected so a suite never depends on the real
   *  host runtime-mode env var. */
  readonly mode?: RuntimeMode | undefined;
  /** Defaults to `config.env()`. Test-injected so a suite never touches real env vars. */
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Defaults to `config.home()`. Test-injected so a suite never touches the real the host home directory. */
  readonly home?: string | undefined;
  /** Defaults to `config.cwd()`. Only reaches {@link siteKeySources}'s production branch, which
   *  `ensureSiteKey` never takes (production is always `"production-noop"`) — kept for symmetry
   *  with {@link siteKeySources}'s own input shape and so a future caller has a real seam if that
   *  ever changes. */
  readonly cwd?: string | undefined;
}

/** the host's dependent-data reader's `findSiteKeyDependentData`: whether the site in `siteDir`
 *  holds data only the current key can open, on whichever storage it runs (SQLite, PGlite,
 *  Postgres, or a sealed `.storage-secret.json`), failing closed. Injected by the boot callers. */
export type KeyDependentDataScan = (required: { siteDir: string }) => Promise<boolean>;

export interface EnsureSiteKeyResult {
  readonly action: SiteKeyEnsureAction;
  /** Absent for `"production-noop"` — production has no per-site file to name. */
  readonly perSiteFilePath?: string;
  /** Present for `"noop"`, `"adopt"`, `"mint"`, and `"mismatch"` — the fingerprint of the key
   *  ACTUALLY in the per-site file right now (site-key plan §A.2's fingerprint stamp reuses this
   *  same value). For `"mismatch"` this is the file's real fingerprint, never the stale value still
   *  sitting in `.site-meta.json` — see {@link reconcileSiteKeyFingerprint}. */
  readonly fingerprint?: string;
  /** Present for `"invalid"` — which {@link SiteKeyRejection} the offending material failed. */
  readonly reason?: SiteKeyRejection;
}

/**
 * The only writer of a site's key file (site-key plan §A.2). Safe to call on every boot: a valid
 * existing file is read, not rewritten, and the two write-producing outcomes (`"adopt"`, `"mint"`)
 * both go through {@link atomicCreateSiteKeyFile}'s race-safe create. A per-site file the stamp does
 * not name is replaced only when another source holds the stamped key, and is moved aside as a
 * backup first ({@link moveSiteKeyFileAside}), never deleted.
 *
 * @throws whatever the underlying `fs` calls throw for a path that exists but cannot be read
 *   (permissions, a torn file) — this function never swallows those into a wrong decision. The
 *   injected scan fails closed on an unreadable database instead of throwing.
 * @complexity O(1) fs/env reads plus the injected scan's cost, and only on the branches that need it.
 */
async function ensureSiteKey({ input, config }: { input: EnsureSiteKeyInput; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): Promise<EnsureSiteKeyResult> {
  const env = input.env ?? config.env();
  const mode = input.mode ?? config.resolveRuntimeMode({ env });

  if (mode === "production") {
    return { action: "production-noop" };
  }

  const { perSiteSource, otherSources } = splitPerSiteSource({ input, mode, env, config });
  const perSiteFilePath = perSiteSource.path;
  const result = await reconcileRootKey({ ports: {
    readPerSite: () => readRawSiteKeyMaterial({ source: perSiteSource, env, config }),
    get stampedFingerprint() { return config.resolveSiteKeyFingerprint({ siteDir: input.siteDir }); },
    others: otherSources.map(source => () => readRawSiteKeyMaterial({ source, env, config })),
    hasDependentData: () => config.findSiteKeyDependentData({ siteDir: input.siteDir }),
    moveAside: ({ expectedContent }) => { moveSiteKeyFileAside({ filePath: perSiteFilePath, expectedContent, config }); },
    createExclusive: ({ hex }) => atomicCreateSiteKeyFile({ filePath: perSiteFilePath, hex, config }),
    mint: () => mintSiteKeyHex(config),
    readStamp: () => {
      const meta = config.readSiteMetaJson({ siteDir: input.siteDir });
      if (meta === undefined) return { kind: "no-meta" };
      return { kind: "meta", fingerprint: meta[config.fields.fingerprint] as string | undefined,
        write: ({ fingerprint }) => writeFingerprintStamp({ siteDir: input.siteDir, meta, fingerprint, config }),
      };
    },
  } });
  return { action: result.action, perSiteFilePath, ...("reason" in result ? { reason: result.reason } : {}), ...("fingerprint" in result ? { fingerprint: result.fingerprint } : {}) };
}

/** `siteKeySources` for this site, split into its per-site file and every OTHER source.
 *  @throws {Error} No per-site candidate — `siteKeySources` drops it for an unsafe `siteKeyId`. */
function splitPerSiteSource(required: {
  input: EnsureSiteKeyInput;
  mode: RuntimeMode;
  env: NodeJS.ProcessEnv;
  config: Parameters<typeof createSiteKeyEnsurer>[0];
}): { perSiteSource: SiteKeySource & { path: string }; otherSources: SiteKeySource[] } {
  const { input, mode, env, config } = required;
  const home = input.home ?? config.home();
  const cwd = input.cwd ?? config.cwd();
  const sources = config.siteKeySources({ mode, env, home, cwd, siteKeyId: input.siteKeyId });
  const perSiteSource = sources.find((source): source is SiteKeySource & { path: string } => source.kind === "per-site-file");
  if (!perSiteSource) {
    // Invariant guard, not a real runtime branch: `siteKeyId` is always passed above, and
    // `siteKeySources` always includes a per-site candidate when one is given.
    throw new Error("ensureSiteKey: siteKeySources did not return a per-site-file candidate for a given siteKeyId");
  }
  return { perSiteSource, otherSources: sources.filter((source) => source.kind !== "per-site-file") };
}

export interface EnsureSiteKeyForBootInput {
  /** This site's own directory — same meaning as {@link EnsureSiteKeyInput.siteDir}. */
  readonly siteDir: string;
  readonly mode?: RuntimeMode | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly home?: string | undefined;
  readonly cwd?: string | undefined;
}

/**
 * Site-key plan §A3a's actual boot-path call site: the host boot entry points call
 * this, not {@link ensureSiteKey} directly, so neither has to resolve `siteKeyId` itself. Resolves it
 * from `siteDir`'s own `.site-meta.json` via {@link resolveSiteKeyId} and, only when that succeeds,
 * calls through to {@link ensureSiteKey}.
 *
 * A `siteDir` with NO `.site-meta.json` at all is not a hypothetical: the default `sites/<name>/`
 * directory `index.ts` boots (`npm start`/`npm run dev`) is deliberately never given one — it is not
 * a `host init`/`host serve <dir>` install directory (`content-db-schema-guard.ts`'s own header).
 * Before this fix that meant exactly that site's key was silently never ensured — no error, no log
 * line, and every later admin request just quietly found no key. Local mode now closes that gap
 * itself: an ABSENT `.site-meta.json` gets a brand-new one ({@link
 * mintMinimalSiteMetaJson}) carrying a fresh `siteKeyId` — complete when the db already has
 * migrations to derive a schema stamp from, key-only otherwise ({@link mintSiteMetaForBootIfAbsent})
 * — then boot proceeds exactly as it would have for a site that already had one. Production never does this (A.1/A.3: production
 * never mints a site identity any more than it mints a key) — a `siteDir` with no meta file in
 * production keeps its pre-site-key env/legacy-file-only behavior, exactly as before this feature
 * existed. A `.site-meta.json` that EXISTS but cannot be parsed (corrupt, oversized, not an object)
 * is a different case — {@link resolveSiteKeyId} already treats that as "no per-site candidate", and
 * this function must never paper over a corrupt file by replacing it with a fresh one; only a
 * genuinely absent file is ever minted (see {@link mintMinimalSiteMetaJson}'s own exclusive-create
 * guard).
 *
 * The whole boot-time attempt — minting the meta file, and {@link ensureSiteKey}'s own key-file
 * write — is wrapped in one try/catch (2026-09-24 fix): a boot whose the host home directory (or equivalent) cannot
 * be written must still start the server. `ensureSiteKey` itself deliberately keeps its own
 * never-swallow contract (its own `@throws` doc) for a caller that wants to fail loudly; this
 * function is the boot-path wrapper specifically, and a boot-time key failure is exactly the class
 * of thing `site-key-boot-notice.ts` exists to surface at the terminal, not crash the process over —
 * the admin status route already reports a missing key the same way it does for any other reason one
 * was never created.
 *
 * @throws never — every failure below (meta-mint or the underlying `ensureSiteKey` write) is caught,
 *   logged once, and reported as `undefined`, the same "nothing to give a caller" result as a siteDir
 *   with no resolvable `siteKeyId` at all.
 * @complexity O(1) fs read for `resolveSiteKeyId`, plus at most one more small fs write
 *   ({@link mintMinimalSiteMetaJson}), plus {@link ensureSiteKey}'s own cost when it runs.
 */
async function ensureSiteKeyForBoot({ input, config }: { input: EnsureSiteKeyForBootInput; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): Promise<EnsureSiteKeyResult | undefined> {
  try {
    return await ensureSiteKeyForSite({ input, config });
  } catch (err) {
    // Boot must never go down over this — see this function's own header. `console.error` (not the
    // `warn`-level line `site-key-boot-notice.ts` prints moments later on the same terminal) so an
    // operator can tell "the key mechanism itself failed" apart from "no key happens to exist yet".
    config.logBootError({ siteDir: input.siteDir, error: err });
    return undefined;
  }
}

/**
 * {@link ensureSiteKeyForBoot} without its catch: resolves (or, in local mode, mints) this site's
 * `siteKeyId`, then runs {@link ensureSiteKey}. Also the admin site key route's `generate`, injected
 * by the composition root (the host composition root) so that route mints, adopts and
 * refuses by exactly the rules boot uses rather than a second writer of its own.
 *
 * @returns `undefined` when no `siteKeyId` resolves (production with no meta file, or a meta file
 *   that exists but is unreadable).
 * @throws whatever {@link ensureSiteKey} or the meta-file mint throws.
 * @complexity Same as {@link ensureSiteKeyForBoot}.
 */
async function ensureSiteKeyForSite({ input, config }: { input: EnsureSiteKeyForBootInput; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): Promise<EnsureSiteKeyResult | undefined> {
  const env = input.env ?? config.env();
  const mode = input.mode ?? config.resolveRuntimeMode({ env });
  const siteKeyId = config.resolveSiteKeyId({ siteDir: input.siteDir }) ?? (await mintSiteMetaForBootIfAbsent({ siteDir: input.siteDir, mode, config }));
  if (!siteKeyId) return undefined;
  return ensureSiteKey({ input: {
    siteDir: input.siteDir,
    siteKeyId,
    mode,
    env,
    home: input.home,
    cwd: input.cwd,
  }, config });
}

/** A fresh 32-byte site key as 64 hex characters — the key "Start fresh" installs when no working
 *  key is present. Lives here so this module stays the one place a site key is generated.
 *  @complexity O(1). */
function mintSiteKeyHex(config: Parameters<typeof createSiteKeyEnsurer>[0], _optional = {}): string {
  return config.randomBytes(32).toString("hex");
}

export interface InstallSiteKeyInput {
  readonly siteDir: string;
  /** The key to install — a pasted old token already proven to open this site's data, or the key
   *  "Start fresh" keeps or mints. */
  readonly hex: string;
  readonly mode?: RuntimeMode | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly home?: string | undefined;
  readonly cwd?: string | undefined;
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
function installSiteKey({ input, config }: { input: InstallSiteKeyInput; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): InstallSiteKeyResult | undefined {
  return install({ ...input, resolveInstallSources: () => resolveInstallSources({ input, config }), readSiteKeySourceMaterial: config.readSiteKeySourceMaterial,
    moveSiteKeyFileAside: request => moveSiteKeyFileAside({ ...request, config }), atomicCreateSiteKeyFile: request => atomicCreateSiteKeyFile({ ...request, config }), stampFingerprint: request => stampFingerprint({ ...request, config }),
    invalidKeyError: reason => new Error(`installSiteKey: not a valid site key (${reason})`),
    noFileError: () => new Error("installSiteKey: this site has no key file to write"),
    concurrentWriteError: () => new Error("installSiteKey: another process wrote a different key at the same moment; nothing was stamped"),
  });
}

/** This site's ordered sources for {@link installSiteKey} (a missing local meta file is minted), or
 *  `undefined` when no `siteKeyId` resolves in local mode. */
function resolveInstallSources({ input, config }: { input: InstallSiteKeyInput; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): { env: NodeJS.ProcessEnv; sources: SiteKeySource[] } | undefined {
  const env = input.env ?? config.env();
  const mode = input.mode ?? config.resolveRuntimeMode({ env });
  const siteKeyId = config.resolveSiteKeyId({ siteDir: input.siteDir }) ?? mintSiteKeyIdIfAbsent({ siteDir: input.siteDir, mode, config });
  if (mode !== "production" && !siteKeyId) return undefined;
  return { env, sources: config.siteKeySources({ mode, env, home: input.home ?? config.home(), cwd: input.cwd ?? config.cwd(), siteKeyId }) };
}

function stampFingerprint({ siteDir, fingerprint, config }: { siteDir: string; fingerprint: string; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): void {
  const meta = config.readSiteMetaJson({ siteDir });
  if (meta === undefined || meta[config.fields.fingerprint] === fingerprint) return;
  writeFingerprintStamp({ siteDir, meta, fingerprint, config });
}

/** Writes `meta` back with `siteKeyFingerprint` set — atomically, every other field kept. */
function writeFingerprintStamp(
  { siteDir, meta, fingerprint, config }: { siteDir: string; meta: Record<string, unknown>; fingerprint: string; config: Parameters<typeof createSiteKeyEnsurer>[0] },
  _optional = {}
): void {
  config.writeJsonFileAtomic({ filePath: join(siteDir, config.metadataFilename), data: { ...meta, [config.fields.fingerprint]: fingerprint } });
}

/**
 * `.site-meta.json` has no `siteKeyId` (or `siteId`) to resolve at all — for local mode only, mints
 * a brand-new, minimal `.site-meta.json` carrying just a fresh `siteKeyId`, and returns it. Never
 * called in production (checked by the caller before reaching this function) and never touches a
 * `siteDir` whose `.site-meta.json` already exists in ANY form, parseable or not — see
 * {@link mintMinimalSiteMetaJson}'s own doc for why.
 *
 * @complexity O(1) — one `randomUUID`, one attempted exclusive file create.
 */
function mintSiteKeyIdIfAbsent({ siteDir, mode, config }: { siteDir: string; mode: RuntimeMode; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): string | undefined {
  if (mode === "production") return undefined;
  const siteKeyId = config.randomUUID();
  return mintMinimalSiteMetaJson({ siteDir, siteKeyId, content: { [config.fields.siteKeyId]: siteKeyId }, config });
}

/**
 * {@link mintSiteKeyIdIfAbsent} for the boot path, which can wait on a db read: when the site's
 * `content.db` already has migrations applied, the minted file is a COMPLETE `.site-meta.json`
 * (`buildSiteMetaForNewKey` — schema stamp derived from the db, `siteId` = the fresh `siteKeyId`), so
 * `host serve`/the desktop accept the folder straight away. With no migrated db yet (a brand-new dev
 * site: the composition creates it after this runs) it falls back to the key-only shape, because
 * minting nothing would leave this boot without a site key; the dev boot completes that file once
 * the db is migrated (the host boot entry point).
 *
 * @complexity O(m) in the bundled journal's entry count (one read-only db open), plus one exclusive
 *   file create.
 */
async function mintSiteMetaForBootIfAbsent(
  { siteDir, mode, config }: { siteDir: string; mode: RuntimeMode; config: Parameters<typeof createSiteKeyEnsurer>[0] },
  _optional = {}
): Promise<string | undefined> {
  if (mode === "production") return undefined;
  const siteKeyId = config.randomUUID();
  const complete = await config.buildSiteMetaForNewKey({ dir: siteDir, siteKeyId });
  return mintMinimalSiteMetaJson({ siteDir, siteKeyId, content: complete ?? { [config.fields.siteKeyId]: siteKeyId }, config });
}

/**
 * Creates `<siteDir>/.site-meta.json` holding `content` — either just the fresh `siteKeyId`, or the
 * complete meta {@link mintSiteMetaForBootIfAbsent} derived for it — EXCLUSIVELY (`flag:
 * "wx"` — fails atomically with `EEXIST` if anything is already there) — race-safe the same way
 * {@link atomicCreateSiteKeyFile} is, and for the identical reason (site-key plan §A.2's "no
 * single-instance lock": this owner runs many local instances of the same site at once). Never
 * overwrites, never merges into, never repairs an existing file, however corrupt or incomplete —
 * "preserve anything present" means exactly that: the moment ANY `.site-meta.json` exists at
 * `siteDir`, this function's job is already done (or was never its job at all), and it must not
 * guess at what a caller who wrote that file intended.
 *
 * On `EEXIST` (this call lost a boot race against another instance, or — vanishingly unlikely given
 * the caller already checked — a file appeared between that check and this write) reads back
 * whatever is now on disk via {@link resolveSiteKeyId} rather than trusting its own candidate,
 * exactly the "both winner and loser converge on the same reality" rule {@link
 * atomicCreateSiteKeyFile} documents for the key file itself. That real file may turn out to have no
 * resolvable id at all (e.g. the winner's own write raced a THIRD process that got there first with
 * a corrupt file) — this function reports that honestly as `undefined` rather than minting a SECOND
 * file the first write already made unnecessary.
 *
 * The file is key-only because this runs before the db is opened, so no schema stamp can be
 * derived yet. It does not stay that way: the boot completes it once the db is migrated
 * (the host's key-only metadata completion, called from its boot entry points), keeping
 * the `siteKeyId` minted here.
 *
 * @returns the minted (or, on a lost race, the already-present) `siteKeyId`, or `undefined` when
 *   neither this call's own write nor a re-read of an existing file resolves to one.
 * @throws whatever `writeFileSync` throws other than `EEXIST` (permissions, a missing/non-directory
 *   parent, disk full) — this function does not itself decide what a write failure means; its one
 *   caller, {@link ensureSiteKeyForBoot}, is the boot-time safety net that catches it.
 * @complexity O(1) — one `randomUUID`, one attempted exclusive file write.
 */
function mintMinimalSiteMetaJson(
  { siteDir, siteKeyId, content, config }: { siteDir: string; siteKeyId: string; content: object; config: Parameters<typeof createSiteKeyEnsurer>[0] },
  _optional = {}
): string | undefined {
  const metaPath = join(siteDir, config.metadataFilename);
  try {
    config.fs.writeFileSync(metaPath, JSON.stringify(content, null, 2), { flag: "wx", mode: config.fileMode });
    return siteKeyId;
  } catch (err) {
    if (!isErrorCode({ err, code: "EEXIST" })) throw err;
    return config.resolveSiteKeyId({ siteDir });
  }
}

/** {@link decideLocalSiteKeyEnsure}'s input from a raw {@link parseSiteKeyHex} result (or
 *  `undefined` for "nothing there"). */
function moveSiteKeyFileAside(required: { filePath: string; expectedContent: string; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): string | undefined {
  return moveAside({ ...required, fs: required.config.fs, nowIso: required.config.nowIso, randomHex: ({ bytes }) => required.config.randomBytes(bytes).toString("hex"), fileMode: required.config.fileMode });
}

function atomicCreateSiteKeyFile(required: { filePath: string; hex: string; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): string {
  return atomicCreate({ ...required, fs: required.config.fs,
    pid: required.config.pid, randomHex: ({ bytes }) => required.config.randomBytes(bytes).toString("hex"), directoryMode: required.config.directoryMode, fileMode: required.config.fileMode });
}

function isErrorCode({ err, code }: { err: unknown; code: "EEXIST" | "ENOENT" }, _optional = {}): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  return (err as { code?: unknown }).code === code;
}

function readRawSiteKeyMaterial({ source, env, config }: { source: SiteKeySource; env: NodeJS.ProcessEnv; config: Parameters<typeof createSiteKeyEnsurer>[0] }, _optional = {}): string | undefined {
  return config.readSiteKeySourceMaterial({ source, env })?.raw;
}
