import { describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { AGENT_DEFS, buildAcpSessionNewParams, runtimeSupportsExternalTools, type RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createApprovalHandler, createToolRegistry, type AccessApprovalDescription } from '@jini-ai/core';
import { createDelegatedToolBridge } from '../../delegated-tool-bridge.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createNodeCredentialCrypto, createRunScopedCredentials } from '../../run-credentials.js';
import { createSurfaceExchangeStore, resolveConfirmationDecision } from '../../surface-exchanges.js';
import { scheduler } from '../../__tests__/surface-fixture.js';
import { createToolExecutor } from '../../tool-executor.js';
import { withSurfaceExchangeLifetime } from '../../tool-recovery/surface-lifetime.js';
import { computeChildEnv } from '../launch.js';
import { prepareCodexHomeIfNeeded } from '../codex/home-staging.js';
import { resolveMcpBridgeForRun, writeMcpJsonIfNeeded } from '../mcp-bridge.js';

// Adapter staging and shared delegated execution, not a claim to launch vendor CLI binaries.
// Each row consumes its real def's staged MCP credential instead of changing a context label.
const supported = AGENT_DEFS.filter(def => runtimeSupportsExternalTools({ def }));
const unsupported = AGENT_DEFS.filter(def => !runtimeSupportsExternalTools({ def }));
const personId = 'access-owner';
const toolId = 'fixture_access_change';
const refuse = async ({ message }: { message: string }): Promise<never> => { throw new Error(message); };

async function stage(def: RuntimeAgentDef, runId: string, credential: string) {
  const written = new Map<string, string>();
  const options = { command: 'fixture-mcp-bridge', args: ['serve'], daemonUrl: 'http://fixture.invalid',
    credential: async () => credential, startupToolIds: () => [toolId],
    readFile: async () => { throw new Error('ENOENT'); },
    writeFile: async ({ path, content }: { path: string; content: string }) => { written.set(path, content); },
    mkdtemp: async () => '/fixture/codex-home', removeDir: async () => {}, linkSessionStore: async () => {},
  };
  const delivery = await resolveMcpBridgeForRun({
    input: { runId, cwd: '/fixture', def, nativeCapabilities: { userMcp: true } },
    deps: { mcpJsonInjection: options, cleanupStagedFiles: async () => {}, failBeforeSpawn: refuse,
      ensureAntigravityMcpPermission: async () => {} },
  });
  if (delivery === null) {
    expect(computeChildEnv({ spawnEnv: {}, mcpBridge: delivery })).toEqual({});
    expect(written.size).toBe(0);
    return undefined;
  }
  if (delivery.kind === 'acp-merge') {
    const params = buildAcpSessionNewParams({ cwd: '/fixture' }, {
      mcpServers: [...delivery.mcpServers], ...(def.acpMcpEnvFormat ? { envFormat: def.acpMcpEnvFormat } : {}),
    });
    expect(params.mcpServers).toHaveLength(1);
    const server = params.mcpServers[0]!;
    expect(server.command).toBe(options.command);
    expect(server.args).toEqual(options.args);
    return Array.isArray(server.env)
      ? Object.fromEntries(server.env.map(({ name, value }) => [name, value]))
      : server.env;
  }
  expect(delivery.serverEntry.command).toBe(options.command);
  expect(delivery.serverEntry.args).toEqual(options.args);
  if (delivery.kind === 'claude-mcp-json') {
    await writeMcpJsonIfNeeded({ input: { runId, cwd: '/fixture', def, mcpBridge: delivery, nativeCapabilities: { userMcp: false } },
      deps: { mcpJsonInjection: options, releaseStagedResources: async () => {}, failBeforeSpawn: refuse } });
    return JSON.parse(written.get(delivery.mcpJsonPath)!).mcpServers.jini.env as Record<string, string>;
  }
  if (delivery.kind === 'codex-toml') {
    const home = await prepareCodexHomeIfNeeded({ input: { runId, def, mcpBridge: delivery },
      deps: { hostEnv: {}, mcpJsonInjection: options, releaseStagedResources: async () => {}, failBeforeSpawn: refuse } });
    expect(computeChildEnv({ spawnEnv: {}, mcpBridge: delivery }, { codexHomeDir: home!.path }).CODEX_HOME).toBe(home!.path);
    const config = parse(written.get('/fixture/codex-home/config.toml')!) as { mcp_servers: { jini: { env: Record<string, string> } } };
    await home!.cleanup();
    return config.mcp_servers.jini.env;
  }
  const env = computeChildEnv({ spawnEnv: {}, mcpBridge: delivery });
  if (delivery.kind === 'env-content') {
    expect(delivery.envVarName).toBe(def.externalMcpInjection === 'opencode-env-content' ? 'OPENCODE_CONFIG_CONTENT' : 'MIMOCODE_CONFIG_CONTENT');
    return JSON.parse(env[delivery.envVarName]!).mcp.jini.environment as Record<string, string>;
  }
  return env;
}

async function invocation(def: RuntimeAgentDef) {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'access-matrix' });
  const credentials = createRunScopedCredentials({ crypto: createNodeCredentialCrypto({}),
    principalOfLiveRun: ({ runId }) => runId === run.id ? personId : undefined });
  const token = credentials.mint({ runId: run.id });
  const env = (await stage(def, run.id, token))!;
  expect(env.JINI_RUN_ID).toBe(run.id);
  expect(env.JINI_DAEMON_URL).toBe('http://fixture.invalid');
  expect(env.JINI_STARTUP_TOOL_IDS).toBe(JSON.stringify([toolId]));
  expect(env.JINI_DAEMON_TOKEN).toBe(token);
  const caller = credentials.resolveCaller({ token: env.JINI_DAEMON_TOKEN! })!;
  expect(caller).toEqual({ runId: run.id, principalId: personId });
  const store = createSurfaceExchangeStore({ scheduler, clock: { nowMs: () => Date.now() },
    idGenerator: { newId: () => 'access-exchange' }, defaultChannel: 'mcp-ui' });
  let effects = 0;
  let cards = 0;
  let card!: () => void;
  const opened = new Promise<void>(resolve => { card = resolve; });
  await lifecycle.stream({ runId: caller.runId, onEvent: event => {
    if (event.kind === 'agent' && (event.payload as { type: string }).type === 'mcp-ui') { cards++; card(); }
  } });
  const access: AccessApprovalDescription = { resources: [{ id: 'tools', label: 'Mail tools',
    scope: { personId, siteId: 'site', chatId: run.id }, previous: { allow: [] }, proposed: { allow: ['read'] }, revision: 'before' }] };
  const handler = createApprovalHandler({
    prepare: async () => undefined,
    describe: () => ({ kind: 'access' as const, ask: true as const, description: access, access }),
    askHuman: async ({ ctx, description }, { emitSurface } = {}) => {
      if (!emitSurface) throw new Error('No human transport');
      const exchange = store.open({ binding: { principalId: ctx.principal.id, toolId }, emit: emitSurface });
      return resolveConfirmationDecision({ exchange, emission: { channel: 'mcp-ui', payload: { resource: {
        uri: 'ui://access/approval', mimeType: 'application/json', text: JSON.stringify(description),
      } } } });
    },
    run: async ({ confirmer }) => { expect(confirmer).toEqual({ id: personId, kind: 'user' }); effects++; return { applied: true }; },
    notConfirmed: ({ reason }) => ({ applied: false, reason }),
  });
  const registry = createToolRegistry({});
  registry.register({ descriptor: { id: toolId }, policy: { authorize: () => 'allow' }, handler });
  // The composed daemon stack adds this lease so every card ends with its executing call.
  const executor = withSurfaceExchangeLifetime({ inner: createToolExecutor({ registry }) });
  const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: executor });
  const controller = new AbortController();
  const pending = bridge.execute({ runId: caller.runId, toolUseId: 'access-call', toolId,
    principal: { id: caller.principalId }, input: { confirmed: true, decision: 'confirm' } }, { signal: controller.signal });
  await opened;
  expect(effects).toBe(0);
  expect(cards).toBe(1);
  expect(store.size()).toBe(1);
  const exchangeId = store.findTypedAnswerTarget({ principalId: caller.principalId, toolId })!;
  const deliver = (principalId: string, answerTool: string, decision: string) => store.deliver(
    { exchangeId, principalId, params: { decision } }, { toolId: answerTool });
  return { pending, controller, deliver, store, effects: () => effects, cards: () => cards };
}

