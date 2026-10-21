import { defaultRuntimeState, type AgentRuntimeState } from './runtime-state.js';
import { execFile, type ExecFileOptions, type SpawnOptions } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createCommandInvocation } from '@jini-ai/platform/command';
import { nativeAcpModelProbe, type AcpModelProbe } from './acp-model-probe.js';
import { CLAUDE_CODE_INITIALIZE_ARGS, CLAUDE_CODE_INITIALIZE_REQUEST } from './claude-code-models.js';
import { listProviderModels, type ProviderModelsInput } from './providers/model-catalog.js';
import { execAgentFile } from './invocation.js';
import { scheduleProbeProcess } from './probe-scheduler.js';
import { probeCopilotSdk, probeDroidSdk } from './model-discovery-sdk.js';
import { parseSettingsJson, readModelConfiguration } from './model-discovery-config.js';
import { ModelProbeError, modelIdentityKind, withModelProbeTimeout } from './model-discovery-shared.js';
import type { AgentDiscoveryConfiguration, DiscoveredModel, ModelDiscoveryContext, ModelDiscoveryDeps, ModelProbeResult } from './model-discovery-types.js';
import type { ProviderModelsKind } from './providers/types.js';

const ACP_ARGS: Record<string, readonly string[]> = {
  amr: ['agent', 'run', '--runtime', 'opencode'],
  auggie: ['--acp'], cline: ['--acp'], devin: ['--permission-mode', 'dangerous', '--respect-workspace-trust', 'false', 'acp'],
  goose: ['acp'], hermes: ['acp', '--accept-hooks'], kilo: ['acp'], kimi: ['acp'], kiro: ['acp'], reasonix: ['acp'], 'trae-cli': ['acp', 'serve'], vibe: [],
};
const CLI_ARGS: Record<string, readonly string[]> = {
  // UNVERIFIED adapters: commands documented by upstream/the survey; schemas need installed checks.
  amp: ['plugins', 'show-agent-options', '--json'], crush: ['models'], deepseek: ['models'], qoder: ['--list-models'],
};
export function modelProbeTimeoutMs(agentId: string): number {
  if (ACP_ARGS[agentId] || ['claude', 'codebuddy', 'pi', 'copilot', 'droid'].includes(agentId)) return 15_000;
  return 10_000;
}
/** Shared CLI-subcommand adapter. Output parsers are pure def-owned functions, not vendor tools. */
export async function probeCliSubcommand(context: ModelDiscoveryContext, config: AgentDiscoveryConfiguration, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const timeoutMs = config.timeoutMs ?? 8_000;
  const { stdout } = await withModelProbeTimeout(active => deps.process.run({ context, args: config.args || [], signal: active, timeoutMs }), timeoutMs, signal);
  const models = config.parse?.({ stdout });
  if (!models) throw new ModelProbeError('malformed-response');
  const defaultSelectionId = stdout.match(/^\s*Default model:\s*(\S+)\s*$/mi)?.[1];
  return { models, source: 'cli', coverage: 'account', ...(defaultSelectionId ? { defaultSelectionId } : {}) };
}
/** ACP can create CLI session state/start services. It never sends a user prompt. */
export async function probeAcpMetadata(context: ModelDiscoveryContext, args: readonly string[], deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  return deps.acp.probe({ context, args, signal });
}
/** Spread a native default selection only when the source reported one. */
function withDefaultSelection(defaultSelectionId: string | undefined): { defaultSelectionId?: string } {
  return defaultSelectionId ? { defaultSelectionId } : {};
}
type ClaudeModelRow = { value?: unknown; resolvedModel?: unknown; displayName?: unknown } | null;
/** The model rows of one successful initialize control response, or null for any other line. */
function claudeInitializeRows(line: string): ClaudeModelRow[] | null {
  let obj: Record<string, unknown> | null;
  try { obj = JSON.parse(line) as Record<string, unknown>; } catch { return null; }
  if (obj?.type !== 'control_response') return null;
  const response = obj.response as { subtype?: string; response?: { models?: unknown } } | undefined;
  const rows = response?.subtype === 'success' ? response.response?.models : undefined;
  return Array.isArray(rows) ? rows : null;
}
/** One selection row, plus its concrete resolved row when the selection is an alias. */
function claudeSelectionModels(id: string, resolvedId: string | undefined, displayName: unknown): DiscoveredModel[] {
  const label = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : resolvedId || id;
  const identityKind = id === resolvedId ? 'concrete' : resolvedId ? 'alias' : modelIdentityKind(id);
  const selection: DiscoveredModel = { id, label, identityKind, ...(resolvedId ? { resolvedId } : {}) };
  if (!resolvedId || id === resolvedId) return [selection];
  return [selection, { id: resolvedId, label, identityKind: modelIdentityKind(resolvedId) }];
}
function claudeInitializeResult(rows: readonly ClaudeModelRow[]): ModelProbeResult {
  const models: DiscoveredModel[] = [];
  let defaultSelectionId: string | undefined;
  for (const row of rows) {
    if (!row || typeof row.value !== 'string') continue;
    const id = row.value.trim();
    const resolvedId = typeof row.resolvedModel === 'string' ? row.resolvedModel.trim() : undefined;
    if (id !== 'default') { models.push(...claudeSelectionModels(id, resolvedId, row.displayName)); continue; }
    // This displayName describes the CLI's default policy, not the model it resolves to.
    if (resolvedId && modelIdentityKind(resolvedId) === 'concrete') { defaultSelectionId = resolvedId; models.push({ id: resolvedId, label: resolvedId, identityKind: 'concrete' }); }
  }
  return { models, source: 'rpc', coverage: 'account', ...withDefaultSelection(defaultSelectionId) };
}
/** Keep selection IDs, resolved concrete IDs and display names, including capability variants.
 * Default-policy display names become the exact resolved ID; malformed responses return null.
 * @complexity O(s + n) time and space in stdout length s and listed models n.
 */
