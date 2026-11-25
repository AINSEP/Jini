import fs from "node:fs";
import path from "node:path";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import type { ImportedExtensionState } from "./import-plugin-state.js";
import { liveThemeTrees, restoreDestination, type ThemeManifestFindings } from "./import-restore-placement.js";
import { unrecognisedThemes } from "./import-keep-off.js";
import type { VerifiedSiteImport } from "./import-verifier.js";
import type { SiteSavedKeysPort } from "./saved-keys-port.js";

/**
 * @file The staged-import restore: persists a verified import into a private stage, then (at the
 * lifecycle's pre-commit point) places it into the new site. The archive path rules, theme
 * validation, plugin lifecycle, content database and fallback-theme lookup are the host's and are
 * injected through {@link ImportRestoreHost}; what stays on, what is quarantined and what is set
 * aside is decided here.
 */

/** The host's archive path rules: which runtime path belongs to which code unit, and the notices for it. */
export interface ImportRestoreArchivePaths {
  /** The code unit that holds every override file. */
  readonly overridesUnit: string;
  /** The code unit of one runtime path; `undefined` for data and originals. */
  archiveCodeUnit(required: { path: string }, optional?: Record<string, never>): string | undefined;
  /** Plain-word notices for edited units. */
  editedArchiveWarnings(required: { units: Iterable<string> }, optional?: Record<string, never>): string[];
  /** Plain-word notices for units kept switched off. */
  keptOffArchiveWarnings(required: { units: Iterable<string> }, optional?: Record<string, never>): string[];
}

/** What {@link ImportRestoreHost.keepImportedCodeOff} receives; `K` is the host's content-database handle. */
export interface ImportKeepOffRequest<K> {
  readonly dbPath: string;
  readonly fallback: string;
  readonly liveThemes: ReadonlySet<string>;
  readonly unrecognised: ReadonlySet<string>;
  readonly setAside: boolean;
  readonly openContent: (required: { filePath: string }) => K;
}

/**
 * The host values the restore needs and the package must not import. Every field is REQUIRED.
 * `K` is the host's opened content-database handle, handed through untouched.
 */
export interface ImportRestoreHost<K> {
  readonly archivePaths: ImportRestoreArchivePaths;
  /** The host's fallback theme id; never replaced by an imported theme of the same id. */
  fallbackThemeId(): string;
  /** Reads every staged static/declarative `theme.json` with the host theme checks. */
  inspectThemeManifests(required: { root: string; files: readonly string[] }, optional?: Record<string, never>): ThemeManifestFindings;
  /** Private roots plus exclusive files, with the host's share path policy applied. */
  writeExclusive(required: { root: string; relative: string; bytes: Buffer }, optional?: Record<string, never>): void;
  /** Seeds this install's code, then applies imported activation choices; returns the files it placed itself. */
  restoreImportedPluginState(
    required: { root: string; dir: string; layout: AgentPluginLayout; state: ImportedExtensionState; files: readonly string[] },
    optional?: { sourceRoot?: string | undefined },
  ): Promise<ReadonlySet<string>>;
  /** The step that decides what stays on in the new database; returns plain-word notices. */
  keepImportedCodeOff(required: ImportKeepOffRequest<K>, optional?: Record<string, never>): Promise<string[]>;
}

/** Inputs of {@link ImportRestore.restoreStagedImport}. */
export interface RestoreStagedImportRequest<K> {
  readonly root: string;
  readonly dir: string;
  readonly dbPath: string;
  readonly siteId?: string;
  readonly savedKeys?: Pick<SiteSavedKeysPort, "restore">;
  readonly pluginLayout: AgentPluginLayout;
  readonly openContent: (required: { filePath: string }) => K;
}

/** Optional inputs of {@link ImportRestore.restoreStagedImport}. */
export interface RestoreStagedImportOptions {
  readonly pluginSourceRoot?: string;
  readonly savedKeysPassword?: string;
  readonly signal?: AbortSignal;
}

/** The three staged-import operations, bound to a host. */
export interface ImportRestore<K> {
  stageVerifiedImport(required: { root: string; verified: VerifiedSiteImport }, optional?: Record<string, never>): void;
  restoreStagedImport(required: RestoreStagedImportRequest<K>, optional?: RestoreStagedImportOptions): Promise<void>;
  stagedImportWarnings(required: { root: string }, optional?: Record<string, never>): string[];
}

