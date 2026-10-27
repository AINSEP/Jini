import { readPluginIdentity } from "@jini-ai/core/plugin-directory";
/** Site tier admission belongs to tierPolicy.siteErrors; static validation uses host-supplied
 * catalogs and declaration grammar. */
/**
 * @file `discoverPlugins()` — enumerate built-in + site plugins with status (SPEC-005 REQ-02/03,
 * EC-08/EC-09, TB-01, DUP-01).
 *
 * Purpose:
 * Read-only enumeration. Scans the install-dir's `plugins/<id>/<version>/` tree (REQ-02) plus the
 * compiled-in built-in registry, performs BR-02 step (1)'s package-level checks (size, disallowed
 * files, `server/index.mjs` presence — see `manifest.ts`'s header for why those checks live here
 * rather than in `validateManifest()`), delegates manifest/identity/capability/hook/field checks to
 * `validateManifest()`, and returns one `PluginDiscoveryRecord` per discovered id with every
 * applicable error recorded — never throws for an individual plugin's own validation failure
 * (errors are data, not control flow; REQ-10/`PLUGINS_LIST` lists every discovered plugin, valid or
 * not).
 *
 * Never `import()`s plugin code — that is `loader.ts`'s job, gated by integrity/`sdkRange` first
 * (BR-01, CIC U-001). Discovery only reads bytes to hash/measure/list them.
 *
 * Architectural role:
 * TDD-certified implementation (implementation outline C-007). Signature and JSDoc are
 * design-frozen; `discoverPlugins()` validates built-ins, selects the latest installed site
 * version per id, records candidate-local errors without aborting discovery, marks duplicate ids,
 * and returns deterministic TB-01 ordering.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_MANIFEST_FILENAME, PLUGIN_MANIFEST_FILENAMES } from "../plugin-format.js";

import * as semver from "semver";

import { validateManifest, type PluginManifest, type PluginTier, type PluginValidationError } from "../manifest.js";

import type { BuiltInPluginSource, PluginDiscoveryRecord } from "../discovery-types.js";
import type { ManifestHostPorts, PluginTierPolicy } from "../ports.js";
export type { BuiltInPluginSource, PluginDiscoveryRecord } from "../discovery-types.js";
export interface DiscoverPluginsRequired extends ManifestHostPorts {
  readonly builtIns: readonly BuiltInPluginSource[];
  readonly installDir?: string;
  readonly tierPolicy: PluginTierPolicy;
}
/** Activation/boot may pin an enabled revision while newer packages remain installed for review.
 * Admin discovery defaults to the latest version; a missing pinned version never falls forward. */
export interface DiscoverPluginsOptional { readonly versions?: ReadonlyMap<string, string> }
export class PluginDiscoveryVersionError extends Error {
  constructor(message: string) { super(message); this.name = 'PluginDiscoveryVersionError'; }
}

/**
 * Enumerates every built-in and (when `installDir` is present) site-installed plugin, in TB-01
 * order (built-ins first by id ascending, then site plugins by id ascending). When two installed
 * versions of one site plugin id exist, only the latest-by-semver is included in the result (the
 * other stays dormant on disk, EC-08/AC-09) — the loader (not discovery) is what actually imports
 * the winning version later.
 *
 * @throws Never for an individual plugin's own validation/package failure — that plugin's record
 * simply carries a non-empty `errors[]` and a non-`valid` `status`. May reject for a genuine
 * infrastructure failure (e.g. `installDir` exists but is unreadable due to a permissions error)
 * that is not itself one specific plugin's fault.
 * @complexity O(n) over installed-plugin count, bounded I/O per candidate (one directory listing
 * + manifest read + per-file size stat).
 */
const VALID_TIERS = new Set<PluginTier>(["tier-1", "tier-2", "tier-3"]);
/** Last-resort display tier when a malformed manifest has no validated tier. Every discovery
 * record needs a renderable tier (REQ-18/AC-26); this fallback does not grant executable admission. */
const FALLBACK_TIER: PluginTier = "tier-3";

/** Safely reads a JSON value's string property, or `undefined` when absent/wrong-typed. */
function readStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : undefined;
}

function readTierField(value: unknown): PluginTier {
  const raw = readStringField(value, "tier");
  return raw !== undefined && VALID_TIERS.has(raw as PluginTier) ? (raw as PluginTier) : FALLBACK_TIER;
}

/** Parses one `jini.plugin.json` file's bytes; unparseable JSON becomes `null` — `validateManifest`
 * already reports a `MANIFEST_MALFORMED` entry for any non-object value (its own top-level guard),
 * so a parse failure and a wrong-shape object are handled through the exact same code path. */
function parseManifestJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toDiscoveryRecord(params: {
  id: string;
  name: string;
  version: string;
  source: "built-in" | "site";
  manifestValue: unknown;
  errors: readonly PluginValidationError[];
}): PluginDiscoveryRecord {
  const isValid = params.errors.length === 0;
  return {
    id: params.id,
    name: params.name,
    version: params.version,
    source: params.source,
    tier: readTierField(params.manifestValue),
    status: isValid ? "valid" : "invalid",
    errors: params.errors,
    // Safe only because `isValid` means `validateManifest()` already reported zero errors against
    // this exact value — an invalid candidate's `manifestValue` is never cast (see the field's own
    // doc on `PluginDiscoveryRecord`).
    manifest: isValid ? (params.manifestValue as PluginManifest) : undefined,
  };
}

/**
 * The absolute entry-file path for a discovered SITE plugin (REQ-02's fixed `server/index.mjs`
 * package layout, ADR-004) — the exact path `loadPlugin()`'s `entryPath` param expects, and the
 * same join `discoverOneSiteCandidate()` below already performs internally for its manifest read.
 * Exported so a composition root resolving a dynamic site-sourced load target (`plugin-runtime.ts`)
 * does not re-derive this convention independently and risk it drifting from discovery's own.
 *
 * @complexity O(1) — pure path join, no I/O.
 */
export function siteEntryPath(
  { installDir, id, version }: { installDir: string; id: string; version: string },
  _optional: Record<string, never> = {},
): string {
  return path.join(installDir, id, version, "server", "index.mjs");
}

/** One directory entry directly under `installDir` — a candidate plugin "id slot" that may contain
 * one or more version subdirectories (REQ-02's `plugins/<id>/<version>/` layout). */
