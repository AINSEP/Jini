/** Read-side owner of installed package metadata; never constructs a mutation lifecycle. */
import path from "node:path";
import { AgentPluginInstallError } from "./install-errors.js";
import { readAgentPluginExtension, parseAgentPluginManifest as parseAgentPluginManifestValue } from "./manifest.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";
import type { InstalledAgentPlugin, InstalledAgentPluginSkill } from "./types.js";

/** Indexes manifests and files with the same injected effects used by installation and resolution.
 * @complexity O(f) reads/walk work for f package files; no mutation or executable imports. */
export function createInstalledPackageIndex(required: { readonly ports: AgentPluginLifecyclePorts }, _optional: Record<string, never> = {}) {
  const { ports } = required;
  const readFile = ports.filesystem.readFile.bind(ports.filesystem);
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const parseAgentPluginManifest = (value: unknown) => parseAgentPluginManifestValue({ value }, { identityNamespace: ports.extensionNamespace });
  /** Cosmetic fields are trimmed and capped rather than invalidating the package. The cap stops
   * a hostile package flooding an admin row. Malformed values fall back because these fields are
   * cosmetic: callers title-case the id and show the spec description when these keys are absent.
   * Inner newlines remain paragraph breaks in summaries.
   * @complexity O(n) in the supplied text length; output is capped at maxLength. */
  function readDisplayText(required: { readonly manifest: Parameters<typeof readAgentPluginExtension>[0]['manifest']; readonly key: 'displayName' | 'summary'; readonly maxLength: number }, _optional = {}): { displayName?: string; summary?: string } {
    const text = readAgentPluginExtension({ manifest: required.manifest, namespace: ports.extensionNamespace,
      read: ({ value }) => {
        const field = value[required.key];
        return typeof field === 'string' ? field.trim() : undefined;
      } });
    return text ? { [required.key]: text.slice(0, required.maxLength) } : {};
  }

  /** Reads and validates `packageRoot`'s `plugin.json`, refusing a missing, unparseable or invalid one. */
  async function readInstalledManifest({ packageRoot }: { readonly packageRoot: string }) {
    let manifestRaw: string;
    try {
      manifestRaw = await readFile(path.join(packageRoot, "plugin.json"), "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        throw new AgentPluginInstallError({ code: "MANIFEST_MISSING", message: "the archive does not contain a plugin.json at its root" });
      }
      throw error;
    }

    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(manifestRaw);
    } catch (error) {
      throw new AgentPluginInstallError({ code: "MANIFEST_INVALID", message: "plugin.json is not valid JSON" }, { cause: error });
    }

    const parsed = parseAgentPluginManifest(manifestValue);
    if (!parsed.ok) {
      throw new AgentPluginInstallError({ code: "MANIFEST_INVALID", message: `plugin.json failed validation: ${parsed.errors.join("; ")}` });
    }
    return parsed;
  }

  /** Every regular file under `packageRoot` (sorted) and every `skills/<name>/SKILL.md` (sorted by name). */
  async function walkPackageTree({ packageRoot }: { readonly packageRoot: string }): Promise<{ files: string[]; skills: InstalledAgentPluginSkill[] }> {
    const files: string[] = [];
    const skills: InstalledAgentPluginSkill[] = [];

    async function walk(absolute: string, prefix: string): Promise<void> {
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(absolute, entry.name), relative);
        else if (entry.isFile()) files.push(relative);
        // Anything that is neither a directory nor a regular file (a symlink somehow already present,
        // a device node) is skipped rather than indexed — extraction itself never creates one, so
        // encountering one here would mean the filesystem changed out from under an already-published,
        // supposedly-frozen package, which this function has no business acting on either way.
      }
    }

    await walk(packageRoot, "");
    for (const relative of files) {
      const match = relative.match(/^skills\/([^/]+)\/SKILL\.md$/);
      if (match) skills.push({ name: match[1] as string, skillPath: relative });
    }
    return { files: files.sort(), skills: skills.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  /**
 * Reads the (already-extracted-and-trusted, or already-published) `plugin.json` at `packageRoot`
 * and walks the tree to build the `files`/`skills` index. Shared between a fresh install and the
 * content-addressed dedup fast path so both return an identically-shaped result.
 *
 * Exported (2026-08-21) for a second caller outside this module:
 * `resolve-agent-plugin-refs.ts`'s run-time resolution of a pinned `pluginRefId` against the
 * packages already on disk needs the SAME `plugin.json`-parse-plus-tree-walk this function
 * already does correctly (manifest validation via `parseAgentPluginManifest`, sorted `files`), so
 * it re-derives an `InstalledAgentPlugin` per installed digest rather than hand-rolling a second,
 * less-validated reader.
 */
// Conditional spreads, not `field: parsed.manifest.field` directly: an `exactOptionalPropertyTypes`-
// style caller (and this codebase's own convention elsewhere — see `buildToolSource`'s identical
// `defaultSkillReason` spread in `tool-registrations.ts`) must see an ABSENT key, not a key present
// with value `undefined`, when the manifest declared none of these — `deepEqual` fixtures across
// this feature's own tests already assert exact object shape.
  async function indexInstalledRoot({ packageRoot, archiveDigest }: {
    readonly packageRoot: string;
    /** SHA-256 of the raw archive bytes — the content-addressing key and the descriptor `revision`
     * a future capability projection pins invocation to (`capability-projection.ts`). */
    readonly archiveDigest: string;
  }, _optional: Record<string, never> = {}): Promise<InstalledAgentPlugin> {
    const parsed = await readInstalledManifest({ packageRoot });
    for (const message of parsed.warnings) ports.onEvent?.({ event: 'agent-plugin-identity-warning', message });
    const { files, skills } = await walkPackageTree({ packageRoot });

    return {
      pluginId: parsed.manifest.name,
      id: parsed.manifest.id,
      provides: parsed.manifest.provides,
      ...(parsed.manifest.requires === undefined ? {} : { requires: parsed.manifest.requires }),
      ...(parsed.manifest.hostRange === undefined ? {} : { hostRange: parsed.manifest.hostRange }),
      version: parsed.manifest.version,

      ...(/**
   * `plugin.json`'s own `description`/`keywords`/`author`/`license` (`manifest.ts`'s
   * `AgentPluginManifest`) — parsed at index time but, before 2026-09-09, discarded immediately
   * after: only `name`/`version` ever reached `InstalledAgentPlugin`. Added for
   * `search_agent_plugin_local` (`tool-registrations.ts`), which needs the description and the
   * author-curated keywords to rank installed plugins against a free-text query — the manifest is
   * already read and parsed here on every call, so carrying these through is zero additional I/O,
   * not a new read path. All four are optional because the spec itself makes them optional (the real
   * installed `ui-ux-design` fixture ships `description` but no `keywords`; a bare-minimum manifest
   * ships neither) — a caller must not assume any of them are present.
   */
parsed.manifest.description !== undefined ? { description: parsed.manifest.description } : {}),
      ...(parsed.manifest.keywords !== undefined ? { keywords: parsed.manifest.keywords } : {}),
      ...(parsed.manifest.author !== undefined ? { author: parsed.manifest.author } : {}),
      ...(parsed.manifest.license !== undefined ? { license: parsed.manifest.license } : {}),
      ...readDisplayText({ manifest: parsed.manifest, key: "displayName", maxLength: 64 }),
      ...readDisplayText({ manifest: parsed.manifest, key: "summary", maxLength: 1200 }),
      archiveDigest,
      packageRoot,
      files,
      skills,
    };
  }

  return { indexInstalledRoot };
}
