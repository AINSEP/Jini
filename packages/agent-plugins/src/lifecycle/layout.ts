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

/**
 * @file Pure filesystem layout computation for installed Agent Plugins; callers perform I/O.
 *
 * The owner requires workspace isolation. A shared content-addressed package directory would
 * leak another tenant's installs: public archive digests are precomputable and stat-able even
 * when bytes are frozen. A per-workspace tree enforces isolation by construction rather than
 * relying on every future reader to check activation records. It also avoids cross-workspace
 * refcounts and prevents uninstalling one workspace's plugin from deleting another's bytes.
 * Plugin archives are hostile third-party input; per-workspace extraction costs are bounded by
 * the lifecycle owner's archive/expanded-byte limits. Content deduplication stays within a workspace.
 * Writable PLUGIN_DATA belongs to the same workspace tree.
 *
 * Installed plugins are site data: they must travel with the site and survive upgrades.
 */


/**
 * One safe, indivisible path segment: lowercase alphanumerics in `-`/`.`-separated runs, with no
 * leading, trailing, or doubled separator. Matches the Agent Plugins spec's own `name` grammar
 * (§5.5), and — by construction — cannot be `.`, `..`, empty, or contain a `/`, `\`, or whitespace,
 * which is the entire property this module needs before using a caller-supplied string in a
 * `path.join`.
 *
 * Workspace IDs are safe path segments, not necessarily UUIDs: the site's real ID can be
 * `workspace-local`. The check must prevent splitting or escaping a path while accepting that ID.
 *
 * Deliberately NOT relaxed further: `_`, uppercase (normalized before this is applied, never
 * accepted raw), and any Unicode remain rejected, because each would let two distinct ids collide
 * onto one directory on a case-insensitive or normalizing filesystem.
 */
const SAFE_ID_SEGMENT_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/** Bounds the segment so a caller cannot drive a pathological path length. Applied to both ids. */
const MAX_ID_SEGMENT_LENGTH = 64;

import type { AgentPluginLayout, AgentPluginWorkspaceLayout } from '@jini-ai/core/contracts/headless/plugin-host';

export function createAgentPluginSiteLayout(required: { root: string; diagnostics: {
  workspaceId(input: { workspaceId: string }): Error; pluginId(input: { pluginId: string }): Error;
  pluginDataId(input: { pluginId: string }): Error; memoryKind(): Error;
} }, _optional = {}): AgentPluginLayout {
  const root = path.resolve(required.root);
  const workspacesDir = path.join(root, "ws");

  return {
    root,
    workspacesDir,
    forWorkspace({ workspaceId }: { workspaceId: string }, _optional: Record<string, never> = {}): AgentPluginWorkspaceLayout {
      // Normalize BEFORE validating, not after: the pattern is deliberately lowercase-only (see its
      // own doc), so validating the raw string would reject an uppercase id that the old UUID rule
      // accepted — and the normalized value is the one that actually becomes the path segment, so it
      // is the only value worth asserting about.
      const normalizedWorkspaceId = workspaceId.toLowerCase();
      if (!SAFE_ID_SEGMENT_PATTERN.test(normalizedWorkspaceId) || normalizedWorkspaceId.length > MAX_ID_SEGMENT_LENGTH) {
        // Quotes the RAW input, not the normalized one, so the message names what the caller passed.
        throw required.diagnostics.workspaceId({ workspaceId });
      }
      const workspaceRoot = path.join(workspacesDir, normalizedWorkspaceId);
      const pluginRootDir = ({ pluginId }: { pluginId: string }, _optional = {}): string => {
        if (!SAFE_ID_SEGMENT_PATTERN.test(pluginId) || pluginId.length > MAX_ID_SEGMENT_LENGTH) {
          throw required.diagnostics.pluginId({ pluginId });
        }
        return pluginStatePaths({ workspaceRoot, pluginId }).root;
      };

      return {
        root: workspaceRoot,
        pluginRootDir,
        pluginPackagesDir: ({ pluginId }, _optional = {}) => path.join(pluginRootDir({ pluginId }), "package", "sha256"),
        pluginMemoryDir: ({ pluginId, kind }, _optional = {}) => {
          if (kind !== "learned" && kind !== "notes") throw required.diagnostics.memoryKind();
          return path.join(pluginRootDir({ pluginId }), "memory", kind);
        },
        packages: path.join(workspaceRoot, "packages", "sha256"),
        staging: path.join(workspaceRoot, "staging"),
        pluginDataDir({ pluginId }: { pluginId: string }, _optional: Record<string, never> = {}): string {
          if (!SAFE_ID_SEGMENT_PATTERN.test(pluginId) || pluginId.length > MAX_ID_SEGMENT_LENGTH) {
            throw required.diagnostics.pluginDataId({ pluginId });
          }
          return path.join(pluginRootDir({ pluginId }), "data");
        },
      };
    },
  };
}
