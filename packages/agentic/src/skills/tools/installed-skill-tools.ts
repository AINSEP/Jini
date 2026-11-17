/**
 * @module installed-skill-tools
 *
 * Registers each installed standalone Agent Skill (a folder holding `SKILL.md`) as ONE tool. Discovery
 * sees only the skill's own frontmatter `name`/`description`, and the description is indexed verbatim
 * (it is the author's trigger text). The handler returns the full `SKILL.md` and lists bundled
 * `references/`, `scripts/`, `assets/` files by path, never inlined (progressive disclosure). A bad
 * folder is skipped and reported, never fatal to the others; two folders whose names mint the same
 * tool id are a thrown error.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ToolInputError, buildDomainRegistrations, indexCatalogById, requireInputRecord, optionalString, type AgentToolSideEffect, type AgentToolDefinition, type DerivedRiskByToolId, type ToolHandler, type ToolMetadataById, type ToolRegistration } from '@jini-ai/core';

/** What a skill-file read returns: text, the readable supporting files, and an optional refusal note. */
export interface SkillFileReadResult {
  readonly text: string;
  readonly files: readonly string[];
  readonly note?: string;
}

/** Progressive-disclosure read of one skill folder; omit `file` for SKILL.md. */
export type SkillFileReadPort = (input: Record<string, never>, options?: { readonly file?: string }) => Promise<SkillFileReadResult>;

/** Host effects the loader needs. */
export interface InstalledSkillToolPorts {
  /** One frontmatter field of a SKILL.md, or `undefined`. */
  readonly readFrontmatterField: (required: { readonly markdown: string; readonly key: string }) => string | undefined;
  /** The supporting-file reader for one skill folder, contained to that folder. */
  readonly createFileReader: (required: { readonly skillRoot: string }) => { readonly read: SkillFileReadPort };
  /** Whether the skill folder is enabled in the host's install record. */
  readonly isEnabled: (required: { readonly directory: string }) => Promise<boolean>;
  /** Receives one line per skipped folder. */
  readonly report: (required: { readonly message: string }) => void;
}

/** Host values the registrations carry. */
export interface SkillToolRegistrationHost {
  readonly metadata: ToolMetadataById;
  /** Permission a principal needs to call a skill tool. */
  readonly permission: string;
  /** Module name recorded in the registration catalog. */
  readonly catalogModule: string;
  /** Name of the file-tool root the bundled paths are relative to. */
  readonly fileRoot: string;
  /** Applies the host's approval policy to installed guidance. */
  readonly withExtensionApprovalPolicy: (required: { registration: ToolRegistration; family: 'installed-guidance' }) => ToolRegistration;
}

/** One parsed skill's required frontmatter fields — `name` and `description` per the Agent Skills
 *  spec's stated minimum. Anything else a skill's frontmatter carries (`version`, `last_updated`,
 *  `allowed-tools`, ...) is not this loader's concern. */
interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
}

/**
 * Extracts `name:` and `description:` from a `SKILL.md`'s YAML frontmatter block through the injected
 * `readFrontmatterField` port (a folded/literal block scalar `description:` needs a real YAML parse,
 * not a regex over its marker line).
 *
 * @returns `undefined` when the file has no frontmatter block, or the block is missing either
 * required field — the caller treats that as "skip this folder" (see this file's header), never a
 * thrown error.
 * @complexity O(n) in the frontmatter block's own length.
 */
function parseSkillFrontmatter({ markdown, readFrontmatterField }: { markdown: string; readFrontmatterField: InstalledSkillToolPorts["readFrontmatterField"] }, _optional = {}): SkillFrontmatter | undefined {
  const name = readFrontmatterField({ markdown, key: "name" });
  const description = readFrontmatterField({ markdown, key: "description" });
  if (!name || !description) return undefined;

  return { name, description };
}

