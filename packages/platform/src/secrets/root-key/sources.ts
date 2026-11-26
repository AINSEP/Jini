import { join } from "node:path";
import type { RuntimeMode } from "@jini-ai/core/contracts/site/core-runtime-mode";
import { readSiteMetaJson as readMeta, readSiteMetaId as readId, readSiteKeySourceMaterial as readMaterial, type SiteKeySource } from "./material.js";

type SiteKeySourcesInput = {
  readonly mode: RuntimeMode;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  readonly cwd: string;
  readonly siteKeyId?: string | undefined;
};

const SAFE_SITE_KEY_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Whether `id` can be used as a key-file name without escaping the configured site-key directory. */
export function isSafeSiteKeyId({ id }: { id: string }, _optional = {}): boolean {
  return SAFE_SITE_KEY_ID.test(id) && id !== "." && id !== "..";
}

const SITE_ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Whether a value may name a site: a UUID-like short token (letters, digits, `-`, `_`; at most 64).
 * A site id travels into provider signals and, through the host's deployment configuration command, into a generated config
 * file's env block, so a hand-edited or hostile `.site-meta.json` / the host's site-id env var (a newline, quotes,
 * a path) is refused rather than carried.
 * @complexity O(1) (bounded length).
 */
export function isSiteIdToken({ value }: { value: string }, _optional = {}): boolean {
  return SITE_ID_TOKEN.test(value);
}

export function createSiteKeySources(required: {
  envName: string; metadataFilename: string;
  fields: { siteId: string; siteKeyId: string; fingerprint: string };
  localSegments: readonly string[]; sharedSegments: readonly string[];
  volumeSegments: readonly string[]; legacyVolumeSegments: readonly string[];
  assertHomeIsolation: (required: { homeDir: string }) => void;
  fs: { existsSync(path: string): boolean; readFileSync(path: string, encoding: "utf8"): string };
}, _optional = {}) {
  const readSiteMetaJson = ({ siteDir }: { siteDir: string }, _optional = {}) => readMeta({ filePath: join(siteDir, required.metadataFilename), readFileSync: required.fs.readFileSync });
  const resolveSiteKeyEnv = ({ env }: { env: Record<string, string | undefined> }, _optional = {}): { kind: "ok"; value: string; varName: string } | { kind: "absent" } => {
    const value = env[required.envName]?.trim();
    return value ? { kind: "ok", value, varName: required.envName } : { kind: "absent" };
  };
  const boundResolveSiteKeyId = (input: { siteDir: string }, _optional = {}) => resolveSiteKeyId({ meta: readSiteMetaJson(input), fields: required.fields });
  const sourcesFor = (input: SiteKeySourcesInput, _optional = {}) => siteKeySources({ input, config: required });
  return {
    siteKeySources: sourcesFor, resolveSiteKeyEnv, readSiteMetaJson, resolveSiteKeyId: boundResolveSiteKeyId,
    siteKeyEnvOnlySources: (_required = {}, _optional = {}): SiteKeySource[] => [{ kind: "env" }],
    readSiteMetaId: (input: { siteDir: string }, _optional = {}) => readId({ siteDir: input.siteDir, readSiteMetaJson, idField: required.fields.siteId, fallbackIdField: required.fields.siteKeyId }),
    siteKeySourcesForSiteDir(input: Omit<SiteKeySourcesInput, "siteKeyId"> & { siteDir: string }, _optional = {}): SiteKeySource[] {
      const siteKeyId = boundResolveSiteKeyId({ siteDir: input.siteDir });
      return sourcesFor({ mode: input.mode, env: input.env, home: input.home, cwd: input.cwd, siteKeyId });
    },
    resolveSiteKeyFingerprint: (input: { siteDir: string }, _optional = {}) => resolveSiteKeyFingerprint({ meta: readSiteMetaJson(input), field: required.fields.fingerprint }),
    siteKeyFilePathFrom: ({ sources }: { sources: readonly SiteKeySource[] }, _optional = {}) => sources.find(source => source.kind === "per-site-file" || source.kind === "volume-file")?.path,
    readSiteKeySourceMaterial: (input: { source: SiteKeySource; env: Record<string, string | undefined> }, _optional = {}) => readMaterial({ source: input.source, env: input.env, fs: required.fs, resolveSiteKeyEnv }),
  };
}

/**
 * The ordered list of places to look for this site's key. Order is significant — the FIRST source
 * whose material resolves wins (site-key plan §A.2's "the per-site file wins over the env var").
 *
 * @complexity O(1) — a fixed-size list, no I/O.
 */
