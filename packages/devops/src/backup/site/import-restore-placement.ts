import fs from "node:fs";
import path from "node:path";

/**
 * @file Where each staged import file may land: the live site, or the unserved
 * `.import-quarantine/` tree. Untrusted extensions never enter a discovery/activation root.
 */

/** The manifest's `build` exactly as staged; its fields are re-checked before use. */
export type CompiledBuild = { readonly sourceDir?: unknown; readonly source?: unknown; readonly [key: string]: unknown };

/**
 * Host rules the placement cannot own: the theme owner's build/artifact validation and the share path
 * policy. Methods (not properties) so a host function with a narrower parameter type is accepted.
 */
export interface ImportPlacementChecks {
  /** Problems with a compiled build's `sourceDir`; empty when contained. */
  checkSourceDirContainment(required: { build: CompiledBuild; schemaVersion: number }): readonly unknown[];
  /** The theme owner's artifact validation; `status: "invalid"` quarantines. */
  loadTheme(required: { themeDir: string; id: string; source: "site" }): { readonly status: string };
  /** The share path policy; throws on an unsafe path. */
  validateSharePath(required: { path: string }): void;
}

/** Theme ids (`<tier>/<name>`) to quarantine, and each compiled theme's authored-source prefix. */
export interface ThemeManifestFindings {
  readonly quarantinedThemes: ReadonlySet<string>;
  readonly compiledSources: ReadonlyMap<string, string>;
}

/** A quarantine verdict carries its reason in plain words, so the held-back re-check can say why. */
type ThemeManifestVerdict = { kind: "plain" } | { kind: "quarantine"; problem: string } | { kind: "compiled"; sourcePrefix: string };
const PLAIN: ThemeManifestVerdict = { kind: "plain" };
const quarantine = (problem: string): ThemeManifestVerdict => ({ kind: "quarantine", problem });
const UNREADABLE = quarantine("Its theme.json could not be read or checked.");
const BAD_BUILD = quarantine("Its built files did not pass the theme checks.");

const THEME_MANIFEST = /^themes\/((?:__original-themes__\/)?(?:static|declarative))\/([^/]+)\/theme.json$/;
const THEME_FILE = /^themes\/((?:__original-themes__\/)?(?:static|declarative))\/([^/]+)\/(.+)$/;
const THEME_ID = /^themes\/((?:__original-themes__\/)?(?:static|declarative)\/[^/]+)\//;
const STATIC_ASSETS = [
  /\.(?:html?|css|m?js|json|webmanifest|xml|liquid|map|png|jpe?g)$/i,
  /\.(?:gif|webp|avif|svg|ico|woff2?|ttf|otf|txt|md|mp4|webm|pdf)$/i,
];

/**
 * Reads every staged static/declarative `theme.json`: a tier that disagrees with its folder, an
 * unreadable manifest, or an unsafe/invalid compiled build quarantines the theme.
 * @complexity O(themes × theme validation).
 */
export function inspectThemeManifests(required: { root: string; files: readonly string[]; checks: ImportPlacementChecks }): ThemeManifestFindings {
  const quarantinedThemes = new Set<string>();
  const compiledSources = new Map<string, string>();
  for (const file of required.files) {
    const match = THEME_MANIFEST.exec(file);
    if (!match) continue;
    const id = match[1] + "/" + match[2];
    const verdict = inspectThemeManifest({ root: required.root, file, tier: match[1]!, name: match[2]!, checks: required.checks });
    if (verdict.kind === "quarantine") quarantinedThemes.add(id);
    if (verdict.kind === "compiled") compiledSources.set(id, verdict.sourcePrefix);
  }
  return { quarantinedThemes, compiledSources };
}

function inspectThemeManifest(required: { root: string; file: string; tier: string; name: string; checks: ImportPlacementChecks }): ThemeManifestVerdict {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(required.root, required.file), "utf8"));
    const folderTier = required.tier.split("/").at(-1);
    if (manifest.tier !== folderTier) return quarantine(`Its theme.json says it is a ${String(manifest.tier)} theme, but it sits in the ${folderTier} folder.`);
    if (manifest.build?.source !== "compiled") return PLAIN;
    return inspectCompiledTheme({ root: required.root, id: required.tier + "/" + required.name, name: required.name, manifest, checks: required.checks });
  } catch { return UNREADABLE; }
}

/** @throws whatever the share path policy or theme loader throws; the caller quarantines on it. */
function inspectCompiledTheme(required: { root: string; id: string; name: string; manifest: { tier: unknown; build: CompiledBuild }; checks: ImportPlacementChecks }): ThemeManifestVerdict {
  const { build } = required.manifest;
  const { checks } = required;
  if (required.manifest.tier !== "static" || typeof build.sourceDir !== "string" || checks.checkSourceDirContainment({ build, schemaVersion: 2 }).length) return BAD_BUILD;
  // A trailing '/' is an empty segment, so this refusal also guarantees `sourcePrefix` below.
  checks.validateSharePath({ path: build.sourceDir });
  // The theme owner treats compiled output as static, never as a server code tier. Reuse its
  // artifact validation; preserve authored build source ONLY in the quarantine tree.
  const theme = checks.loadTheme({ themeDir: path.join(required.root, "themes", required.id), id: required.name, source: "site" });
  if (theme.status === "invalid") return BAD_BUILD;
  return { kind: "compiled", sourcePrefix: "themes/" + required.id + "/" + build.sourceDir + "/" };
}