/**
 * Binds the staged-import restore to a host's archive rules, theme checks, plugin lifecycle and
 * content database.
 * @returns `stageVerifiedImport`, `restoreStagedImport` and `stagedImportWarnings`.
 * @complexity O(1) wiring; each returned function documents its own cost.
 */
export function createImportRestore<K>({ host }: { host: ImportRestoreHost<K> }, _optional = {}): ImportRestore<K> {
  /** Persist only verified, freshly projected data; the stage is private and never served. */
  function stageVerifiedImport(required: { root: string; verified: VerifiedSiteImport }, _options: Record<string, never> = {}): void {
    fs.mkdirSync(required.root, { mode: 0o700 });
    host.writeExclusive({ root: required.root, relative: "database/content.db", bytes: required.verified.database });
    for (const [relative, bytes] of required.verified.files) host.writeExclusive({ root: required.root, relative, bytes });
    if (required.verified.encryptedKeys) host.writeExclusive({ root: required.root, relative: ".saved-keys.json", bytes: required.verified.encryptedKeys });
    const keptOff = keptOffUnits({ root: required.root, verified: required.verified });
    fs.writeFileSync(path.join(required.root, ".archive-state.json"), JSON.stringify({ plugins: required.verified.plugins, trustedPlugins: required.verified.trustedPlugins, modified: [...required.verified.modified], keptOff, warnings: required.verified.warnings }), { flag: "wx", mode: 0o600 });
    fs.writeFileSync(path.join(required.root, ".inventory.json"), JSON.stringify([...required.verified.files.keys()]), { flag: "wx", mode: 0o600 });
  }

  /**
   * Staged code units this install does not recognise, so restore keeps them switched off: every
   * plugin, skill, override and theme tree except live static/declarative themes, trusted agent
   * plugins, and edited units (those already carry their own notice). Reads the staged theme
   * manifests, so it runs after the files are written.
   * @complexity O(files + staged theme validation).
   */
  function keptOffUnits(required: { root: string; verified: VerifiedSiteImport }): string[] {
    const files = [...required.verified.files.keys()];
    const live = liveThemeTrees({ files, findings: host.inspectThemeManifests({ root: required.root, files }) });
    const recognised = new Set([...required.verified.modified, ...required.verified.trustedPlugins.map(plugin => "agent-plugins/" + plugin.id)]);
    const units = new Set(files.map(file => stagedCodeUnit({ file, live })));
    return [...units].filter((unit): unit is string => unit !== undefined && !recognised.has(unit));
  }

  /** The code unit of one staged (runtime-path) file; `undefined` for data, originals and live themes. */
  function stagedCodeUnit(required: { file: string; live: ReadonlySet<string> }): string | undefined {
    const theme = /^themes\/([^/]+)\/([^/]+)\//.exec(required.file);
    if (theme) return theme[1] === "__original-themes__" || required.live.has(theme[1] + "/" + theme[2]) ? undefined : "themes/" + theme[2];
    if (required.file.startsWith("overrides/")) return host.archivePaths.overridesUnit;
    return host.archivePaths.archiveCodeUnit({ path: required.file });
  }

  /** Init's pre-commit restore port. Untrusted extensions never enter a discovery/activation root.
   * Static/declarative theme trees are eligible only when the whole tree contains supported assets;
   * executable themes and overrides remain preserved under the unserved quarantine directory.
   * @complexity O(files + bytes), capped by the verified inventory (2,000 entries/300 MiB).
   */
  async function restoreStagedImport(required: RestoreStagedImportRequest<K>, optional: RestoreStagedImportOptions = {}): Promise<void> {
    const files = JSON.parse(fs.readFileSync(path.join(required.root, ".inventory.json"), "utf8")) as string[];
    const state = JSON.parse(fs.readFileSync(path.join(required.root, ".archive-state.json"), "utf8")) as ImportedExtensionState;
    const findings = host.inspectThemeManifests({ root: required.root, files });
    const liveThemes = liveThemeTrees({ files, findings });
    for (const id of liveThemes) if (state.modified.includes("themes/" + id.split("/").at(-1))) liveThemes.delete(id);
    const fallback = host.fallbackThemeId();
    const unrecognised = unrecognisedThemes({ root: required.root, dir: required.dir, files, liveThemes });
    // This site's own fallback theme is never replaced: the archive's copy is set aside and the site keeps rendering with a real theme.
    const setAside = unrecognised.delete(fallback);
    if (setAside) liveThemes.delete("static/" + fallback), liveThemes.delete("declarative/" + fallback);
    for (const id of liveThemes) fs.rmSync(path.join(required.dir, "themes", id), { recursive: true, force: true });
    // Copy the freshly rebuilt database, never the archived SQLite bytes. Exclusive creation and
    // init's DB-path resolver protect both in-site and app-data placement from overwriting a site.
    fs.copyFileSync(path.join(required.root, "database/content.db"), required.dbPath, fs.constants.COPYFILE_EXCL);
    const placedMemory = await host.restoreImportedPluginState({ root: required.root, dir: required.dir, layout: required.pluginLayout, state, files }, { sourceRoot: optional.pluginSourceRoot });
    placeFiles({ required, files, placedMemory, liveThemes, compiledSources: findings.compiledSources });
    addStagedWarnings({ root: required.root, notices: await host.keepImportedCodeOff({ dbPath: required.dbPath, fallback, liveThemes, unrecognised, setAside, openContent: required.openContent }) });
    await restoreOptionalSavedKeys(required, optional);
  }

  /** Writes each staged file that has a live or quarantine destination; plugin-state files already placed are skipped. */
  function placeFiles(required: { required: { root: string; dir: string }; files: readonly string[]; placedMemory: ReadonlySet<string>; liveThemes: ReadonlySet<string>; compiledSources: ReadonlyMap<string, string> }): void {
    for (const file of required.files) {
      if (required.placedMemory.has(file)) continue;
      const destination = restoreDestination({ file, liveThemes: required.liveThemes, compiledSources: required.compiledSources });
      if (destination !== null) host.writeExclusive({ root: required.required.dir, relative: destination, bytes: fs.readFileSync(path.join(required.required.root, file)) });
    }
  }

  /** Optional keys never prevent an otherwise valid site from being created. The adapter owns
   * authentication, validation and atomic recipient writes; error details must never reach notices.
   */
  async function restoreOptionalSavedKeys(required: { root: string; dir: string; dbPath: string; siteId?: string; savedKeys?: Pick<SiteSavedKeysPort, "restore"> }, optional: { savedKeysPassword?: string; signal?: AbortSignal }): Promise<void> {
    const file = path.join(required.root, ".saved-keys.json");
    if (!fs.existsSync(file)) return;
    // restore() already turns every non-abort failure into a fixed notice.
    const notices = required.savedKeys && required.siteId
      ? (await required.savedKeys.restore({ encryptedKeys: fs.readFileSync(file), ...(optional.savedKeysPassword === undefined ? {} : { password: optional.savedKeysPassword }), siteId: required.siteId, dir: required.dir, dbPath: required.dbPath }, optional.signal === undefined ? {} : { signal: optional.signal })).notices
      : ["Saved keys were left out because their restore service was unavailable."];
    addStagedWarnings({ root: required.root, notices });
  }

  /** Merge notices into the private stage state that `stagedImportWarnings` reads. O(notices). */
  function addStagedWarnings(required: { root: string; notices: readonly string[] }): void {
    if (!required.notices.length) return;
    const stateFile = path.join(required.root, ".archive-state.json");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    fs.writeFileSync(stateFile, JSON.stringify({ ...state, warnings: [...new Set([...(state.warnings ?? []), ...required.notices])] }), { mode: 0o600 });
  }

  /** Read bounded safe notices and extension warnings from the private functional stage. */
  function stagedImportWarnings(required: { root: string }, _optional = {}): string[] {
    const file = path.join(required.root, ".archive-state.json");
    if (!fs.existsSync(file)) return [];
    const state = JSON.parse(fs.readFileSync(file, "utf8")) as ImportedExtensionState & { warnings?: string[] };
    return [...new Set([...(state.warnings ?? []), ...host.archivePaths.editedArchiveWarnings({ units: state.modified }), ...host.archivePaths.keptOffArchiveWarnings({ units: state.keptOff ?? [] })])];
  }

  return { stageVerifiedImport, restoreStagedImport, stagedImportWarnings };
}