export function parseClaudeInitializeMetadata(stdout: string): ModelProbeResult | null {
  for (const line of stdout.split('\n')) {
    const rows = claudeInitializeRows(line);
    if (rows) return claudeInitializeResult(rows);
  }
  return null;
}
/** Shared initialize category; CodeBuddy compatibility remains UNVERIFIED locally. */
export async function probeClaudeInitialize(context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const args = [...CLAUDE_CODE_INITIALIZE_ARGS];
  if (context.settingSources) args.push('--setting-sources', context.settingSources.join(','));
  // The last settings argument must still disable hooks; the probe never executes hooks.
  const raw = context.settings ? (context.settings.trim().startsWith('{') ? context.settings : await deps.fs.read(context.settings, { signal })) : null;
  const settings = raw ? parseSettingsJson(raw) : undefined;
  if (settings) args.push('--settings', JSON.stringify({ ...settings, disableAllHooks: true }));
  const result = await deps.process.run({ context, args, stdin: CLAUDE_CODE_INITIALIZE_REQUEST, signal, timeoutMs: 15_000 });
  const metadata = parseClaudeInitializeMetadata(result.stdout);
  if (!metadata?.models.length) throw new ModelProbeError('malformed-response');
  return metadata;
}
const PROVIDER_LIST_FAILURES: Partial<Record<ProviderModelsKind, ModelProbeError['code']>> = { auth_failed: 'auth-missing', timeout: 'timeout' };
/** Aider qualifies listed rows with the provider of a qualified selection ("openai/" for "openai/gpt-x"). */
function aiderProviderPrefix(agentId: string, selection: string | undefined): string {
  return agentId === 'aider' && selection?.includes('/') ? selection.slice(0, selection.indexOf('/') + 1) : '';
}
export async function probeProviderApi(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const config = await readModelConfiguration(agentId, context, deps, signal);
  const effectiveContext = config.selection ? { ...context, model: config.selection } : context;
  const input = await deps.credential.connection({ agentId, context: effectiveContext, signal });
  if (!input) throw new ModelProbeError('auth-missing');
  if (input.protocol === 'bedrock' || input.protocol === 'azure') throw new ModelProbeError('unsupported-version');
  const result = await deps.http.list({ ...input, signal });
  if (!result.ok || !result.models) throw new ModelProbeError(PROVIDER_LIST_FAILURES[result.kind] ?? 'offline');
  const prefix = aiderProviderPrefix(agentId, config.selection);
  return { models: result.models.map((row) => ({ ...row, id: prefix && !row.id.startsWith(prefix) ? `${prefix}${row.id}` : row.id })), source: 'provider-api', coverage: 'provider' };
}
type CliCache = { path(env: ModelDiscoveryContext['env'], home: string): string; models(data: Record<string, unknown>): DiscoveredModel[] };
const optionCacheModels = (data: Record<string, unknown>) => configurationCacheModels(data.additionalModelOptionsCache);
const CLI_CACHES = new Map<string, CliCache>([
  ['codex', { path: (env, home) => join(env.CODEX_HOME || join(home, '.codex'), 'models_cache.json'), models: (data) => configurationCacheModels(data.models) }],
  ['opencode', { path: (env, home) => join(env.XDG_CACHE_HOME || join(home, '.cache'), 'opencode/models.json'), models: opencodeCacheModels }],
  ['claude', { path: (env, home) => join(env.CLAUDE_CONFIG_DIR || home, '.claude.json'), models: optionCacheModels }],
  // UNVERIFIED CodeBuddy cache schema. Configured model is weaker than an account catalog.
  ['codebuddy', { path: (_env, home) => join(home, '.codebuddy/settings.json'), models: optionCacheModels }],
]);
/** Caches are partial observed catalogs, always stale, never silently promoted to live. */
export async function probeCliCache(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const cache = CLI_CACHES.get(agentId);
  if (!cache) throw new ModelProbeError('unsupported-version');
  const raw = await deps.fs.read(cache.path(context.env, context.env.HOME || homedir()), { signal });
  const data = raw ? parseSettingsJson(raw) : null;
  if (!data) throw new ModelProbeError('offline');
  return { models: cache.models(data), source: 'cli-cache', coverage: 'observed' };
}
function opencodeCacheModels(data: Record<string, unknown>): DiscoveredModel[] {
  return Object.entries(data).flatMap(([provider, value]) => {
    const entries = value && typeof value === 'object' ? (value as { models?: Record<string, { name?: string }> }).models : undefined;
    return Object.entries(entries || {}).map(([id, row]) => ({ id: `${provider}/${id}`, label: row.name || `${provider}/${id}`, provider, identityKind: modelIdentityKind(id) }));
  });
}
function configurationCacheModels(entries: unknown): DiscoveredModel[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((row) => {
    const id = typeof row?.slug === 'string' ? row.slug : typeof row?.value === 'string' ? row.value : typeof row?.id === 'string' ? row.id : undefined;
    return id ? [{ id, label: row.display_name || row.displayName || id, identityKind: modelIdentityKind(id) }] : [];
  });
}
function parseGenericCliModels(stdout: string): DiscoveredModel[] {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { parsed = null; }
  if (parsed) {
    const object = parsed as { models?: unknown; model?: unknown };
    const entries = Array.isArray(parsed) ? parsed : object.models;
    if (Array.isArray(entries)) return entries.flatMap((row) => {
      const id = typeof row === 'string' ? row : typeof row?.id === 'string' ? row.id : typeof row?.model === 'string' ? row.model : undefined;
      return id ? [{ id, label: typeof row?.name === 'string' ? row.name : id, identityKind: modelIdentityKind(id) }] : [];
    });
  }
  return stdout.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(?:[-*•]\s*)?([\w][\w./:[\]-]*)(?:\s+-\s+(.+))?$/);
    if (!match || /^(models|available|provider|model)$/i.test(match[1]!)) return [];
    return [{ id: match[1]!, label: match[2] || match[1]!, identityKind: modelIdentityKind(match[1]!) }];
  });
}
type AgentProbe = (agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal) => Promise<ModelProbeResult>;
const probeRpc: AgentProbe = (agentId, context, deps, signal) => deps.rpc.probe({ agentId, context, signal });
async function probeClaudeCatalog(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  try {
    return await probeClaudeInitialize(context, deps, signal);
  } catch {
    try { return await probeProviderApi(agentId, context, deps, signal); }
    catch { return probeCliCache(agentId, context, deps, signal); }
  }
}
async function probeCodeBuddyCatalog(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  // UNVERIFIED: survey identifies initialize compatibility as a candidate, not a guarantee.
  // Try the same prompt-free metadata category; failed compatibility stays explicitly offline.
  try { return await probeClaudeInitialize(context, deps, signal); }
  catch { return probeCliCache(agentId, context, deps, signal); }
}
/** Agents with a dedicated discovery category, checked before any declared listing command. */
const AGENT_PROBES = new Map<string, AgentProbe>([
  ['claude', probeClaudeCatalog],
  ['pi', probeRpc], ['copilot', probeRpc], ['droid', probeRpc],
  // UNVERIFIED CLI-owned effective credential adapters; OAuth/unknown endpoints require host ports.
  ['aider', probeProviderApi], ['qwen', probeProviderApi], ['mimo', probeProviderApi],
  ['codebuddy', probeCodeBuddyCatalog],
]);
const DISK_CACHE_LISTINGS = new Set(['codex', 'opencode']);
async function probeDeclaredListing(agentId: string, context: ModelDiscoveryContext, configuration: AgentDiscoveryConfiguration, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  // Only disk-cache adapters reserve two seconds for recovery. Antigravity has no disk
  // fallback, so its declared listing timeout can use the full outer discovery budget.
  const diskCache = DISK_CACHE_LISTINGS.has(agentId);
  const budget = modelProbeTimeoutMs(agentId) - (diskCache ? 2_000 : 0);
  const timeoutMs = Math.min(configuration.timeoutMs ?? 8_000, budget);
  try { return await probeCliSubcommand(context, { ...configuration, timeoutMs }, deps, signal); }
  catch (error) {
    if (!diskCache) throw error;
    try { return await probeCliCache(agentId, context, deps, signal); } catch { throw error; }
  }
}
async function probeAmrAcp(context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const metadata = await probeAcpMetadata(context, ACP_ARGS.amr!, deps, signal);
  const first = metadata.models.find((row) => row.id !== 'default' && modelIdentityKind(row.id) === 'concrete');
  if (!first) throw new ModelProbeError('malformed-response');
  return { ...metadata, defaultSelectionId: context.env.VELA_DEFAULT_MODEL || metadata.defaultSelectionId || first.id };
}
async function probeAmrList(context: ModelDiscoveryContext, configuration: AgentDiscoveryConfiguration, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const result = await deps.process.run({ context, args: ['model', 'list', '--format', 'json'], signal, timeoutMs: 10_000 });
  const models = configuration.parse?.({ stdout: result.stdout }) || [];
  // Vela requires an explicit concrete set_model before prompting; retain the first native row.
  const first = models.find((row) => row.id !== 'default');
  return { models, source: 'cli', coverage: 'account', ...(first ? { defaultSelectionId: context.env.VELA_DEFAULT_MODEL || first.id } : {}) };
}
async function probeAmrCatalog(context: ModelDiscoveryContext, configuration: AgentDiscoveryConfiguration, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  // Every ACP def uses this category. Vela's documented list command remains a fallback
  // when its ACP version omits the model catalog; launch still confirms explicit selection.
  try { return await probeAmrAcp(context, deps, signal); }
  catch (error) { if (signal.aborted) throw error; }
  return probeAmrList(context, configuration, deps, signal);
}
export async function probeAgentCatalog(agentId: string, context: ModelDiscoveryContext, configuration: AgentDiscoveryConfiguration, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const acpArgs = ACP_ARGS[agentId];
  // UNVERIFIED installed ACP agents: existing declared commands; metadata preserves native defaults.
  if (acpArgs && agentId !== 'amr') return probeAcpMetadata(context, acpArgs, deps, signal);
  const probe = AGENT_PROBES.get(agentId);
  if (probe) return probe(agentId, context, deps, signal);
  if (configuration.args) return probeDeclaredListing(agentId, context, configuration, deps, signal);
  if (agentId === 'amr') return probeAmrCatalog(context, configuration, deps, signal);
  const args = CLI_ARGS[agentId];
  if (!args) throw new ModelProbeError('unsupported-version');
  return probeCliSubcommand(context, { ...configuration, args, parse: ({ stdout }) => parseGenericCliModels(stdout) }, deps, signal);
}

