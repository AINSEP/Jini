import { execFile, type ExecFileOptions, type SpawnOptions } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createCommandInvocation } from '@jini-ai/platform';
import { detectAcpModelMetadata } from './agent-protocol/acp/models.js';
import { CLAUDE_CODE_INITIALIZE_ARGS, CLAUDE_CODE_INITIALIZE_REQUEST } from './claude-code-models.js';
import { listProviderModels } from './providers/model-catalog.js';
import { execAgentFile } from './invocation.js';
import { probeCopilotSdk, probeDroidSdk } from './model-discovery-sdk.js';
import { parseSettingsJson, readModelConfiguration } from './model-discovery-config.js';
import { ModelProbeError, modelIdentityKind, withModelProbeTimeout, type AgentDiscoveryConfiguration } from './model-discovery.js';
import type { DiscoveredModel, ModelDiscoveryContext, ModelDiscoveryDeps, ModelProbeResult } from './model-discovery-types.js';

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
  // Reserve two seconds of the outer budget for CLI-owned cache recovery. The inner
  // abort signal stops only the listing; the parent remains usable for reading fallback files.
  const { stdout } = await withModelProbeTimeout(active => deps.process.run({ context, args: config.args || [], signal: active, timeoutMs: 8_000 }), 8_000, signal);
  const models = config.parse?.({ stdout });
  if (!models) throw new ModelProbeError('malformed-response');
  const defaultSelectionId = stdout.match(/^\s*Default model:\s*(\S+)\s*$/mi)?.[1];
  return { models, source: 'cli', coverage: 'account', ...(defaultSelectionId ? { defaultSelectionId } : {}) };
}
/** ACP can create CLI session state/start services. It never sends a user prompt. */
export async function probeAcpMetadata(context: ModelDiscoveryContext, args: readonly string[], deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  return deps.acp.probe({ context, args, signal });
}
/** Keep selection IDs, resolved concrete IDs and display names, including capability variants. */
export function parseClaudeInitializeMetadata(stdout: string): ModelProbeResult | null {
  for (const line of stdout.split('\n')) {
    let obj: Record<string, unknown> | null;
    try { obj = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (obj?.type !== 'control_response') continue;
    const response = obj.response as { subtype?: string; response?: { models?: unknown } } | undefined;
    const rows = response?.subtype === 'success' ? response.response?.models : undefined;
    if (!Array.isArray(rows)) continue;
    const models: DiscoveredModel[] = [];
    let defaultSelectionId: string | undefined;
    for (const row of rows) {
      if (!row || typeof row.value !== 'string') continue;
      const id = row.value.trim();
      const resolvedId = typeof row.resolvedModel === 'string' ? row.resolvedModel.trim() : undefined;
      const label = typeof row.displayName === 'string' && row.displayName.trim() ? row.displayName.trim() : resolvedId || id;
      if (id === 'default') {
        if (resolvedId && modelIdentityKind(resolvedId) === 'concrete') { defaultSelectionId = resolvedId; models.push({ id: resolvedId, label, identityKind: 'concrete' }); }
        continue;
      }
      models.push({ id, label, identityKind: id === resolvedId ? 'concrete' : resolvedId ? 'alias' : modelIdentityKind(id), ...(resolvedId ? { resolvedId } : {}) });
      if (resolvedId && id !== resolvedId) models.push({ id: resolvedId, label, identityKind: modelIdentityKind(resolvedId) });
    }
    return { models, source: 'rpc', coverage: 'account', ...(defaultSelectionId ? { defaultSelectionId } : {}) };
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
export async function probeProviderApi(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const config = await readModelConfiguration(agentId, context, deps, signal);
  const effectiveContext = config.selection ? { ...context, model: config.selection } : context;
  const input = await deps.credential.connection({ agentId, context: effectiveContext, signal });
  if (!input) throw new ModelProbeError('auth-missing');
  if (input.protocol === 'bedrock' || input.protocol === 'azure') throw new ModelProbeError('unsupported-version');
  const result = await deps.http.list({ ...input, signal });
  if (!result.ok || !result.models) throw new ModelProbeError(result.kind === 'auth_failed' ? 'auth-missing' : result.kind === 'timeout' ? 'timeout' : 'offline');
  const prefix = agentId === 'aider' && config.selection?.includes('/') ? config.selection.slice(0, config.selection.indexOf('/') + 1) : '';
  return { models: result.models.map((row) => ({ ...row, id: prefix && !row.id.startsWith(prefix) ? `${prefix}${row.id}` : row.id })), source: 'provider-api', coverage: 'provider' };
}
/** Caches are partial observed catalogs, always stale, never silently promoted to live. */
export async function probeCliCache(agentId: string, context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const home = context.env.HOME || homedir();
  const path = agentId === 'codex' ? join(context.env.CODEX_HOME || join(home, '.codex'), 'models_cache.json')
    : agentId === 'opencode' ? join(context.env.XDG_CACHE_HOME || join(home, '.cache'), 'opencode/models.json')
    : agentId === 'claude' ? join(context.env.CLAUDE_CONFIG_DIR || home, '.claude.json')
    : agentId === 'codebuddy' ? join(home, '.codebuddy/settings.json') : '';
  if (!path) throw new ModelProbeError('unsupported-version');
  const raw = await deps.fs.read(path, { signal });
  const data = raw ? parseSettingsJson(raw) : null;
  if (!data) throw new ModelProbeError('offline');
  if (agentId === 'codex' && raw) return { models: configurationCacheModels(data.models), source: 'cli-cache', coverage: 'observed' };
  if (agentId === 'opencode') {
    const models: DiscoveredModel[] = [];
    for (const [provider, value] of Object.entries(data)) {
      const entries = value && typeof value === 'object' ? (value as { models?: Record<string, { name?: string }> }).models : undefined;
      for (const [id, row] of Object.entries(entries || {})) models.push({ id: `${provider}/${id}`, label: row.name || `${provider}/${id}`, provider, identityKind: modelIdentityKind(id) });
    }
    return { models, source: 'cli-cache', coverage: 'observed' };
  }
  // UNVERIFIED CodeBuddy cache schema. Configured model is weaker than an account catalog.
  const entries = data.additionalModelOptionsCache;
  return { models: configurationCacheModels(entries), source: 'cli-cache', coverage: 'observed' };
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
export async function probeAgentCatalog(agentId: string, context: ModelDiscoveryContext, configuration: AgentDiscoveryConfiguration, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const acpArgs = ACP_ARGS[agentId];
  // UNVERIFIED installed ACP agents: existing declared commands; metadata preserves native defaults.
  if (acpArgs && agentId !== 'amr') return probeAcpMetadata(context, acpArgs, deps, signal);
  if (agentId === 'claude') {
    try {
      return await probeClaudeInitialize(context, deps, signal);
    } catch {
      try { return await probeProviderApi(agentId, context, deps, signal); }
      catch { return probeCliCache(agentId, context, deps, signal); }
    }
  }
  if (agentId === 'pi' || agentId === 'copilot' || agentId === 'droid') return deps.rpc.probe({ agentId, context, signal });
  // UNVERIFIED CLI-owned effective credential adapters; OAuth/unknown endpoints require host ports.
  if (agentId === 'aider' || agentId === 'qwen' || agentId === 'mimo') return probeProviderApi(agentId, context, deps, signal);
  if (agentId === 'codebuddy') {
    // UNVERIFIED: survey identifies initialize compatibility as a candidate, not a guarantee.
    // Try the same prompt-free metadata category; failed compatibility stays explicitly offline.
    try { return await probeClaudeInitialize(context, deps, signal); }
    catch { return probeCliCache(agentId, context, deps, signal); }
  }
  if (configuration.args) {
    try { return await probeCliSubcommand(context, configuration, deps, signal); }
    catch (error) {
      if (agentId === 'codex' || agentId === 'opencode') {
        try { return await probeCliCache(agentId, context, deps, signal); } catch { throw error; }
      }
      throw error;
    }
  }
  if (agentId === 'amr') {
    // Every ACP def uses this category. Vela's documented list command remains a fallback
    // when its ACP version omits the model catalog; launch still confirms explicit selection.
    try {
      const metadata = await probeAcpMetadata(context, ACP_ARGS.amr!, deps, signal);
      const first = metadata.models.find((row) => row.id !== 'default' && modelIdentityKind(row.id) === 'concrete');
      if (!first) throw new ModelProbeError('malformed-response');
      return { ...metadata, defaultSelectionId: context.env.VELA_DEFAULT_MODEL || metadata.defaultSelectionId || first.id };
    } catch (error) { if (signal.aborted) throw error; }
    const result = await deps.process.run({ context, args: ['model', 'list', '--format', 'json'], signal, timeoutMs: 10_000 });
    const models = configuration.parse?.({ stdout: result.stdout }) || [];
    // Vela requires an explicit concrete set_model before prompting; retain the first native row.
    const first = models.find((row) => row.id !== 'default');
    return { models, source: 'cli', coverage: 'account', ...(first ? { defaultSelectionId: context.env.VELA_DEFAULT_MODEL || first.id } : {}) };
  }
  const args = CLI_ARGS[agentId];
  if (!args) throw new ModelProbeError('unsupported-version');
  return probeCliSubcommand(context, { ...configuration, args, parse: ({ stdout }) => parseGenericCliModels(stdout) }, deps, signal);
}

function runProcess(input: Parameters<ModelDiscoveryDeps['process']['run']>[0]): ReturnType<ModelDiscoveryDeps['process']['run']> {
  if (input.stdin === undefined) return execAgentFile({ command: input.context.executable, args: [...input.args] }, { options: {
    cwd: input.context.cwd, env: input.context.env as NodeJS.ProcessEnv, signal: input.signal,
    timeout: input.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
  } }).then(({ stdout, stderr }) => ({ stdout: String(stdout), stderr: String(stderr) }));
  return new Promise((resolve, reject) => {
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
      error && !completed ? reject(error) : resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    if (tree) {
      input.signal.addEventListener('abort', killTree, { once: true });
      treeTimer = setTimeout(killTree, input.timeoutMs);
      if (input.signal.aborted) killTree();
    }
    if (input.complete) child.stdout?.on('data', (chunk) => {
      captured += String(chunk);
      if (input.complete?.(captured)) { completed = true; child.kill('SIGKILL'); }
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input.stdin);
  });
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
  credential: { async connection({ agentId, context }) {
    // Deliberately do not steal tokens from another CLI's store. Hosts can inject keychain/OAuth
    // handles. BYOK env is usable only when it identifies this CLI's effective provider.
    const env = context.env;
    if (agentId === 'claude' && env.ANTHROPIC_API_KEY) return { protocol: 'anthropic', baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', apiKey: env.ANTHROPIC_API_KEY };
    const selected = context.model || (agentId === 'aider' ? env.AIDER_MODEL : agentId === 'qwen' ? env.QWEN_MODEL || env.OPENAI_MODEL : undefined);
    if (!selected) return null;
    if (/^(anthropic\/|claude-)/.test(selected) && env.ANTHROPIC_API_KEY) return { protocol: 'anthropic', baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', apiKey: env.ANTHROPIC_API_KEY };
    if (/^(gemini\/|google\/|gemini-)/.test(selected) && env.GEMINI_API_KEY) return { protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: env.GEMINI_API_KEY };
    if (/^openrouter\//.test(selected) && env.OPENROUTER_API_KEY) return { protocol: 'openai', baseUrl: env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY };
    if ((/^(openai\/|gpt-|o\d)/.test(selected) || agentId === 'qwen' && (env.OPENAI_MODEL || env.OPENAI_BASE_URL)) && env.OPENAI_API_KEY) return { protocol: 'openai', baseUrl: env.OPENAI_BASE_URL || env.OPENAI_API_BASE || 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY };
    return null;
  } },
  acp: { async probe({ context, args, signal }) {
    const invocation = createCommandInvocation({ command: context.executable, args: [...args], env: context.env });
    const result = await detectAcpModelMetadata({ bin: invocation.command, args: invocation.args }, { cwd: context.cwd, env: context.env as NodeJS.ProcessEnv, timeoutMs: 15_000, signal });
    return { models: result.models, source: 'rpc', coverage: 'account', ...(result.currentModelId ? { defaultSelectionId: result.currentModelId } : {}) };
  } },
  rpc: { async probe({ agentId, context, signal }) {
    // UNVERIFIED locally: use official prompt-free SDK interfaces, not invented CLI flags.
    if (agentId === 'copilot') return probeCopilotSdk(context, signal);
    if (agentId === 'droid') return probeDroidSdk(context, defaultModelDiscoveryDeps, signal);
    if (agentId !== 'pi') throw new ModelProbeError('unsupported-version');
    const { stdout } = await defaultModelDiscoveryDeps.process.run({ context, args: ['--mode', 'rpc'], stdin: '{"type":"get_available_models","id":"catalog"}\n{"type":"get_state","id":"state"}\n', signal, timeoutMs: 15_000,
      complete: (output) => {
        try { const metadata = parsePiRpcMetadata(output); return Boolean(metadata.defaultSelectionId); } catch { return false; }
      } });
    return parsePiRpcMetadata(stdout);
  } },
  clock: { now: Date.now }, cache: new Map(),
};
/** Pi's native RPC supplies catalog AND current provider/id without making an inference call. */
export function parsePiRpcMetadata(stdout: string): ModelProbeResult {
  const models: DiscoveredModel[] = []; let defaultSelectionId: string | undefined;
  for (const line of stdout.split('\n')) {
    let response: { type?: string; command?: string; success?: boolean; data?: { models?: unknown[]; model?: { provider?: string; id?: string } } };
    try { response = JSON.parse(line); } catch { continue; }
    if (response.type !== 'response' || !response.success) continue;
    if (response.command === 'get_available_models' && Array.isArray(response.data?.models)) {
      for (const raw of response.data.models) {
        const row = raw as { provider?: string; id?: string; name?: string };
        if (row.provider && row.id) models.push({ id: `${row.provider}/${row.id}`, label: row.name || row.id, provider: row.provider, identityKind: modelIdentityKind(row.id) });
      }
    }
    if (response.command === 'get_state' && response.data?.model?.provider && response.data.model.id) defaultSelectionId = `${response.data.model.provider}/${response.data.model.id}`;
  }
  if (!models.length) throw new ModelProbeError('malformed-response');
  return { models, source: 'rpc', coverage: 'account', ...(defaultSelectionId ? { defaultSelectionId } : {}) };
}
