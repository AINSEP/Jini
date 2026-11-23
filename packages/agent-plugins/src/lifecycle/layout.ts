import path from 'node:path';
import { pluginStatePaths } from '../../core/persistent-state.js';
import type { AgentPluginLayoutPort } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";

/** Explicit root only; site-root and environment resolution belong to the consumer. */
export function createAgentPluginLayout(required: { readonly root: string }, _optional: Record<string, never> = {}): AgentPluginLayoutPort {
  if (!path.isAbsolute(required.root)) throw new Error('Agent plugin root must be absolute');
  const root = path.resolve(required.root);
  return {
    root,
    forWorkspace({ workspaceId }) {
      const id = workspaceId.toLowerCase();
      assertSafeSegment(id);
      const workspaceRoot = path.join(root, 'ws', id);
      return {
        root: workspaceRoot,
        packages: path.join(workspaceRoot, 'packages', 'sha256'),
        staging: path.join(workspaceRoot, 'staging'),
        pluginRootDir: ({ pluginId }, _optional = {}) => pluginStatePaths({ workspaceRoot, pluginId }).root,
        pluginPackagesDir: ({ pluginId }, _optional = {}) => pluginStatePaths({ workspaceRoot, pluginId }).packages,
        pluginMemoryDir: ({ pluginId, kind }, _optional = {}) => {
          if (kind !== 'learned' && kind !== 'notes') throw new Error('Invalid memory kind');
          return pluginStatePaths({ workspaceRoot, pluginId })[kind];
        },
        pluginDataDir({ pluginId }) {
          assertSafeSegment(pluginId);
          return pluginStatePaths({ workspaceRoot, pluginId }).data;
        },
      };
    },
  };
}
function assertSafeSegment(value: string): void {
  if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(value) || value.length > 64) {
    throw new Error(`'${value}' is not a safe plugin/workspace id`);
  }
}
