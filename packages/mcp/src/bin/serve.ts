#!/usr/bin/env node
/**
 * @module @jini-ai/mcp/bin/serve
 *
 * The bootable `jini-mcp` binary (`package.json`'s `"bin": { "jini-mcp": "./dist/bin/serve.js" }`)
 * — the real executable entry point gap 3's MCP-callback continuation-transport spike needed and
 * did not have (see `packages/daemon/archived provenance ledger`'s "run/chat orchestration gap 3, part 1"
 * addition, and this package's own dated section in `archived provenance ledger`). `../server/tool-server.js`'s
 * `createMcpToolServer` was always designed to run as *this process's own* stdio — meant to be a
 * script a client (Claude Code) spawns as its own child subprocess and talks to over that child's
 * stdin/stdout — but until this file, nothing in this package actually was that script.
 *
 * Follows the CLI entry point's established shape for a bootable, side-effect-guarded, `#!/usr/bin/env
 * node` entry point: a named, fully-dependency-injected `serve()` export (importable for tests, or
 * for a consumer building its own bin wrapper around it) plus a bottom-of-file guard that only
 * calls it for real when this module is the actual process entrypoint — mirrors that file's own
 * `isMainModule` check (Node's ESM equivalent of the CommonJS `require.main === module` idiom).
 * Deliberately **not** re-exported from `../index.ts`: that barrel is a plain library dependency, and
 * this file's whole purpose is a `process.env`-reading, stdio-serving, potentially `process.exit`-
 * calling side effect — bundling it into the library barrel would mean `import '@jini-ai/mcp'` could
 * start behaving like a spawned MCP server.
 *
 * **Scope: what this process is spawned to do.** One `jini-mcp` process serves exactly one run for
 * its entire lifetime — the spawning daemon injects {@link RUN_ID_ENV_VAR} into the child's own
 * environment before Claude Code (which in turn spawns *this* as its own MCP server child, per its
 * `.mcp.json`) ever starts talking to it. That is what lets `execute_delegated_tool`
 * (`../server/tools/delegated-tool.js`) close over a fixed `runId` at construction time instead of
 * trusting a model-supplied one — see that module's own doc for why that boundary matters. Every
 * other tool this server hosts (`RUN_TOOLS`, `../server/tools/run-tools.js`) is run-agnostic and
 * needed no such scoping.
 *
 * **Daemon-URL resolution** follows the spawning host's environment: no baked-in default, just
 * `resolveDaemonUrl` (the CLI transport) wired to a `--daemon-url`-shaped precedence chain — except this
 * process has no argv to parse (an MCP client launches it with a fixed `command`/`args`/`env`, not
 * interactive flags), so only the env-var step applies: {@link DAEMON_URL_ENV_VAR}. When unset,
 * `resolveDaemonUrl` throws, and this file's own top-level error boundary turns that into a clean
 * stderr message + non-zero exit rather than an unhandled rejection.
 */
import { existsSync, realpathSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createCheckMessagesTool, messageRelayInstructions, type McpMessageRelay } from '../server/message-relay.js';
import { isLoopbackHostname } from '@jini-ai/platform/net';
import type { ToolDescriptor } from '@jini-ai/core';
import { createMcpToolServer as createMcpToolServerDefault, type McpToolServerRequiredArgs, type McpToolServerOptions } from '../server/tool-server.js';
import type { McpToolDef } from '../server/tool-protocol.js';
import { RUN_TOOLS } from '../server/tools/run-tools.js';
import { describeToolTool, TOOL_CATALOG_TOOLS } from '../server/tools/tool-catalog-tools.js';
import { COMPONENT_CATALOG_TOOLS } from '../server/tools/component-catalog-tools.js';
import { createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool } from '../server/tools/delegated-tool.js';
import { KERNEL_RESOURCES } from '../server/resources/active-resource.js';
import { createSiteGuideResource } from '../server/resources/site-guide-resource.js';

