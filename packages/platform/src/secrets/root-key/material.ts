import { parseRootKeyHex as parseSiteKeyHex, fingerprintRootKeyHex as fingerprintSiteKeyHex, type ParsedRootKeyHex as ParsedSiteKeyHex, type RootKeyStatus as SiteKeyStatus, type RootKeyReveal as SiteKeyReveal } from "../keyring.env.js";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

export interface SiteKeySource { readonly kind: string; readonly path?: string }
/**
 * One {@link SiteKeySource}'s raw material from `env`/the filesystem — `undefined` when that source
 * has none. The ONE place both `keyring.env.ts`'s `EnvOrFileKeyring.resolveSiteKeyFromSources` and
 * `site-key-ensure.ts`'s `ensureSiteKey` read a source's material, so the "a blank env var counts
 * as unset" rule below can never drift between the two (it did, briefly — A3a found it duplicated
 * and inconsistent, each side reading the env case slightly differently).
 *
 * A env-kind source whose var IS set but blank or whitespace-only is treated as ABSENT, not
 * present-but-invalid: `development/scripts/start.mjs`'s own `clearBlankSiteKeyEnv` exists for the
 * exact same reason — a spawned child (the desktop app's own boot path) can pass a blank value
 * through, and an operator's shell profile can just as easily `export TOVU_SITE_KEY=` with nothing
 * after it. Either way the var must fall through to the next source exactly as if it had never been
 * set, not be reported as a broken/invalid key. A file-kind source's content is NOT trimmed or
 * blank-checked here — a real file that exists and is empty is a genuinely broken on-disk state
 * ({@link parseSiteKeyHex}'s own `"empty"` rejection), distinct from an env var nobody set a value
 * for.
 *
 * @complexity O(1) env read, or one `existsSync` plus a file read for a file-kind source.
 */
export interface SiteKeySourceMaterial { readonly raw: string; readonly envVarName?: string }


/**
 * `.site-meta.json`'s raw parsed object under `siteDir`, or `undefined` when the file is missing,
 * unreadable, not valid JSON, or not a JSON object. The one shared parse every field-specific
 * reader in this module ({@link resolveSiteKeyId}, {@link resolveSiteKeyFingerprint}) builds on, so
 * a corrupt-file/non-object verdict can never drift between them — and the one
 * `site-key-ensure.ts`'s own fingerprint-stamp reconciliation imports (site-key plan §A.4), since
 * that module depends on this one, never the reverse (this file's own header).
 *
 * Never throws — same never-throws contract every reader built on it shares.
 *
 * @complexity O(1) — one small, bounded-size file read.
 */
export function readSiteMetaJson({ filePath, readFileSync }: { filePath: string; readFileSync: (filePath: string, encoding: "utf8") => string }, _optional = {}): Record<string, unknown> | undefined {
  const raw = orFallbackSync({ work: () => readFileSync(filePath, "utf8"), fallback: undefined, step: "Read site key metadata" });
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}


export function readSiteKeySourceMaterial(
  { source, env, fs, resolveSiteKeyEnv }: { source: SiteKeySource; env: Record<string, string | undefined>; fs: { existsSync(path: string): boolean; readFileSync(path: string, encoding: "utf8"): string }; resolveSiteKeyEnv: (required: { env: Record<string, string | undefined> }) => { kind: "ok"; value: string; varName: string } | { kind: "absent" } },
  _optional: Record<string, never> = {},
): SiteKeySourceMaterial | undefined {
  if (source.kind === "env") {
    const resolved = resolveSiteKeyEnv({ env });
    return resolved.kind === "ok" ? { raw: resolved.value, envVarName: resolved.varName } : undefined;
  }
  return source.path !== undefined && fs.existsSync(source.path) ? { raw: fs.readFileSync(source.path, "utf8") } : undefined;
}


/** The first source in `sources` that has ANY material — present-but-invalid still counts and
 *  stops the scan (site-key plan §A.2: adopting silently past a broken source would still be
 *  wrong, the same reasoning `keyring.env.ts`'s own env-then-file resolution already follows). */
export function findFirstPresentMaterial({ sources, env, readRawSiteKeyMaterial }: { sources: readonly SiteKeySource[]; env: Record<string, string | undefined>; readRawSiteKeyMaterial: (source: SiteKeySource, env: Record<string, string | undefined>) => string | undefined }, _optional = {}): string | undefined {
  for (const source of sources) {
    const raw = readRawSiteKeyMaterial(source, env);
    if (raw !== undefined) return raw;
  }
  return undefined;
}
/** The first source in the list holding ANY material, with that material's verdict. */
interface PresentSiteKey {
  readonly source: SiteKeySource;
  readonly material: SiteKeySourceMaterial;
  readonly parsed: ParsedSiteKeyHex;
}

/** Status/reveal share the first-present rule with derivation. Never mint, never cache, never
 * silently skip a broken source: that could select a key the operator did not intend.
 * @complexity O(sources), with one small env/file read per attempted source.
 */
