/**
 * @file Agent Plugin lifecycle value contracts. Additive copy of the type declarations in
 * `@jini-ai/agent-plugins/lifecycle` (`types.ts`, `set-enabled.ts`, `uninstall.ts`, `install.ts`,
 * `layout.ts`, `exports.ts`, `../manifest.ts`); that package keeps its identical declarations, its
 * runtime values and its exports until the paired cutover.
 */
import type { AgentPluginExport } from "./agent-plugins-manifest.js";

/** One author entry of a plugin manifest. */
export interface PluginManifestAuthor {
  readonly name?: string;
  readonly email?: string;
  readonly url?: string;
}

export interface AgentPluginExportMetadata {
  readonly exports?: Readonly<Record<string, AgentPluginExport>>;
  /** Explicit publisher-qualified old identities; admission and ambiguity are host decisions. */
  readonly renamedFrom?: readonly string[];
}

export interface InstalledAgentPluginSkill {
  readonly name: string;
  readonly skillPath: string;
}

export interface InstalledAgentPlugin extends AgentPluginExportMetadata {
  readonly id?: string | undefined;
  readonly provides?: readonly string[] | undefined;
  readonly requires?: readonly string[] | undefined;
  readonly companions?: readonly string[] | undefined;
  readonly hostRange?: string | undefined;
  readonly pluginId: string;
  readonly version?: (string) | undefined;

  /** the host extension namespace in `plugin.json`: `displayName` — the human-facing title when the id alone reads
   *  wrong ("deploy" shows as "Deploy Online"). Lives under the spec's host-extension namespace, not
   *  a top-level field, because the spec has no title field and `name` is the stable id that
   *  activations, tool ids and ledgers key on — renaming it would churn all of those. Absent means
   *  callers title-case the id. */
  readonly displayName?: string | undefined;
  /** the host extension namespace in `plugin.json`: `summary` — a short plain-language explainer for the site owner,
   *  shown in the admin in place of the spec `description`. That `description` stays the
   *  agent-facing text (search ranks it and returns it to the model), so it can stay dense and
   *  technical; this field is never ranked and never reaches the model. Blank lines separate
   *  paragraphs. Absent means the admin shows the description. */
  readonly summary?: string | undefined;
  readonly description?: (string) | undefined;
  readonly keywords?: (readonly string[]) | undefined;
  readonly author?: string | PluginManifestAuthor | undefined;
  readonly license?: (string) | undefined;

  readonly archiveDigest: string;

  readonly packageRoot: string;
  readonly files: readonly string[];
  readonly skills: readonly InstalledAgentPluginSkill[];
}

export interface SetAgentPluginEnabledInput {
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly enabled: boolean;

  /** Recorded as the activation record's updatedBy. The authenticated principal, never a constant. */
  readonly actor: string;
}

export interface SetAgentPluginEnabledResult {
  readonly pluginId: string;

  /** As actually written and read back, not as requested. */
  readonly enabled: boolean;
  readonly warnings?: readonly string[];
}

export interface AgentPluginWorkspaceLayout {
  readonly root: string;
  readonly packages: string;
  readonly staging: string;
  pluginRootDir(required: { readonly pluginId: string }, optional?: Record<string, never>): string;
  pluginPackagesDir(required: { readonly pluginId: string }, optional?: Record<string, never>): string;
  pluginMemoryDir(required: { readonly pluginId: string; readonly kind: 'learned' | 'notes' }, optional?: Record<string, never>): string;
  pluginDataDir(required: { readonly pluginId: string }): string;
}
export interface AgentPluginLayoutPort {
  readonly root: string;
  forWorkspace(required: { readonly workspaceId: string }): AgentPluginWorkspaceLayout;
}
export type AgentPluginLayout = AgentPluginLayoutPort;

/** What an uninstall of one plugin would remove, in a form safe to show a human: no host path. */
export interface AgentPluginUninstallPreview {
  readonly pluginId: string;

  /** Distinct manifest versions across the matching digests; empty when none declares one. */
  readonly versions: readonly string[];
  readonly archiveDigests: readonly string[];
}

export interface UninstallAgentPluginRequired {
  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;
  readonly pluginId: string;
}

export interface UninstallAgentPluginOptional {

  /** The preview a human confirmed. When given, the uninstall refuses, removing nothing, unless the digests it
   *  resolves now are exactly this preview's `archiveDigests`: a confirmation is consent to remove what was
   *  resolved for the dialog, not whatever the id names by the time the answer arrives (t91 F2.2). */
  readonly confirmedPreview?: (AgentPluginUninstallPreview) | undefined;
  /** Only the browser-confirmed choice may delete persistent state. Off by default. */
  readonly deleteMemory?: boolean | undefined;

  /** INTERNAL — `retire-bundled.ts` only, never an agent tool or HTTP route. Skips the bundled refusal
   *  (the uninstall module header, item 2) and nothing else: that refusal exists because a bundled plugin is
   *  re-seeded on every boot, which stops being true once the host no longer ships its source
   *  (`RETIRED_BUNDLED_AGENT_PLUGINS`). The malformed-entry refusal still applies. */
  readonly retiredBundled?: (boolean) | undefined;
}

export interface UninstallAgentPluginResult {
  readonly pluginId: string;

  /** Every installed archive digest removed for this plugin id — normally exactly one. All matching
   *  digests are removed: uninstall's job is to make the plugin genuinely gone, so unlike the tool
   *  loader, which must pick ONE to serve, there is no "which one" question here. */
  readonly removedDigests: readonly string[];
}

/** One archive entry. A symlink is modeled as its OWN kind rather than folded into "file" — the
 * zip-slip research the install module's header cites is explicit that the symlink-entry vector is
 * distinct from the lexical-traversal one, and the two need independent tests and independent
 * handling (see the install module's "symlink entries are rejected outright" rule). */
export type AgentPluginArchiveEntry =
  | {
      readonly kind: "file";
      readonly entryPath: string;

      /** The archive format's own claimed size. Never trusted alone — see `DECOMPRESSION_BOMB`. */
  readonly declaredSize?: (number) | undefined;
      readonly executable?: (boolean) | undefined;
      readonly openReadStream: (required: Record<string, never>) => AsyncIterable<Uint8Array>;
    }
  | { readonly kind: "directory"; readonly entryPath: string }
  | { readonly kind: "symlink" | "hardlink" | "device" | "fifo"; readonly entryPath: string; readonly linkTarget?: string | undefined };

/**
 * `entries` must be a pure function of the archive bytes: an install iterates it twice, once to
 * check entry-count limits from metadata alone and once to extract.
 */
export interface AgentPluginArchiveReaderPort {
  entries(required: { readonly archive: Uint8Array }): AsyncIterable<AgentPluginArchiveEntry>;
}