function runProcess(input: Parameters<ModelDiscoveryDeps['process']['run']>[0]): ReturnType<ModelDiscoveryDeps['process']['run']> {
  if (input.stdin === undefined) return execAgentFile({ command: input.context.executable, args: [...input.args] }, { options: {
    cwd: input.context.cwd, env: input.context.env as NodeJS.ProcessEnv, signal: input.signal,
    timeout: input.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
  } }).then(({ stdout, stderr }) => ({ stdout: String(stdout), stderr: String(stderr) }));
  return scheduleProbeProcess({ work: () => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    let completed = false;
    let captured = '';
    const invocation = createCommandInvocation({ command: input.context.executable, args: [...input.args], env: input.context.env });
    const tree = input.terminateProcessTree && process.platform !== 'win32';
    let treeTimer: ReturnType<typeof setTimeout> | undefined;
    const killTree = () => { if (tree && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
    // execFile forwards `detached` to spawn at runtime, but its typings omit it; a typed
    // variable (not a literal) keeps the process-group option without a cast.
    const options: ExecFileOptions & Pick<SpawnOptions, 'detached'> = { cwd: input.context.cwd, env: input.context.env as NodeJS.ProcessEnv,
      timeout: input.timeoutMs, killSignal: 'SIGKILL', signal: input.signal, maxBuffer: 8 * 1024 * 1024,
      detached: Boolean(tree),
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    };
    const child = execFile(invocation.command, invocation.args, options, (error, stdout, stderr) => {
      if (treeTimer) clearTimeout(treeTimer);
      input.signal.removeEventListener('abort', killTree);
      if (error) killTree();
      const settle = () => { error && !completed ? reject(error) : resolve({ stdout: String(stdout), stderr: String(stderr) }); };
      if (child.pid && child.exitCode === null && child.signalCode === null) child.once('close', settle);
      else settle();
    });
    if (tree) {
      input.signal.addEventListener('abort', killTree, { once: true });
      treeTimer = setTimeout(killTree, input.timeoutMs);
      // No already-aborted check here: the probe scheduler refuses a cancelled signal immediately
      // before running this executor, and nothing between that check and this line yields.
    }
    if (input.complete) child.stdout?.on('data', (chunk) => {
      captured += String(chunk);
      if (input.complete?.(captured)) { completed = true; child.kill('SIGKILL'); }
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input.stdin);
  }) }, { signal: input.signal });
}
/** Load the catalog owner only for a default URL, so importing the runtime never needs this peer.
 * @param required - The vendor whose default endpoint is needed.
 * @returns The catalog-owned base URL; explicit host URLs bypass this lookup.
 * @throws An actionable load error retaining the original import failure as its cause.
 * @complexity O(1) lookup after Node's cached module load.
 */
async function defaultProviderBaseUrl(
  { provider }: { provider: keyof typeof import('@jini-ai/integrations/media-providers/catalog').VENDOR_API_BASE_URLS },
  _optional: Record<string, never> = {},
): Promise<string> {
  try {
    const { VENDOR_API_BASE_URLS } = await import('@jini-ai/integrations/media-providers/catalog');
    return VENDOR_API_BASE_URLS[provider];
  } catch (cause) {
    throw new Error('Could not load @jini-ai/integrations/media-providers/catalog. Install the optional peer @jini-ai/integrations or inject ModelDiscoveryDeps.credential to discover models with default provider URLs.', { cause });
  }
}

type ProviderName = keyof typeof import('@jini-ai/integrations/media-providers/catalog').VENDOR_API_BASE_URLS;
type EnvConnection = {
  protocol: ProviderModelsInput['protocol']; provider: ProviderName; key: string;
  matches(selected: string, agentId: string, env: ModelDiscoveryContext['env']): boolean;
  baseUrl(env: ModelDiscoveryContext['env']): string | undefined;
};
/** First matching rule with its key present wins; a match without a key falls through to the next rule. */
const ENV_CONNECTIONS: readonly EnvConnection[] = [
  { protocol: 'anthropic', provider: 'anthropic', key: 'ANTHROPIC_API_KEY', matches: (selected) => /^(anthropic\/|claude-)/.test(selected), baseUrl: (env) => env.ANTHROPIC_BASE_URL },
  { protocol: 'google', provider: 'google', key: 'GEMINI_API_KEY', matches: (selected) => /^(gemini\/|google\/|gemini-)/.test(selected), baseUrl: () => undefined },
  { protocol: 'openai', provider: 'openrouter', key: 'OPENROUTER_API_KEY', matches: (selected) => /^openrouter\//.test(selected), baseUrl: (env) => env.OPENROUTER_API_BASE },
  { protocol: 'openai', provider: 'openai', key: 'OPENAI_API_KEY',
    matches: (selected, agentId, env) => /^(openai\/|gpt-|o\d)/.test(selected) || agentId === 'qwen' && Boolean(env.OPENAI_MODEL || env.OPENAI_BASE_URL),
    baseUrl: (env) => env.OPENAI_BASE_URL || env.OPENAI_API_BASE },
];
async function envConnection(rule: EnvConnection, env: ModelDiscoveryContext['env']): Promise<ProviderModelsInput> {
  return { protocol: rule.protocol, baseUrl: rule.baseUrl(env) || await defaultProviderBaseUrl({ provider: rule.provider }), apiKey: env[rule.key]! };
}
function selectedModelFromEnv(agentId: string, env: ModelDiscoveryContext['env']): string | undefined {
  if (agentId === 'aider') return env.AIDER_MODEL;
  return agentId === 'qwen' ? env.QWEN_MODEL || env.OPENAI_MODEL : undefined;
}
async function connectionFromEnv({ agentId, context }: { agentId: string; context: ModelDiscoveryContext }): Promise<ProviderModelsInput | null> {
  // Deliberately do not steal tokens from another CLI's store. Hosts can inject keychain/OAuth
  // handles. BYOK env is usable only when it identifies this CLI's effective provider.
  const env = context.env;
  if (agentId === 'claude' && env.ANTHROPIC_API_KEY) return envConnection(ENV_CONNECTIONS[0]!, env);
  const selected = context.model || selectedModelFromEnv(agentId, env);
  if (!selected) return null;
  const rule = ENV_CONNECTIONS.find((candidate) => candidate.matches(selected, agentId, env) && env[candidate.key]);
  return rule ? envConnection(rule, env) : null;
}
export const defaultModelDiscoveryDeps: ModelDiscoveryDeps = {
  process: { run: runProcess },
  fs: {
    read: (path, { signal }) => readFile(path, { encoding: 'utf8', signal }).catch(() => null),
    async projectRoot({ cwd, signal }) {
      let directory = cwd;
      for (let depth = 0; depth < 64 && !signal.aborted; depth++) {
        if (await stat(join(directory, '.git')).then(() => true, () => false)) return directory;
        const parent = dirname(directory); if (parent === directory) break; directory = parent;
      }
      return null;
    },
  },
  http: { list: (input) => { const { protocol, baseUrl, apiKey, ...optional } = input; return listProviderModels({ protocol, baseUrl, apiKey }, optional); } },
  credential: { connection: connectionFromEnv },
  acp: createAcpDiscoveryAdapter({ probe: nativeAcpModelProbe }),
  rpc: { async probe({ agentId, context, signal }) {
    // UNVERIFIED locally: use official prompt-free SDK interfaces, not invented CLI flags.
    if (agentId === 'copilot') return scheduleProbeProcess({ work: () => probeCopilotSdk(context, signal) }, { signal });
    if (agentId === 'droid') return probeDroidSdk(context, defaultModelDiscoveryDeps, signal);
    if (agentId !== 'pi') throw new ModelProbeError('unsupported-version');
    const { stdout } = await defaultModelDiscoveryDeps.process.run({ context, args: ['--mode', 'rpc'], stdin: '{"type":"get_available_models","id":"catalog"}\n{"type":"get_state","id":"state"}\n', signal, timeoutMs: 15_000,
      complete: (output) => {
        try { const metadata = parsePiRpcMetadata(output); return Boolean(metadata.defaultSelectionId); } catch { return false; }
      } });
    return parsePiRpcMetadata(stdout);
  } },
  clock: { now: Date.now }, cache: defaultRuntimeState.modelCatalog,
};
type PiRpcResponse = { type?: string; command?: string; success?: boolean; data?: { models?: unknown[]; model?: { provider?: string; id?: string } } };
/** A successful Pi RPC response, or null for events, failures and non-JSON lines. */
function piRpcResponse(line: string): PiRpcResponse | null {
  let response: PiRpcResponse;
  try { response = JSON.parse(line); } catch { return null; }
  return response.type === 'response' && response.success ? response : null;
}
function piCatalogModels(response: PiRpcResponse): DiscoveredModel[] {
  if (response.command !== 'get_available_models' || !Array.isArray(response.data?.models)) return [];
  return response.data.models.flatMap((raw) => {
    const row = raw as { provider?: string; id?: string; name?: string };
    return row.provider && row.id ? [{ id: `${row.provider}/${row.id}`, label: row.name || row.id, provider: row.provider, identityKind: modelIdentityKind(row.id) }] : [];
  });
}
function piCurrentSelection(response: PiRpcResponse): string | undefined {
  const model = response.command === 'get_state' ? response.data?.model : undefined;
  return model?.provider && model.id ? `${model.provider}/${model.id}` : undefined;
}
/** Pi's native RPC supplies catalog AND current provider/id without making an inference call. */
export function parsePiRpcMetadata(stdout: string): ModelProbeResult {
  const models: DiscoveredModel[] = []; let defaultSelectionId: string | undefined;
  for (const response of stdout.split('\n').map(piRpcResponse)) {
    if (!response) continue;
    models.push(...piCatalogModels(response));
    defaultSelectionId = piCurrentSelection(response) ?? defaultSelectionId;
  }
  if (!models.length) throw new ModelProbeError('malformed-response');
  return { models, source: 'rpc', coverage: 'account', ...withDefaultSelection(defaultSelectionId) };
}

/** Stable dependency identity preserves the existing per-host single-probe budget as well as its cache. */
export function getRuntimeModelDiscoveryDeps({ state }: { state: AgentRuntimeState }, _optional: Record<string, never> = {}): ModelDiscoveryDeps {
  if (state === defaultRuntimeState) return defaultModelDiscoveryDeps;
  return state.discoveryDeps ??= { ...defaultModelDiscoveryDeps, cache: state.modelCatalog,
    acp: createAcpDiscoveryAdapter({ probe: state.acpModelProbe ?? nativeAcpModelProbe }),
  };
}

/** Adapt the existing ACP port to catalog metadata; array-only transports cannot claim a default.
 * Keeps invocation normalization, cancellation and the shared process budget in the native adapter.
 * @param required - The host's existing ACP probe, optionally capable of reporting current selection.
 * @returns A catalog adapter using that probe without changing security or concurrency guarantees.
 * @example const acp = createAcpDiscoveryAdapter({ probe: hostProbe });
 */
export function createAcpDiscoveryAdapter({ probe }: { probe: AcpModelProbe }, _optional: Record<string, never> = {}): ModelDiscoveryDeps['acp'] {
  return { async probe({ context, args, signal }) {
    const invocation = createCommandInvocation({ command: context.executable, args: [...args], env: context.env });
    const required = { bin: invocation.command, args: invocation.args };
    const optional = { cwd: context.cwd, env: context.env, timeoutMs: 15_000, signal };
    const result = await scheduleProbeProcess({ work: async () => {
      if (probe.detectMetadata) return probe.detectMetadata(required, optional);
      return { models: await probe.detectModels(required, optional), currentModelId: null };
    } }, { signal });
    return { models: result.models, source: 'rpc', coverage: 'account', ...(result.currentModelId ? { defaultSelectionId: result.currentModelId } : {}) };
  } };
}
