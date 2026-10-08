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

