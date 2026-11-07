/**
 * @file The ports the host-tools take. Each is structural, so a host binds its own lifecycle,
 * activation effects, memory store, permission check and text without these tools importing a
 * same-layer package or a host file. The lifecycle and activation ports are the same-named functions
 * `createAgentPluginLifecycle` returns, with object arguments, so a host built on that owner passes it
 * as is. Activation writes stay with the host's one shared queue; these tools only read.
 */
import type { ToolMetadataById, ToolRegistration } from '@jini-ai/core';
import type { createAgentPluginLifecycle } from '../index.js';
import type { AgentPluginWorkspaceLayout } from '../layout.js';
import type { PluginMemory } from '../../../core/persistent-state.js';

type AgentPluginLifecycle = ReturnType<typeof createAgentPluginLifecycle>;

/** Installed-package reads, ranking and entry-path checks. */
export type HostToolsLifecyclePort = Pick<AgentPluginLifecycle,
  | 'listInstalledPlugins' | 'readBundledAgentPluginDigests' | 'preferBundledAgentPluginDigests' | 'isInstalledDigestPresent'
  | 'readInstalledSkillMarkdown' | 'readInstalledSkillFile' | 'readInstalledMcpServerIds' | 'rankInstalledAgentPlugins'
  | 'normalizePackageEntryPath'>;

/** Activation reads; the host's activation owner keeps every write on its one queue. */
export type HostToolsActivationsPort = Pick<AgentPluginLifecycle,
  'filterActiveAgentPlugins' | 'isAgentPluginActive' | 'readAgentPluginActivations' | 'resolveAgentPluginActivation'>;

/** The workspace directories these tools read; never exposed in tool output. */
export interface HostToolsLayoutPort {
  forWorkspace(required: { readonly workspaceId: string }): Pick<AgentPluginWorkspaceLayout, 'root' | 'pluginPackagesDir'>;
}

/** Plugin memory: one plugin's store, and its user notes folded into guidance. */
export interface HostToolsMemoryPort {
  pluginMemory(required: { readonly workspaceId: string; readonly pluginId: string }): PluginMemory;
  appendNotes(required: { readonly workspaceId: string; readonly pluginId: string; readonly guidance: string }): Promise<string>;
}

/** Permission names are host input: `use` reads guidance and memory, `enable` writes a note. */
export interface HostToolPermissions {
  readonly use: string;
  readonly enable: string;
}

/** Host text. `pluginToolNavigation` ends each plugin tool's description when set. */
export interface HostToolMessages {
  readonly pluginToolNavigation?: string;
}

/** Every host-tools entry point takes this one bag. */
export interface AgentPluginHostToolPorts {
  readonly lifecycle: HostToolsLifecyclePort;
  readonly activations: HostToolsActivationsPort;
  readonly layout: HostToolsLayoutPort;
  readonly memory: HostToolsMemoryPort;
  readonly permissions: HostToolPermissions;
  /** One `key: value` reader over a markdown document's frontmatter block. */
  readonly readFrontmatterField: (required: { readonly markdown: string; readonly key: string }) => string | undefined;
  /** Host tool vocabulary and reviewed action policy, passed to `buildDomainRegistrations`. */
  readonly metadata?: ToolMetadataById;
  readonly messages?: HostToolMessages;
}

/** The approval families these tools register under. */
export type HostToolApprovalFamily = 'installed-guidance' | 'plugin-memory-read' | 'plugin-memory-write';

/** Wraps one registration in the host's approval policy for its family. */
export type ApplyHostToolApprovalPolicy = (
  required: { registration: ToolRegistration; family: HostToolApprovalFamily },
  optional?: Record<string, never>,
) => ToolRegistration;

/** Throws unless the principal holds `permission` in the workspace. */
export type RequireHostToolPermission = (
  required: { workspaceId: string; principalId: string; permission: string },
  optional: { entityType: string; entityId: string },
) => Promise<void>;

/** The retained host contributor transport these tools are given; they emit nothing through it. */
export interface HostToolSurfaces {
  readonly surfaceExchanges: object;
}

/** A plugin tool's answer, as the host overlay receives it. */
export interface PluginToolGuidance {
  readonly pluginId: string;
  readonly guidance: string;
  readonly files?: readonly string[];
  readonly note?: string;
}

/** The host's per-plugin overlay: its guidance first, and its own `host/` files. */
export interface HostGuidancePort {
  isFileRequest(required: { readonly file: string }): boolean;
  deliver(required: { result: PluginToolGuidance; file?: string }, optional: { notice?: string }): Promise<{ guidance: string; files: string[]; note?: string }>;
}
