/** The run MCP surface shared by stdio children and in-process HTTP listeners. No process defaults. */
import { createCheckMessagesTool, messageRelayInstructions, type McpMessageRelay } from './message-relay.js';
import type { ToolDescriptor } from '@jini-ai/core';
import type { McpToolServerRequiredArgs, McpToolServerOptions } from './tool-server.js';
import type { McpToolDef } from './tool-protocol.js';
import { waitTool } from './tools/wait.js';
import { RUN_TOOLS } from './tools/run-tools.js';
import { describeToolTool, TOOL_CATALOG_TOOLS } from './tools/tool-catalog-tools.js';
import { COMPONENT_CATALOG_TOOLS } from './tools/component-catalog-tools.js';
import { createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool } from './tools/delegated-tool.js';
import { KERNEL_RESOURCES } from './resources/active-resource.js';
import { createSiteGuideResource } from './resources/site-guide-resource.js';

const SERVER_NAME = 'jini-mcp';
const SERVER_VERSION = '0.0.0';
const INSTRUCTIONS =
  'Tools proxying this host\'s Jini daemon over loopback HTTP, scoped to the run that spawned this MCP server process. ' +
  'Use execute_delegated_tool to invoke a Jini-registered tool (never an agent-vendor-specific tool name) against that run — ' +
  'Registered operation calls use the daemon\'s deny-by-default ToolExecutor gate; ' +
  'MCP-local names use their existing validated handlers. ' +
  'Concrete operation tools accept their own arguments directly. describe_tool publishes a concrete definition; ' +
  'refresh tools/list when supported, or use the delegated gateways as the compatibility fallback. ' +
  'When the host provides site_guide, consult jini://site-guide or call site_guide with operation overview ' +
  'through execute_readonly_delegated_tool; follow with explain for the relevant topic ids. ' +
  'If the host does not provide site_guide, report that availability gap. ' +
  'Use host tools first. For saved oversized tool results, call read_tool_result with the resultId and follow nextOffset. ' +
  'For attachments, use the host attachment/image tool first or a native Read/image tool on the supplied path. ' +
  'Never use Bash, shell commands or scripts to inspect attachments or saved tool results. ' +
  'Between background job polls, honor poll_after_seconds with wait_for({seconds: <interval up to 60>}); repeat for longer intervals. ' +
  'Never use Bash or shell sleep between polls. A provider wait tool is optional: describe its live schema before calling it.';

export interface RunToolHostInput {
  readonly runId: string;
  readonly resolveBaseUrl: () => Promise<string> | string;
}
export interface RunToolHostOptions {
  readonly credential?: string;
  readonly startupToolIds?: readonly string[];
  readonly diagnosticToolIds?: readonly string[];
  readonly messageRelayNonce?: string;
  readonly delegatedToolTimeoutMs?: number;
  readonly delegatedResultMarkers?: boolean;
  readonly generateToolUseId?: (required: Record<string, never>) => string;
  readonly fetchImpl?: typeof fetch;
}
export interface RunToolHost {
  readonly required: McpToolServerRequiredArgs;
  readonly options: McpToolServerOptions;
}

/** Assemble one run's authenticated gateways, publication, resources, paging and relay.
 * @param input - Trusted run identity and explicit daemon URL resolver.
 * @param options - Explicit callback credential, launch metadata and optional I/O seams.
 * @returns Transport-neutral arguments for the existing MCP host.
 * @throws Invalid relay nonce or existing authenticated descriptor resolution errors.
 * @complexity O(n + s) time/space and n sequential bounded GETs for n unique startup IDs and s schema bytes.
 */