function siteKeySources({ input, config }: { input: SiteKeySourcesInput; config: Parameters<typeof createSiteKeySources>[0] }, _optional = {}): SiteKeySource[] {
  const envSource: SiteKeySource = { kind: "env" };
  if (input.mode === "production") {
    return [envSource, { kind: "volume-file", path: join(input.cwd, ...config.volumeSegments) }, { kind: "legacy-volume-file", path: legacyVolumeFilePath({ cwd: input.cwd, segments: config.legacyVolumeSegments }) }];
  }
  config.assertHomeIsolation({ homeDir: input.home });
  const sources: SiteKeySource[] = [];
  if (input.siteKeyId && isSafeSiteKeyId({ id: input.siteKeyId })) {
    sources.push({ kind: "per-site-file", path: perSiteFilePath({ home: input.home, siteKeyId: input.siteKeyId, segments: config.localSegments }) });
  }
  sources.push(envSource);
  sources.push({ kind: "legacy-shared-file", path: legacySharedFilePath({ home: input.home, segments: config.sharedSegments }) });
  return sources;
}

/**
 * This site's `siteKeyId` for {@link siteKeySources}, read straight from `.site-meta.json` — a
 * READ-ONLY helper (unlike `site-key-ensure.ts`'s `ensureSiteKey`), safe for a route under
 * `server/inbound/**` to import directly (site-key plan §A3a: nothing under that tree may import
 * `site-key-ensure.ts`, the one WRITER — this module stays the reader both sides can share).
 *
 * Stage A4 (not built yet) is what writes a distinct `siteKeyId` field into `.site-meta.json`; until
 * then every site's key is named after its `siteId` (A.1: "It defaults to siteId when missing"), so
 * a present `siteKeyId` field wins when both exist (forward-compatible with A4's write) and `siteId`
 * is the fallback otherwise.
 *
 * Never throws: a missing file, malformed JSON, or a non-string/empty field all resolve to
 * `undefined` — exactly the input {@link siteKeySources} already treats as "no per-site candidate",
 * so a site with no readable meta (a legacy or unrepaired install) falls back to its pre-site-key
 * env/legacy-file-only behavior rather than crashing a boot or an admin request.
 *
 * @complexity O(1) — one small, bounded-size file read (via {@link readSiteMetaJson}).
 */
function resolveSiteKeyId({ meta, fields }: { meta: Record<string, unknown> | undefined; fields: Parameters<typeof createSiteKeySources>[0]["fields"] }, _optional = {}): string | undefined {
  if (meta === undefined) return undefined;
  const keyId = meta[fields.siteKeyId];
  const id = typeof keyId === "string" && keyId.length > 0 ? keyId : meta[fields.siteId];
  // An unsafe id resolves to "no per-site key" (legacy readers only) rather than falling back to
  // `siteId`: a site whose `siteKeyId` was tampered with must not quietly switch to another key file.
  return typeof id === "string" && id.length > 0 && isSafeSiteKeyId({ id }) ? id : undefined;
}

/**
 * This site's stamped `siteKeyFingerprint` from `.site-meta.json` (site-key plan §A.4/§A.6) — a
 * READ-ONLY sibling of {@link resolveSiteKeyId}, same never-throws contract and same shared parse
 * ({@link readSiteMetaJson}). Backs the admin site key route's `"mismatch"` state: a valid key
 * resolving to a DIFFERENT fingerprint than this one means the physical key file was substituted
 * after the stamp was written (`site-key-ensure.ts`'s `ensureSiteKey` derives the identical
 * `"mismatch"` outcome for the write path from the same two values, via its own
 * `withFingerprintReconciliation` — this function is the read-only counterpart for a caller, like
 * the admin route, that must never write).
 *
 * @complexity O(1) — one small, bounded-size file read (via {@link readSiteMetaJson}).
 */
function resolveSiteKeyFingerprint({ meta, field }: { meta: Record<string, unknown> | undefined; field: string }, _optional = {}): string | undefined {
  if (meta === undefined) return undefined;
  const fingerprint = meta[field];
  return typeof fingerprint === "string" && fingerprint.length > 0 ? fingerprint : undefined;
}

/** the configured per-site key path — A.1's per-site local path. */
function perSiteFilePath({ home, siteKeyId, segments }: { home: string; siteKeyId: string; segments: readonly string[] }, _optional = {}): string {
  return join(home, ...segments, `${siteKeyId}.hex`);
}

/** the configured legacy shared key path — the one shared file every install had before per-site
 *  keys, still read (never written by a reader) as an adoption source. */
function legacySharedFilePath({ home, segments }: { home: string; segments: readonly string[] }, _optional = {}): string {
  return join(home, ...segments);
}

/** the configured legacy volume key path — the production durable-volume path
 *  (`keyring.env.ts`'s `defaultSiteKeyFilePath` production branch), reused here unchanged. */
function legacyVolumeFilePath({ cwd, segments }: { cwd: string; segments: readonly string[] }, _optional = {}): string {
  return join(cwd, ...segments);
}