/** `skill_<sanitized name>`: the reserved prefix for standalone skill tools. Sanitizes more aggressively
 *  than a plugin tool id (which only folds hyphens): a skill's `name` frontmatter field is
 *  free-form author-supplied text, not a value already constrained by the Agent Plugins manifest name
 *  grammar, so every run of characters outside `[a-z0-9]` collapses to one underscore and any
 *  leading/trailing underscore is trimmed — the id stays a legal, predictable identifier regardless
 *  of what an author wrote.
 *  @returns `undefined` when sanitizing leaves nothing usable (e.g. a name made entirely of symbols)
 *  — the caller treats that the same as unparseable frontmatter: skip and warn. */
function toSkillToolId({ name }: { name: string }, _optional = {}): string | undefined {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return sanitized.length > 0 ? `skill_${sanitized}` : undefined;
}

/** The three optional bundled-content subdirectories the Agent Skills spec names. Order here is also
 *  the order {@link listBundledFiles} walks them in. */
const BUNDLED_SUBDIRS = ["references", "scripts", "assets"] as const;
type SkillBundledFileKind = (typeof BUNDLED_SUBDIRS)[number];

/** One bundled file, with a path relative to the host's file root (`fileRoot`). */
export interface SkillBundledFile {
  readonly kind: SkillBundledFileKind;
  readonly path: string;
}

/**
 * Recursively lists every file under one skill's `references/`, `scripts/`, and `assets/`
 * subdirectories — whichever exist. A missing subdirectory contributes nothing and is never an
 * error: the Agent Skills spec marks all three optional.
 *
 * @complexity O(f) in the total file count under the three subdirectories.
 */
async function listBundledFiles(input: { skillDir: string; siteDir: string }, _options = {}): Promise<readonly SkillBundledFile[]> {
  const files: SkillBundledFile[] = [];
  for (const kind of BUNDLED_SUBDIRS) {
    await walkFiles({ dir: path.join(input.skillDir, kind), onFile: (absolutePath) => {
      const relative = path.relative(input.siteDir, absolutePath).split(path.sep).join("/");
      if (relative && !relative.startsWith("../") && !path.isAbsolute(relative)) files.push({ kind, path: relative });
    } });
  }
  return files;
}

/** One directory's worth of recursion for {@link listBundledFiles}. A missing `dir` (the common case
 *  — most skills do not bundle all three subdirectories) is silently a no-op, not an error. Entries
 *  are visited in sorted order so the resulting file list is deterministic across filesystems. */
async function walkFiles({ dir, onFile }: { dir: string; onFile: (absolutePath: string) => void }, _optional = {}): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent({ error })) return;
    throw error;
  }
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles({ dir: entryPath, onFile });
    else if (entry.isFile()) onFile(entryPath);
    else {
      // Links and special entries are outside the skill file walk.
    }
  }
}

function isEnoent({ error }: { error: unknown }, _optional = {}): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

/** One installed standalone Agent Skill, fully resolved into a single tool-ready source. */
export interface InstalledSkillToolSource {
  readonly id: string;
  /** The skill's own frontmatter `name`, unsanitized — carried through for handler output and error
   *  messages; {@link id} is the sanitized, tool-safe derivative of this value. */
  readonly skillName: string;
  /** The skill's own frontmatter `description`, verbatim: discovery indexes the author's own trigger text. */
  readonly description: string;
  /** The full `SKILL.md` file content, frontmatter included; the handler returns the exact file. */
  readonly markdown: string;
  readonly bundledFiles: readonly SkillBundledFile[];
  /** Deferred reader keeps the host path private while all assistant surfaces can load references. */
  readonly readFile?: SkillFileReadPort;
  readonly directory?: string;
}

/** Human-readable reason a skill folder's `SKILL.md` could not be read — split out of
 *  {@link resolveSkillEntry} so its nested "missing vs. unreadable" ternary lives in its own function
 *  rather than adding two nested-ternary steps to that function's own complexity count. */
function describeSkillMdReadFailure({ error }: { error: unknown }, _optional = {}): string {
  if (isEnoent({ error })) return "no SKILL.md";
  return `SKILL.md could not be read (${error instanceof Error ? error.message : String(error)})`;
}

/** One entry-resolution outcome: `"skip"` covers every tolerated bad-folder case (not a directory, disabled,
 *  missing/unreadable SKILL.md, unparseable
 *  frontmatter, unusable id) — only `"resolved"` contributes to the loaded source list. */