/** The one run this process is scoped to for its entire lifetime. Set by the spawning daemon, never by the MCP client. */
export const RUN_ID_ENV_VAR = 'JINI_RUN_ID';
/** Checked (only) when resolving the daemon HTTP base URL — see `resolveDaemonUrl`'s own docs; matches the CLI entry point's identically-named constant. */
export const DAEMON_URL_ENV_VAR = 'JINI_DAEMON_URL';
/**
 * Bearer credential for this process's daemon callbacks, set by the spawning daemon when it issued
 * one (see `@jini-ai/daemon`'s `McpJsonInjectionOptions.credential`).
 *
 * **Optional, unlike {@link RUN_ID_ENV_VAR}.** A daemon whose `/api` surface trusts loopback issues
 * no credential, and this process must keep working against one exactly as before — so an unset
 * value means "send no `Authorization` header", never a startup failure. When a daemon *does*
 * require a credential and none was delivered, that daemon's own gate answers 401; refusing to boot
 * here instead would be guessing at a policy this process cannot observe.
 */
export const DAEMON_TOKEN_ENV_VAR = 'JINI_DAEMON_TOKEN';
/**
 * Overrides the delegated-tool request deadline (see `DEFAULT_DELEGATED_TOOL_TIMEOUT_MS`).
 *
 * **Optional.** This process is spawned as a subprocess by the daemon, so env is the only channel
 * a host has to reach `CreateExecuteDelegatedToolToolOptions.delegatedToolTimeoutMs`; without this
 * var that option would be unreachable in the real deployment path and the default would be the
 * only value the system could ever run with.
 *
 * A host sets it to its own exchange total-lifetime ceiling plus headroom. An unset, non-numeric,
 * or non-positive value means "use the default" rather than a startup failure — same posture as
 * {@link DAEMON_TOKEN_ENV_VAR}, and for the same reason: this process cannot observe the host
 * policy that would make a given number correct, so it must not refuse to boot over one.
 */
export const DELEGATED_TOOL_TIMEOUT_ENV_VAR = 'JINI_DELEGATED_TOOL_TIMEOUT_MS';
/** JSON array of host-selected visible registry IDs; never sourced from diagnostic IDs. */
export const STARTUP_TOOL_IDS_ENV_VAR = 'JINI_STARTUP_TOOL_IDS';

const SERVER_NAME = 'jini-mcp';
const SERVER_VERSION = '0.0.0';
const INSTRUCTIONS =
  'Tools proxying this host\'s Jini daemon over loopback HTTP, scoped to the run that spawned this MCP server process. ' +
  'Use execute_delegated_tool to invoke a Jini-registered tool (never an agent-vendor-specific tool name) against that run — ' +
  'every call is routed through the daemon\'s deny-by-default ToolExecutor gate. ' +
  'Concrete operation tools accept their own arguments directly. describe_tool publishes a concrete definition; ' +
  'refresh tools/list when supported, or use the delegated gateways as the compatibility fallback. ' +
  'When the host provides site_guide, consult jini://site-guide or call site_guide with operation overview ' +
  'through execute_readonly_delegated_tool; follow with explain for the relevant topic ids. ' +
  'If the host does not provide site_guide, report that availability gap.';

export interface ServeDeps {
  /** @default process.env */
  readonly env?: NodeJS.ProcessEnv;
  /** @default process.stderr.write */
  readonly writeErr?: (args: { text: string }) => void;
  /** @default process.exit; inject for tests (must not return) */
  readonly exit?: (args: { code: number }) => never;
  /** @default the real environment-only daemon URL resolution */
  readonly resolveDaemonUrl?: (required: Record<string, never>, options: McpDaemonUrlOptions) => Promise<string>;
  /** @default the real createMcpToolServer */
  readonly createMcpToolServer?: typeof createMcpToolServerDefault;
  /** Threaded into `execute_delegated_tool`'s per-call correlation id. @default node:crypto randomUUID */
  readonly generateToolUseId?: (required: Record<string, never>) => string;
  /** Threaded into every tool's daemon call. @default the global fetch */
  readonly fetchImpl?: typeof fetch;
  /** @default process.stdin */
  readonly stdin?: Readable;
  /** @default process.stdout */
  readonly stdout?: Writable;
}

/** This executable has no flags or discovery phase: its spawning host supplies the environment. */
export interface McpDaemonUrlOptions {
  flagUrl: null;
  env: NodeJS.ProcessEnv;
  envVarName: string;
  warn: (required: { message: string }) => void;
}

