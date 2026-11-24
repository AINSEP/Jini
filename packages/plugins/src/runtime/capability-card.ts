/** Minimal Plugins learning card, maintained beside its owning code. Live registries supply current types. */
import type { GuideTopic as CapabilityCard } from "@jini-ai/core/contracts/site/agentic-core";

/** The host passes where its Plugins admin screen lives (`pluginsAdminHref`) and its plugin list tool (`pluginListToolName`). @complexity O(1). */
export function createCapabilityCard({ pluginsAdminHref, pluginListToolName }: { pluginsAdminHref: string; pluginListToolName: string }, _optional = {}) {
  return {
  "id": "plugins",
  "title": "Plugins",
  "summary": "Site plugins and agent plugins extend different host surfaces.",
  "explanation": "Inspect installed plugins, including those switched off. Agent plugins may provide mail, account tools, skills and guide topics. Before saying a provider is unavailable, call search_agent_plugin_local for it, then load_agent_plugin for its setup guidance. Enable it with plugins_set_enabled only with the person's approval; discovery does not authorize its tools.",
  "permissions": [
    "admin.plugins.read"
  ],
  "pointers": [
    {
      "label": "Inspect plugins",
      "tool": pluginListToolName,
      "permissions": [
        "admin.plugins.read"
      ]
    },
    {
      "label": "Plugins admin",
      "href": pluginsAdminHref,
      "permissions": [
        "admin.plugins.read"
      ]
    }
  ],
  "workflows": []
} as const satisfies CapabilityCard;
}