type SkillEntryResolution = { readonly kind: "skip" } | { readonly kind: "resolved"; readonly source: InstalledSkillToolSource };

/**
 * Resolves one workspace-root directory entry into a ready {@link InstalledSkillToolSource}, or a `"skip"`
 * outcome for every tolerated failure — pulled out of {@link loadInstalledSkillToolSources} so that
 * function's own loop body is a flat dispatch on the result instead of nested try/catch and
 * early-continue branches for each entry.
 *
 * @param input.seenDirById - Mutated in place: records `id -> folder name` for every entry this call
 * resolves, so the caller's next call (for the next entry) can detect a same-id collision.
 * @throws {Error} Only for the one non-tolerated case: `frontmatter.name` sanitizes to an `id` already
 * present in `seenDirById` (two folders would mint the same tool id).
 * @complexity O(f) in the entry's own bundled-file count (from {@link listBundledFiles}).
 */
async function resolveSkillEntry(input: {
  readonly workspaceRoot: string;
  readonly siteDir: string;
  readonly entry: { readonly name: string; isDirectory: () => boolean };
  readonly seenDirById: Map<string, string>;
  readonly includeDisabled?: boolean | undefined;
  readonly ports: InstalledSkillToolPorts;
}): Promise<SkillEntryResolution> {
  const { workspaceRoot, entry, seenDirById } = input;
  if (!entry.isDirectory()) return { kind: "skip" };
  const skillDir = path.join(workspaceRoot, entry.name);
  if (!(await input.ports.isEnabled({ directory: skillDir })) && !input.includeDisabled) return { kind: "skip" };

  let markdown: string;
  try {
    markdown = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
  } catch (error) {
    input.ports.report({ message: `[skills] '${entry.name}': ${describeSkillMdReadFailure({ error })} — skipped` });
    return { kind: "skip" };
  }

  const frontmatter = parseSkillFrontmatter({ markdown, readFrontmatterField: input.ports.readFrontmatterField });
  if (!frontmatter) {
    input.ports.report({ message: `[skills] '${entry.name}': SKILL.md has no parseable frontmatter with both 'name' and 'description' — skipped` });
    return { kind: "skip" };
  }

  const id = toSkillToolId({ name: frontmatter.name });
  if (!id) {
    input.ports.report({ message: `[skills] '${entry.name}': frontmatter name '${frontmatter.name}' could not be turned into a valid tool id — skipped` });
    return { kind: "skip" };
  }

  const priorDir = seenDirById.get(id);
  if (priorDir !== undefined) {
    throw new ToolInputError({ message:
      `skills: '${frontmatter.name}' is declared by more than one installed skill folder ('${priorDir}' and '${entry.name}') — ` +
        `both would register the same tool id '${id}'; rename one skill's frontmatter 'name' to disambiguate`,
    });
  }
  seenDirById.set(id, entry.name);

  return {
    kind: "resolved",
    source: { directory: entry.name, id, skillName: frontmatter.name, description: frontmatter.description, markdown, readFile: input.ports.createFileReader({ skillRoot: skillDir }).read, bundledFiles: await listBundledFiles({ skillDir, siteDir: input.siteDir }) },
  };
}

/**
 * Loads every installed standalone Agent Skill for one workspace, resolved into one tool-ready
 * source per skill folder.
 *
 * @throws {ToolInputError} If two installed skill folders declare the same frontmatter `name` — see
 * {@link resolveSkillEntry}.
 * @complexity O(d * f) in installed skill-folder count times average bundled-file count per skill.
 */
export async function loadInstalledSkillToolSources(
  { workspaceRoot, siteDir, ports }: { readonly workspaceRoot: string; readonly siteDir: string; readonly ports: InstalledSkillToolPorts },
  optional: { readonly includeDisabled?: boolean } = {},
): Promise<readonly InstalledSkillToolSource[]> {

  let entries;
  try {
    entries = await readdir(workspaceRoot, { withFileTypes: true });
  } catch (error) {
    if (isEnoent({ error })) return [];
    throw error;
  }

  const sources: InstalledSkillToolSource[] = [];
  const seenDirById = new Map<string, string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const resolution = await resolveSkillEntry({ siteDir, workspaceRoot, entry, seenDirById, includeDisabled: optional.includeDisabled, ports });
    if (resolution.kind === "resolved") sources.push(resolution.source);
  }

  return sources;
}