// Keep the bin's environment-only assembly here; a general CLI resolver would introduce a
// runtime dependency on another shell. No discovery/default URL is selected for a run child.
async function resolveDaemonUrlDefault(_required: Record<string, never>, options: McpDaemonUrlOptions): Promise<string> {
  const url = options.env[options.envVarName];
  if (!url) {
    throw new Error(`no daemon URL resolved: ${options.envVarName} is unset or empty; ` +
      'the spawning Jini daemon must set it to its HTTP base URL.');
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  if (parsed.protocol !== 'https:' && !isLoopbackHostname({ hostname: parsed.hostname })) {
    options.warn({ message: `daemon URL ${redactUserinfo(url, parsed)} is neither loopback nor HTTPS; traffic to a remote, non-HTTPS daemon is not encrypted.` });
  }
  return url;
}

// Keeps credentials out of the warning; a URL without userinfo is shown exactly as given.
function redactUserinfo(url: string, parsed: URL): string {
  if (!parsed.username && !parsed.password) return url;
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

function defaultWriteErr({ text }: { text: string }): void {
  process.stderr.write(text);
}

/**
 * Assembles and runs the `jini-mcp` stdio MCP server: `RUN_ID_ENV_VAR` (required — this process
 * has no meaningful default run to serve) plus `DAEMON_URL_ENV_VAR` resolution, then hosts
 * `RUN_TOOLS` (run-agnostic) alongside a fresh `execute_delegated_tool` def scoped to the resolved
 * `runId`, and `KERNEL_RESOURCES`. Resolves once the client disconnects (stdin EOF) or the
 * idle-exit window elapses (`createMcpToolServer`'s own default). Enables describe publication and
 * resolves startup descriptors before connecting stdio. Never bare-throws: every error
 * path below writes a message to `writeErr` and calls `exit(1)` instead.
 */
export async function serve(_requiredArgs: Record<string, never>, deps: ServeDeps = {}): Promise<void> {
  const { env, writeErr, exit, resolveDaemonUrlFn, createMcpToolServerFn } = withProcessDefaults(deps);

  const runId = env[RUN_ID_ENV_VAR];
  if (typeof runId !== 'string' || runId.length === 0) {
    writeErr({ text: `${SERVER_NAME}: missing required ${RUN_ID_ENV_VAR} environment variable (this process must be spawned by a Jini daemon, which sets it)\n` });
    exit({ code: 1 });
    return;
  }

  let baseUrlResolution: Promise<string> | undefined;
  const resolveBaseUrl = (): Promise<string> => {
    const options: McpDaemonUrlOptions = { flagUrl: null, env, envVarName: DAEMON_URL_ENV_VAR, warn: ({ message }) => writeErr({ text: message }) };
    // Startup discovery and subsequent execution must use the same resolved daemon.
    baseUrlResolution ??= resolveDaemonUrlFn({}, options);
    return baseUrlResolution;
  };

  const delegatedGatewayOptions = buildDelegatedGatewayOptions({ env }, deps);
  const messageRelay = resolveMessageRelay({ env, runId, writeErr, exit });
  const requiredArgs: McpToolServerRequiredArgs = {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools: [...buildTools({ runId, delegatedGatewayOptions }), ...(messageRelay ? [createCheckMessagesTool(messageRelay)] : [])],
    resolveBaseUrl,
  };
  const serverOptions = buildServerOptions({ env, runId, delegatedGatewayOptions }, deps);
  if (messageRelay) Object.assign(serverOptions, { messageRelay, instructions: `${INSTRUCTIONS} ${messageRelayInstructions(messageRelay)}` });

  try {
    const diagnosticToolIds = parseLaunchToolIds({ env, key: 'JINI_DIAGNOSTIC_TOOL_IDS' });
    if (diagnosticToolIds.length) Object.assign(serverOptions, { diagnosticToolIds });
    const initialTools = await resolveStartupTools({
      toolIds: parseLaunchToolIds({ env, key: STARTUP_TOOL_IDS_ENV_VAR }), resolveBaseUrl, serverOptions,
    });
    Object.assign(serverOptions, { delegatedTools: { runId, ...delegatedGatewayOptions, initialTools } });
    await createMcpToolServerFn(requiredArgs, serverOptions).run({});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErr({ text: `${SERVER_NAME}: ${message}\n` });
    exit({ code: 1 });
  }
}

/** Enable both relay surfaces only for a trusted spawn flag with its per-run nonce.
 * Invalid enabled configuration fails startup through the existing stderr/exit boundary. */
function resolveMessageRelay({ env, runId, writeErr, exit }: {
  env: NodeJS.ProcessEnv; runId: string;
  writeErr: NonNullable<ServeDeps['writeErr']>; exit: NonNullable<ServeDeps['exit']>;
}, _options = {}): McpMessageRelay | undefined {
  if (env.JINI_MESSAGE_RELAY !== '1') return undefined;
  const nonce = env.JINI_MESSAGE_RELAY_NONCE ?? '';
  if (!/^[a-f0-9]{48}$/u.test(nonce)) {
    writeErr({ text: `${SERVER_NAME}: relay spawn requires a 48-hex-character JINI_MESSAGE_RELAY_NONCE\n` });
    return exit({ code: 1 });
  }
  return { runId, nonce };
}

// The process-bound fallbacks for every injectable seam `serve()` itself calls.
function withProcessDefaults(deps: ServeDeps) {
  return {
    env: deps.env ?? process.env,
    writeErr: deps.writeErr ?? defaultWriteErr,
    exit: deps.exit ?? (({ code }: { code: number }): never => process.exit(code)),
    resolveDaemonUrlFn: deps.resolveDaemonUrl ?? resolveDaemonUrlDefault,
    createMcpToolServerFn: deps.createMcpToolServer ?? createMcpToolServerDefault,
  };
}

type DelegatedGatewayOptions = { generateToolUseId?: (required: Record<string, never>) => string; delegatedToolTimeoutMs?: number; delegatedResultMarkers?: boolean };

// Drops `undefined` values so an absent dependency leaves no key at all — required under
// `exactOptionalPropertyTypes`, and it keeps built option objects byte-identical to the
// pre-injection shape when nothing is overridden.
function definedOnly<T extends Record<string, unknown>>(entries: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

// Shared by both gateways so their run scope, correlation-id source, and deadline cannot diverge
// — the only difference between the two defs is the read-only constraint each declares.
function buildDelegatedGatewayOptions({ env }: { env: NodeJS.ProcessEnv }, deps: ServeDeps): DelegatedGatewayOptions {
  const rawTimeout = env[DELEGATED_TOOL_TIMEOUT_ENV_VAR];
  return definedOnly({
    generateToolUseId: deps.generateToolUseId,
    delegatedResultMarkers: env.JINI_DELEGATED_RESULT_MARKERS === '1' ? true : undefined,
    // Parsed, not validated: `createExecuteDelegatedToolTool` already rejects a non-finite or
    // non-positive value back to the default, so `NaN` from a malformed env var lands there too.
    delegatedToolTimeoutMs: rawTimeout === undefined ? undefined : Number(rawTimeout),
  });
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
  ];
}

function buildServerOptions(
  { env, runId, delegatedGatewayOptions }: { env: NodeJS.ProcessEnv; runId: string; delegatedGatewayOptions: DelegatedGatewayOptions },
  deps: ServeDeps,
): McpToolServerOptions {
  // Absent credential => no `authHeaders` at all => byte-identical request headers to before this
  // env var existed. See DAEMON_TOKEN_ENV_VAR's doc for why an unset value is not a startup failure.
  const credential = env[DAEMON_TOKEN_ENV_VAR];
  return {
    resources: [...KERNEL_RESOURCES, createSiteGuideResource({ runId }, delegatedGatewayOptions)],
    instructions: INSTRUCTIONS,
    ...definedOnly({
      authHeaders: credential ? { Authorization: `Bearer ${credential}` } : undefined,
      fetchImpl: deps.fetchImpl,
      stdin: deps.stdin,
      stdout: deps.stdout,
    }),
  };
}

// Only the spawning host supplies registration metadata. Never learn exceptions from an
// error body or model arguments: either would turn a secret into its own redaction exemption.
function parseLaunchToolIds({ env, key }: { env: NodeJS.ProcessEnv; key: string }): string[] {
  const toolIds: unknown = JSON.parse(env[key] ?? '[]');
  if (!Array.isArray(toolIds) || !toolIds.every(id => typeof id === 'string')) {
    throw new Error(`${key} must be a JSON array of registered tool IDs`);
  }
  return toolIds;
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

// Only run for real when this module is the actual process entrypoint (`node dist/bin/serve.js`,
// or the `jini-mcp` bin shim pnpm/npm links to it) — not merely imported, e.g. by this file's own
// tests importing the named `serve` export above. Mirrors the CLI entry point's identical guard.
// Canonical paths recognize npm bin symlinks; a missing argv path is an unrelated import.
const isMainModule = process.argv[1] !== undefined && existsSync(process.argv[1])
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMainModule) {
  await serve({});
}
