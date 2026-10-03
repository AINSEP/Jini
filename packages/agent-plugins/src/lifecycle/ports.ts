import type { Clock, IdGenerator } from "@jini-ai/core/primitives";
import type { AgentPluginServerMetadataReader } from './manifest.js';
import type { AgentPluginLayoutPort } from './layout.js';
import type { AgentPluginDeliveryMode, InstalledAgentPlugin } from './types.js';

/** Native Node filesystem ABI, narrowed to the operations used by lifecycle.
 * Inject instrumented fs/promises effects directly; native handles are never rewrapped. */
export type FilesystemPort = Pick<typeof import('node:fs/promises'),
  'chmod' | 'mkdir' | 'mkdtemp' | 'open' | 'readdir' | 'readFile' | 'rename' |
  'rm' | 'stat' | 'realpath' | 'unlink'>;
export type AgentPluginFetchPort = (required: { readonly url: string }, optional?: RequestInit) => Promise<Response>;
export type AgentPluginClockPort = Clock & {
  monotonicMs(): number;
  sleep(required: { readonly ms: number }): Promise<void>;
};
export type AgentPluginIdsPort = IdGenerator & { random(): number };
export interface AgentPluginProcessPort {
  readonly pid: number;
  readonly platform: NodeJS.Platform;
  hostname(required: Record<string, never>): string;
  isAlive(required: { readonly pid: number }): boolean;
}
/** The host implements federation in its own composition layer. No MCP dependency is required. */
export interface AgentPluginMcpProvisioningPort {
  provision(required: { readonly workspaceId: string; readonly installed: InstalledAgentPlugin }): Promise<void>;
  setEnabled(required: { readonly workspaceId: string; readonly pluginId: string; readonly enabled: boolean }): Promise<void>;
  remove(required: { readonly workspaceId: string; readonly pluginId: string }): Promise<void>;
  notifyRosterChanged(required: { readonly workspaceId: string }): Promise<void>;
}
export interface AgentPluginOutboundGuardPort {
  /** Must reject forbidden destinations before every request, including each redirect. A fetch
   * adapter that pins DNS at connection time is responsible for preventing DNS rebinding. */
  assertAllowed(required: { readonly url: string }): Promise<void>;
}
export interface AgentPluginLifecyclePorts {
  readonly onEvent?: ((required: { readonly event: string; readonly message: string }) => void) | undefined;
  readonly formatPluginToolPointer: (required: { readonly pluginId: string }) => string;
  readonly seededEnabledPluginIds: ReadonlySet<string>;
  readonly retiredBundledPlugins: ReadonlyMap<string, string>;
  readonly bundledArchiveMagic: string;
  readonly filesystem: FilesystemPort;
  readonly clock: AgentPluginClockPort;
  readonly ids: AgentPluginIdsPort;
  readonly process: AgentPluginProcessPort;
  readonly layout: AgentPluginLayoutPort;
  readonly productName: string;
  readonly extensionNamespace: string;
  readonly readServerMetadata?: AgentPluginServerMetadataReader | undefined;
  readonly deliveryMode: AgentPluginDeliveryMode;
  readonly mcpProvisioning: AgentPluginMcpProvisioningPort;
  readonly fetch: AgentPluginFetchPort;
  readonly outboundGuard: AgentPluginOutboundGuardPort;
}

/** Application policy/effects are required; observers and metadata translators are optional. */
export type AgentPluginLifecycleRequired = Omit<AgentPluginLifecyclePorts, 'onEvent' | 'readServerMetadata'>;
export type AgentPluginLifecycleOptional = Pick<AgentPluginLifecyclePorts, 'onEvent' | 'readServerMetadata'>;
