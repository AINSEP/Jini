/** "supabase" -> "Supabase", "higgsfield-media" -> "Higgsfield Media". There is no separate
 *  display-name field in `plugin.json` (agent-plugins.org has none) — `uninstall-confirmation-ui.ts`'s
 *  own dialog makes the identical choice, naming the plugin by its id. */
export function titleCaseFromPluginId(required: { pluginId: string }, _optional: Record<string, never> = {}): string {
  return required.pluginId
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