function firstPresentSiteKey(input: { sources: readonly SiteKeySource[]; env: Record<string, string | undefined>; readSiteKeySourceMaterial: InspectSiteKeyMaterialOptions["readSiteKeySourceMaterial"] }, _optional = {}): PresentSiteKey | undefined {
  for (const source of input.sources) {
    const material = input.readSiteKeySourceMaterial({ source, env: input.env });
    if (material !== undefined) return { source, material, parsed: parseSiteKeyHex({ raw: material.raw }) };
  }
  return undefined;
}


export interface InspectSiteKeyMaterialOptions {
  sources: readonly SiteKeySource[];
  env: () => Record<string, string | undefined>;
  siteKeyFilePathFrom: (required: { sources: readonly SiteKeySource[] }) => string | undefined;
  readSiteKeySourceMaterial: (required: { source: SiteKeySource; env: Record<string, string | undefined> }) => SiteKeySourceMaterial | undefined;
}

/**
 * Read-only snapshot over the same explicit sources derivation uses. Re-read on every call so
 * status and recovery never report cached material. A present invalid source refuses resolution;
 * it never falls through to another key. Nothing here generates, replaces or repairs a file.
 */
export function inspectSiteKeyMaterial(options: InspectSiteKeyMaterialOptions, _optional = {}): SiteKeyStatus {
  const { hex: _hex, ...status } = readSiteKeyReveal(options);
  return status;
}

/** One read behind both status functions; {@link inspectSiteKeyMaterial} drops `hex` from it. */
function readSiteKeyReveal(options: InspectSiteKeyMaterialOptions, _optional = {}): SiteKeyReveal {
  // No write target for a local site with unreadable metadata; legacy shared files are read-only.
  const keyFilePath = options.siteKeyFilePathFrom({ sources: options.sources }) ?? "";
  const present = firstPresentSiteKey({ sources: options.sources, env: options.env(), readSiteKeySourceMaterial: options.readSiteKeySourceMaterial });
  return siteKeyRevealOf({ present, keyFilePath });
}

/** The reveal shape (key order is part of the HTTP response) for whatever source is present;
 *  `envVarName` only for the env source. The `invalid`/`reason` pair both status functions spread
 *  onto an inactive result — present together or not at all. */
function siteKeyRevealOf(input: { present: PresentSiteKey | undefined; keyFilePath: string }): SiteKeyReveal {
  const { present, keyFilePath } = input;
  if (present === undefined) return { active: false, source: "none", keyFilePath };
  const source = present.source.kind === "env" ? "env" : "file";
  const provenance = present.source.kind === "env" ? { envVarName: present.material.envVarName } : {};
  if (present.parsed.ok) {
    return { active: true, source, hex: present.parsed.hex, fingerprint: fingerprintSiteKeyHex({ hex: present.parsed.hex }), keyFilePath, ...provenance };
  }
  return { active: false, source, invalid: true, reason: present.parsed.reason, keyFilePath, ...provenance };
}

/**
 * Like {@link inspectSiteKeyMaterial}, but includes the raw key value when one is active — backs
 * the admin "site key" panel's explicit, permission-gated Reveal action (owner: "i want that
 * token to be visible to admins or else when it breaks they have no idea whats going on" —
 * fingerprint-only was the ORIGINAL brief; this supersedes it). Never called on page load, only
 * from a dedicated route the operator must click through — see `server/inbound/admin-http/routes/
 * system/site-key.ts`'s `POST .../reveal`.
 *
 * Reads whichever source is currently active (env or file, same precedence as `resolveSiteKey`),
 * so an admin can confirm the value in this UI matches what they set in their host's secrets/their shell,
 * not only the file-backed case.
 */
export function revealSiteKeyMaterial(options: InspectSiteKeyMaterialOptions, _optional = {}): SiteKeyReveal {
  return readSiteKeyReveal(options);
}



/**
 * This site's own id from its `.site-meta.json`: `siteId` (a randomUUID minted by init-site), else
 * the first-boot `siteKeyId` (the boot completes the file with `siteId` = that same id, so the name
 * holds across that first restart). Undefined when the file is missing or holds neither. Shared by
 * the server's site identity (`deps.ts`'s `siteIdentityFor`) and `host deploy config`, which carries
 * it to the deployed server as `TOVU_SITE_ID`, so both name the same site the same way.
 * @complexity O(1), one small file read.
 */
export function readSiteMetaId({ siteDir, readSiteMetaJson, idField, fallbackIdField }: { siteDir: string; readSiteMetaJson: (required: { siteDir: string }) => Record<string, unknown> | undefined; idField: string; fallbackIdField: string }, _optional = {}): string | undefined {
  const meta = readSiteMetaJson({ siteDir });
  const id = typeof meta?.[idField] === "string" && meta[idField] !== "" ? meta[idField] : meta?.[fallbackIdField];
  return typeof id === "string" && id !== "" ? id : undefined;
}