export async function assembleRunToolHost(input: RunToolHostInput, options: RunToolHostOptions = {}): Promise<RunToolHost> {
  const { runId } = input;
  let resolved: Promise<string> | undefined;
  // Startup discovery and subsequent execution must use the same resolved daemon.
  const resolveBaseUrl = () => resolved ??= Promise.resolve().then(input.resolveBaseUrl);
  const delegatedGatewayOptions = definedOnly({ generateToolUseId: options.generateToolUseId,
    delegatedToolTimeoutMs: options.delegatedToolTimeoutMs, delegatedResultMarkers: options.delegatedResultMarkers });
  const messageRelay = relayForRun({ runId, nonce: options.messageRelayNonce });
  const required: McpToolServerRequiredArgs = { name: SERVER_NAME, version: SERVER_VERSION, resolveBaseUrl,
    tools: [...buildTools({ runId, delegatedGatewayOptions }), ...(messageRelay ? [createCheckMessagesTool(messageRelay)] : [])] };
  // Absent credential => no authHeaders, preserving unauthenticated loopback hosts.
  const serverOptions: McpToolServerOptions = {
    resources: [...KERNEL_RESOURCES, createSiteGuideResource({ runId }, delegatedGatewayOptions)],
    instructions: INSTRUCTIONS, resultPaging: true,
    ...definedOnly({ authHeaders: options.credential ? { Authorization: `Bearer ${options.credential}` } : undefined,
      fetchImpl: options.fetchImpl, diagnosticToolIds: options.diagnosticToolIds }),
    ...(messageRelay ? { messageRelay, instructions: `${INSTRUCTIONS} ${messageRelayInstructions(messageRelay)}` } : {}),
  };
  const initialTools = await resolveStartupTools({ toolIds: options.startupToolIds ?? [], resolveBaseUrl, serverOptions });
  return { required, options: { ...serverOptions, delegatedTools: { runId, ...delegatedGatewayOptions, initialTools } } };
}

/** A malformed trusted relay flag must fail before a client receives a partially enabled surface. */
function relayForRun({ runId, nonce }: { runId: string; nonce: string | undefined }): McpMessageRelay | undefined {
  if (nonce === undefined) return undefined;
  if (!/^[a-f0-9]{48}$/u.test(nonce)) throw new Error('relay requires a 48-hex-character nonce');
  return { runId, nonce };
}

type DelegatedGatewayOptions = Pick<RunToolHostOptions, 'generateToolUseId' | 'delegatedToolTimeoutMs' | 'delegatedResultMarkers'>;

// Drops `undefined` values so an absent dependency leaves no key at all — required under
// `exactOptionalPropertyTypes`, and it keeps built option objects byte-identical to the
// pre-injection shape when nothing is overridden.
function definedOnly<T extends Record<string, unknown>>(entries: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function buildTools({ runId, delegatedGatewayOptions }: { runId: string; delegatedGatewayOptions: DelegatedGatewayOptions }): readonly McpToolDef[] {
  return [
    ...RUN_TOOLS,
    ...TOOL_CATALOG_TOOLS,
    ...COMPONENT_CATALOG_TOOLS,
    createExecuteDelegatedToolTool({ runId }, delegatedGatewayOptions),
    // Hosted ALONGSIDE the unconstrained gateway, never instead of it. A client that gates on
    // `readOnlyHint: true` can now reach the read half of the catalog at all; every other client
    // sees both and picks by what its call actually does.
    createExecuteReadonlyDelegatedToolTool({ runId }, delegatedGatewayOptions),
    waitTool,
  ];
}

/**
 * Resolve each unique startup ID through the existing authenticated describe/publication owner.
 * The temporary descriptor list seeds M1's bounded exposure; it is not an execution catalog.
 * Failure aborts startup before any partially resolved list can reach the client.
 * @returns Authoritative descriptors; no daemon I/O when startup IDs are absent.
 * @throws The existing descriptor/daemon errors, reported by serve's stderr/exit boundary.
 * @complexity O(n + s) space/time plus n sequential bounded GETs for n unique IDs and s schema bytes.
 */
async function resolveStartupTools({ toolIds, resolveBaseUrl, serverOptions }: {
  toolIds: readonly string[]; resolveBaseUrl: () => Promise<string>; serverOptions: McpToolServerOptions;
}): Promise<readonly ToolDescriptor[]> {
  if (toolIds.length === 0) return [];
  const descriptors: ToolDescriptor[] = [];
  const ctx = {
    baseUrl: await resolveBaseUrl(),
    fetchImpl: serverOptions.fetchImpl ?? fetch,
    ...definedOnly({ authHeaders: serverOptions.authHeaders, diagnosticToolIds: serverOptions.diagnosticToolIds }),
    publishTool: async ({ descriptor }: { descriptor: ToolDescriptor }) => { descriptors.push(descriptor); },
  };
  for (const id of new Set(toolIds)) await describeToolTool.handler({ args: { id }, ctx });
  return descriptors;
}