describe('registered CLI access approval staging and delegated execution (no live CLI binaries)', () => {
  it('covers every registered external MCP strategy', () => {
    expect([...new Set(supported.map(def => def.externalMcpInjection))].sort()).toEqual([
      'acp-merge', 'claude-mcp-json', 'codex-toml', 'env-passthrough', 'mimo-env-content', 'opencode-env-content',
    ]);
    expect(supported.length + unsupported.length).toBe(AGENT_DEFS.length);
  });

  it.each(unsupported)('$id stages no tool bridge when its CLI lacks external MCP injection', async def => {
    expect(await stage(def, 'unsupported', 'unused-fixture')).toBeUndefined();
  });

  it.each(supported)('$id requires one bound human exchange before applying access once', async def => {
    const h = await invocation(def);
    expect(h.deliver('other-person', toolId, 'confirm')).toEqual({ ok: false, reason: 'binding-mismatch' });
    expect(h.deliver(personId, 'other-tool', 'confirm')).toEqual({ ok: false, reason: 'binding-mismatch' });
    expect(h.effects()).toBe(0);
    expect(h.store.size()).toBe(1);
    expect(h.deliver(personId, toolId, 'confirm')).toEqual({ ok: true });
    expect((await h.pending).output).toEqual({ applied: true });
    expect(h.effects()).toBe(1);
    expect(h.cards()).toBe(1);
    expect(h.store.size()).toBe(0);
    expect(h.deliver(personId, toolId, 'confirm')).toEqual({ ok: false, reason: 'unknown-or-closed' });
    expect(h.effects()).toBe(1);
  });

  it.each(supported)('$id leaves access unchanged when its person declines', async def => {
    const h = await invocation(def);
    expect(h.deliver(personId, toolId, 'cancel')).toEqual({ ok: true });
    expect((await h.pending).output).toEqual({ applied: false, reason: 'declined' });
    expect(h.effects()).toBe(0);
    expect(h.cards()).toBe(1);
    expect(h.store.size()).toBe(0);
  });

  it.each(supported)('$id closes its access exchange on transport abort without applying', async def => {
    const h = await invocation(def);
    h.controller.abort();
    await h.pending;
    expect(h.effects()).toBe(0);
    expect(h.cards()).toBe(1);
    expect(h.store.size()).toBe(0);
    expect(h.deliver(personId, toolId, 'confirm')).toEqual({ ok: false, reason: 'unknown-or-closed' });
  });
});
