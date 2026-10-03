import type { PluginManifestAuthor } from "../manifest.js";

/** Lifecycle value contracts shared by host ports and implementations. */
export type AgentPluginDeliveryMode = "inject" | "pointer";

export interface InstalledAgentPluginSkill {
  readonly name: string;
  readonly skillPath: string;
}

export interface InstalledAgentPlugin {
  readonly pluginId: string;
  readonly version?: (string) | undefined;

  readonly description?: (string) | undefined;
  readonly keywords?: (readonly string[]) | undefined;
  readonly author?: string | PluginManifestAuthor | undefined;
  readonly license?: (string) | undefined;

  readonly archiveDigest: string;

  readonly packageRoot: string;
  readonly files: readonly string[];
  readonly skills: readonly InstalledAgentPluginSkill[];
}

