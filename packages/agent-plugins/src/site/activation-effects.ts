/** Revision-checked "is this Agent Plugin enabled" reads over the activation owner's atomic file.
 * The host injects its lifecycle owner's `resolveAgentPluginActivation`, so every in-process writer
 * keeps sharing that owner's activation queue.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { ACTIVATIONS_FILENAME, createVersionedPluginActivationReader } from "@jini-ai/agent-plugins/lifecycle";

/** The lifecycle owner's fail-closed activation resolution, bound by the host. */
export type ResolveAgentPluginActivation = (required: { workspaceRoot: string; pluginId: string }) => Promise<{ readonly verdict: string }>;

/** Bind Jini's versioned point reader to the activation owner's atomic file writes.
 * @returns A scoped callback with one stat per hot call; file contents are read only on change.
 * @throws Filesystem errors except a genuinely absent activation file (the lifecycle default).
 * @complexity O(1) metadata per call, O(a) activation-file read on cache miss for a bytes.
 */
export function createAgentPluginEnabledReader(
  { workspaceRoot, resolveAgentPluginActivation }: { workspaceRoot: string; resolveAgentPluginActivation: ResolveAgentPluginActivation },
  _options = {},
): (pluginId: string) => Promise<boolean> {
  const reader = createVersionedPluginActivationReader({ ports: {
    revision: async () => {
      try {
        const info = await stat(path.join(workspaceRoot, ACTIVATIONS_FILENAME), { bigint: true });
        return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
        throw error;
      }
    },
    // Only an active verdict enables; missing activation records retain the lifecycle default.
    resolve: async ({ pluginId }) => (await resolveAgentPluginActivation({ workspaceRoot, pluginId })).verdict === "active",
  } });
  return pluginId => reader.isEnabled({ pluginId });
}