/**
 * Every staged theme tree that may go live: all its files are supported static assets (compiled
 * source excepted) and its manifest was not quarantined.
 * @complexity O(files).
 */
export function liveThemeTrees(required: { files: readonly string[]; findings: ThemeManifestFindings }): Set<string> {
  const live = new Set<string>();
  const quarantined = new Set(required.findings.quarantinedThemes);
  for (const file of required.files) {
    const match = THEME_FILE.exec(file);
    if (!match) continue;
    const id = match[1] + "/" + match[2];
    live.add(id);
    // Browser JS is an ordinary static asset, unlike TS/JS modules in a code theme. The whole
    // tree is quarantined if it includes build source or declares a different executable tier.
    if (!isCompiledSource({ file, theme: id, compiledSources: required.findings.compiledSources }) && !isStaticAsset(match[3]!)) quarantined.add(id);
  }
  for (const id of quarantined) live.delete(id);
  return live;
}

function isStaticAsset(relative: string): boolean {
  return STATIC_ASSETS.some(pattern => pattern.test(relative));
}

/**
 * Why one theme tree would be held back by import, in plain words; empty when import would place
 * it live. The verdict comes from {@link inspectThemeManifests} + {@link liveThemeTrees} themselves
 * (one source of truth); the words only explain it. Unlike import, authored build source is a
 * problem here: import keeps it in quarantine even for a live compiled theme, and a restore moves
 * the whole folder.
 * @param required.root folder holding `themes/<id>/...`; `files` are root-relative.
 * @param required.checks the host theme/path rules (see {@link ImportPlacementChecks}).
 * @complexity O(files), plus one manifest read (and a theme load for a compiled build).
 */
export function explainThemeTree(required: { root: string; id: string; files: readonly string[]; checks: ImportPlacementChecks }): string[] {
  const { root, id, files, checks } = required;
  const findings = inspectThemeManifests({ root, files, checks });
  const problems = themeTreeProblems({ root, id, files, findings, checks });
  if (!liveThemeTrees({ files, findings }).has(id) && !problems.length) problems.push("It did not pass the import safety checks.");
  return problems;
}

function themeTreeProblems(required: { root: string; id: string; files: readonly string[]; findings: ThemeManifestFindings; checks: ImportPlacementChecks }): string[] {
  const { root, id, files, findings, checks } = required;
  const manifest = "themes/" + id + "/theme.json";
  const slash = id.lastIndexOf("/");
  const problems: string[] = [];
  if (!files.includes(manifest)) problems.push("It has no theme.json file.");
  else if (findings.quarantinedThemes.has(id)) {
    const verdict = inspectThemeManifest({ root, file: manifest, tier: id.slice(0, slash), name: id.slice(slash + 1), checks });
    if (verdict.kind === "quarantine") problems.push(verdict.problem);
  }
  const relative = files.map(file => file.slice(("themes/" + id + "/").length));
  const source = new Set(files.filter(file => isCompiledSource({ file, theme: id, compiledSources: findings.compiledSources })));
  const unsupported = relative.filter((file, index) => !source.has(files[index]!) && !isStaticAsset(file));
  if (source.size) problems.push(`It includes its build source (${source.size} ${source.size === 1 ? "file" : "files"}), which is never placed live.`);
  if (unsupported.length) problems.push(`It holds files that are not plain web files: ${unsupported.slice(0, 5).join(", ")}${unsupported.length > 5 ? ` and ${unsupported.length - 5} more` : ""}.`);
  return problems;
}

function isCompiledSource(required: { file: string; theme: string; compiledSources: ReadonlyMap<string, string> }): boolean {
  const prefix = required.compiledSources.get(required.theme);
  return prefix !== undefined && required.file.startsWith(prefix);
}

/**
 * The site-relative destination of one staged file, or `null` when it is never restored.
 * Uploads and live theme files keep their path; everything else lands under `.import-quarantine/`.
 */
export function restoreDestination(required: { file: string; liveThemes: ReadonlySet<string>; compiledSources: ReadonlyMap<string, string> }): string | null {
  const { file } = required;
  if (file === "settings.json") return null; // Init regenerates host config and fresh identity.
  if (file.startsWith("uploads/")) return file;
  const theme = THEME_ID.exec(file)?.[1];
  const live = theme !== undefined && required.liveThemes.has(theme) && !isCompiledSource({ file, theme, compiledSources: required.compiledSources });
  return live ? file : ".import-quarantine/" + file;
}

/** Private roots plus exclusive files prevent extraction through pre-existing links or aliases.
 * @param required.validatePath the host share path policy, run before the containment guard.
 */
export function writeExclusive(required: { root: string; relative: string; bytes: Buffer; validatePath: (required: { path: string }) => void }, _optional: Record<string, never> = {}): void {
  required.validatePath({ path: required.relative });
  const target = path.resolve(required.root, required.relative);
  if (!target.startsWith(path.resolve(required.root) + path.sep)) throw new Error("Import path escaped staging");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, required.bytes, { flag: "wx", mode: 0o600 });
}