/** This module's own risk classification: every skill tool is a pure read of already-installed,
 *  operator-trusted local content — no domain call, no write path. */
export function skillToolDerivedRisk({ sources }: { sources: readonly InstalledSkillToolSource[] }, _optional = {}): DerivedRiskByToolId {
  return new Map<string, AgentToolSideEffect>(sources.map((source) => [source.id, "none"]));
}

/** Optional file only — one skill is one tool, so no `skill` argument selects siblings.
 *  The file schema documents progressive disclosure through this tool's shared reader. */
const SKILL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: { file: { type: "string", description: "Optional supporting text file relative to this skill folder, e.g. references/guide.md. Omit to read SKILL.md. Responses list readable files; unknown, unsafe, binary or over-256-KiB requests return a note and valid files." } },
} as const;

/** Formats standalone-skill guidance while retaining cached instructions when a file is refused. */
function buildSkillToolResult({ source, content, file, fileRoot }: {
  readonly source: InstalledSkillToolSource;
  readonly content: SkillFileReadResult | undefined;
  readonly file: string | undefined;
  readonly fileRoot: string;
}, _options = {}) {
  const result: SkillFileReadResult = content ?? { text: source.markdown, files: [] };
  return {
    skillName: source.skillName,
    guidance: result.note && !result.text ? source.markdown : result.text,
    files: result.files ?? [],
    ...(result.note ? { note: result.note } : {}),
    ...(file !== undefined && !source.readFile ? { note: "File request refused: no supporting-file reader is available. Valid supporting files: (none)." } : {}),
    bundledFiles: source.bundledFiles.map((file) => ({ kind: file.kind, root: fileRoot, path: file.path })),
  };
}

/**
 * Turns already-resolved skill sources into real `ToolRegistration`s — pure and synchronous, unlike
 * {@link loadInstalledSkillToolSources}, so this is the half a unit test exercises without touching
 * disk. Uses the SAME `buildDomainRegistrations` gate every other domain's `tool-registrations.ts`
 * uses (catalog/risk cross-check, `inputSchema` presence, drift tripwire) — not a parallel mechanism.
 * Handlers reject non-object inputs and keys other than `file` before invoking the injected reader.
 * @throws Error when a handler receives invalid input; reader errors propagate unchanged.
 * @complexity O(s) registration time/space for s sources; a handler validates O(k) keys before one read.
 */
export function buildSkillToolRegistrations(
  { sources, host }: { sources: readonly InstalledSkillToolSource[]; host: SkillToolRegistrationHost },
  _optional = {},
): ToolRegistration[] {
  const catalog: AgentToolDefinition[] = sources.map((source) => ({
    name: source.id,
    description: source.description,
    sideEffects: "none",
    authorization: { permission: host.permission },
    inputSchema: SKILL_INPUT_SCHEMA,
  }));

  const handlers: Record<string, ToolHandler> = {};
  for (const source of sources) {
    handlers[source.id] = async (ctx) => {
      const input = ctx.input === undefined ? {} : requireInputRecord({ input: ctx.input });
      if (Array.isArray(input) || Object.keys(input).some(key => key !== "file")) throw new Error("this tool accepts only an optional 'file' argument");
      const file = optionalString({ input, key: "file" });
      const readOptions = file !== undefined ? { file } : {};
      const content = source.readFile ? await source.readFile({}, readOptions) : undefined;
      return buildSkillToolResult({ source, content, file, fileRoot: host.fileRoot });
    };
  }

  return buildDomainRegistrations({ metadata: host.metadata,
    domain: "skill",
    catalogModule: host.catalogModule,
    catalog: indexCatalogById({ catalog: catalog }),
    handlers,
    derivedRisk: skillToolDerivedRisk({ sources }),
  }).map(registration => host.withExtensionApprovalPolicy({ registration, family: 'installed-guidance' }));
}