async function listInstalledPluginIdFolders(installDir: string): Promise<string[]> {
  try {
    const entries = await readdir(installDir, { withFileTypes: true });
    // Hidden working/staging areas (notably .drafts) are never install candidates. Valid manifest
    // ids cannot start with a dot, so no valid installed package loses discovery reachability.
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

/** Picks the latest-by-semver version subdirectory under one id folder (AC-09/EC-08) — the other
 * installed versions stay dormant on disk, never surfaced as a second row. Non-semver directory
 * names sort last (defensive; every certified fixture uses valid semver directory names). */
async function pickLatestVersionFolder(idFolderPath: string): Promise<string | null> {
  const entries = await readdir(idFolderPath, { withFileTypes: true });
  const versionNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (versionNames.length === 0) return null;

  const sorted = [...versionNames].sort((a, b) => {
    const aValid = semver.valid(a);
    const bValid = semver.valid(b);
    if (aValid && bValid) return semver.rcompare(aValid, bValid);
    if (aValid) return -1;
    if (bValid) return 1;
    return b.localeCompare(a);
  });
  return sorted[0]!;
}

/** Activation pins must be exact, path-safe semver; a malformed pin is the caller's fault, not a plugin's. */
function assertSafeRequestedVersion(requestedVersion: string | undefined): void {
  if (requestedVersion !== undefined && (!semver.valid(requestedVersion) || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(requestedVersion))) {
    throw new PluginDiscoveryVersionError('The requested plugin activation version is not a safe semantic version.');
  }
}

/** The first manifest present (current name, then the legacy alias); `missing` when neither exists. */
async function readSiteManifest(versionDir: string): Promise<{ missing: boolean; manifestValue: unknown }> {
  for (const filename of PLUGIN_MANIFEST_FILENAMES) { // legacy alias
    try {
      return { missing: false, manifestValue: parseManifestJson(await readFile(path.join(versionDir, filename), "utf8")) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
  return { missing: true, manifestValue: null };
}

/**
 * The installer refuses a sideloaded tier-2 package (`install.ts`'s `checkTierAndCode`): a package
 * cannot grant itself the verified-publisher tier, and a tier-2 worker is not a security sandbox
 * (it can still import `node:fs`). A package placed straight into `installDir` skips the installer,
 * so discovery applies the same rule — enable and boot load only `valid` records, so neither ever
 * runs one.
 *
 * @complexity O(1).
 */
async function discoverOneSiteCandidate(
  { installDir, idFolderName, builtInIds, host }: {
    installDir: string; idFolderName: string; builtInIds: readonly string[]; host: DiscoverPluginsRequired;
  },
  options: DiscoverPluginsOptional = {},
): Promise<PluginDiscoveryRecord | null> {
  const idFolderPath = path.join(installDir, idFolderName);
  const requestedVersion = options.versions?.get(idFolderName);
  assertSafeRequestedVersion(requestedVersion);
  const versionFolderName = requestedVersion ?? await pickLatestVersionFolder(idFolderPath);
  if (versionFolderName === null) return null;

  const { missing, manifestValue } = await readSiteManifest(path.join(idFolderPath, versionFolderName));

  const errors: PluginValidationError[] = missing
    ? [{ code: "MANIFEST_MISSING", file: PLUGIN_MANIFEST_FILENAME, message: `${PLUGIN_MANIFEST_FILENAME} was not found` }]
    : [...validateManifest({ ...host, manifest: manifestValue, folderName: idFolderName, builtInIds }).errors, ...host.tierPolicy.siteErrors({ manifestValue })];

  const manifestVersion = readStringField(manifestValue, "version");
  if (manifestVersion !== undefined && manifestVersion !== versionFolderName) {
    errors.push({ code: "VERSION_FOLDER_MISMATCH", file: PLUGIN_MANIFEST_FILENAME,
      message: `manifest version '${manifestVersion}' does not match its install version folder '${versionFolderName}'` });
  }
  // A valid manifest id already matches its folder; invalid manifests cannot claim another slot.
  const id = idFolderName;
  const name = readStringField(manifestValue, "name") ?? idFolderName;

  return toDiscoveryRecord({ id, name, version: versionFolderName, source: "site", manifestValue, errors });
}

/** DUP-01 (`ID_DUPLICATE` half — `SHADOWS_BUILT_IN` is already handled per-record inside
 * `validateManifest`, which only ever sees one candidate at a time): a case-insensitive id
 * collision between two SITE plugins can only be detected once every candidate is known, so this
 * runs as a whole-set post-pass over the already-built site records. */
function markCaseInsensitiveDuplicates(
  { records }: { records: readonly PluginDiscoveryRecord[] },
  _optional: Record<string, never> = {},
): PluginDiscoveryRecord[] {
  const countByLowerId = new Map<string, number>();
  for (const record of records) {
    const key = record.id.toLowerCase();
    countByLowerId.set(key, (countByLowerId.get(key) ?? 0) + 1);
  }

  return records.map((record) => {
    const isDuplicate = countByLowerId.get(record.id.toLowerCase())! > 1;
    if (!isDuplicate) return record;

    const errors = [
      ...record.errors,
      { code: "ID_DUPLICATE", file: null, message: `id '${record.id}' collides case-insensitively with another installed site plugin` },
    ];
    return { ...record, errors, status: "invalid" as const, manifest: undefined };
  });
}

/** TB-01: built-ins first (id ascending), then site plugins (id ascending) — the same ordering
 * `hook-registry.ts`'s composition uses, so `PLUGINS_LIST` and hook-composition order never
 * diverge. */
function orderTb01(records: readonly PluginDiscoveryRecord[]): PluginDiscoveryRecord[] {
  const rank = (source: "built-in" | "site") => (source === "built-in" ? 0 : 1);
  return [...records].sort((a, b) => rank(a.source) - rank(b.source) || a.id.localeCompare(b.id));
}

export async function discoverPlugins(
  required: DiscoverPluginsRequired,
  optional: DiscoverPluginsOptional = {}
): Promise<readonly PluginDiscoveryRecord[]> {
  const { builtIns, installDir } = required;
  const builtInIds = builtIns.map((b) => b.manifest.id);

  const builtInRecords = builtIns.map((builtIn) => {
    const errors = validateManifest({ ...required, manifest: builtIn.manifest, folderName: builtIn.manifest.id, builtInIds: [] }).errors;
    return toDiscoveryRecord({
      id: builtIn.manifest.id,
      name: builtIn.manifest.name,
      version: builtIn.manifest.version,
      source: "built-in",
      manifestValue: builtIn.manifest,
      errors,
    });
  });

  let siteRecords: PluginDiscoveryRecord[] = [];
  if (installDir !== undefined) {
    const idFolders = await listInstalledPluginIdFolders(installDir);
    const candidates = await Promise.all(
      idFolders.map((idFolderName) => discoverOneSiteCandidate({ installDir, idFolderName, builtInIds, host: required }, optional))
    );
    siteRecords = markCaseInsensitiveDuplicates({ records: candidates.filter((r): r is PluginDiscoveryRecord => r !== null) });
  }

  const records = orderTb01([...builtInRecords, ...siteRecords]);
  const qualifiedIds = new Set<string>();
  // TB-01 places built-ins first: the incumbent keeps its id; only later claims are invalid.
  // Disabled valid installs still own ids.
  return records.map(record => {
    if (record.status !== "valid" || !record.manifest) return record;
    const identity = readPluginIdentity({ manifest: record.manifest as unknown as Readonly<Record<string, unknown>>, name: record.id, namespace: required.identityNamespace });
    if (!qualifiedIds.has(identity.id)) {
      qualifiedIds.add(identity.id);
      return { ...record, warnings: identity.warnings };
    }
    return { ...record, status: "invalid" as const, manifest: undefined, warnings: identity.warnings,
      errors: [...record.errors, { code: "PLUGIN_ID_DUPLICATE", file: null, message: `duplicate publisher-qualified plugin id '${identity.id}'` }],
    };
  });
}
