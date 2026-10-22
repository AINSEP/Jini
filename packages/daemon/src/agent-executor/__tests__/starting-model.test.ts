import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import type { RuntimeAgentDef, attachAcpSession, attachPiRpcSession } from '@jini-ai/agent-runtime';
import { createAgentExecutor as publicCreateAgentExecutor } from '../../index.js';
import { createAgentExecutor, AgentExecutorError } from '../index.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { fixtureModelDiscovery } from './model-discovery-fixture.js';

function def(): RuntimeAgentDef {
  return { ...fixtureModelDiscovery, id: 'fixture', name: 'Fixture', bin: 'fixture', versionArgs: [], fallbackModels: [], streamFormat: 'plain', promptViaStdin: true,
    async resolveDefaultModel() { return { status: 'resolved', id: 'cli-pinned', source: 'rpc', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'fixture' }; },
    buildArgs: (_required, { options = {} } = {}) => ['--model', options.model!],
  };
}
const launch = { selectedPath: '/fake', pathResolvedPath: '/fake', configuredOverridePath: null, launchPath: '/fake', launchKind: 'selected' as const, childPathPrepend: [], diagnostic: null };

it.each(['acp-json-rpc', 'pi-rpc'])('fails an empty %s result despite the transport reporting success', async streamFormat => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const agent = def(); agent.streamFormat = streamFormat;
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  const spawn = (() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; }) as typeof nodeSpawn;
  const acp: typeof attachAcpSession = () => ({ hasFatalError: () => false, getDurableSessionId: () => null, completedSuccessfully: () => true, abort() {} });
  const pi: typeof attachPiRpcSession = () => ({ hasFatalError: () => false, getLastSessionPath: () => null, abort() {} });
  const executor = createAgentExecutor({ lifecycle }, { getAgentDef: () => agent, resolveAgentLaunch: () => launch,
    ensureAgentCapabilities: async () => {}, applyAgentLaunchEnv: ({ env }) => env, spawn, attachAcpSession: acp, attachPiRpcSession: pi });
  const { run } = await lifecycle.start({ contextRef: 'empty-rpc' });
  await executor.run({ runId: run.id, agentId: agent.id, cwd: '/workspace', prompt: 'hello' });
  child.emit('close', 0, null);
  expect((await lifecycle.waitForTerminal({ runId: run.id })).state).toBe('failed');
  const messages: string[] = [];
  await lifecycle.stream({ runId: run.id, onEvent: event => { if (event.kind === 'error') messages.push(event.payload.message); } });
  expect(messages.join('\n')).toContain('no assistant text or tool activity');
});

describe('starting-model launch agreement', () => {
  it('uses the definition selected synchronously at run call time after a registry replacement', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    let registered = def();
    let lookups = 0;
    const args: string[][] = [];
    const executor = createAgentExecutor({ lifecycle }, {
      getAgentDef: () => { lookups++; return registered; },
      resolveAgentLaunch: () => launch,
      ensureAgentCapabilities: async () => {},
      applyAgentLaunchEnv: ({ env }) => env,
      createCommandInvocation: ({ command, args }) => ({ command, args: [...(args ?? [])], windowsVerbatimArguments: false }),
      spawn: ((_command: string, argv: readonly string[]) => { args.push([...argv]); throw new Error('Fixture stops before a real process'); }) as unknown as typeof nodeSpawn,
    });
    const { run } = await lifecycle.start({ contextRef: 'registry-replacement' });
    const pending = executor.run({ runId: run.id, agentId: registered.id, cwd: '/workspace', prompt: 'hello' });
    // Replace the registry entry in the caller's same turn, before any launch continuation resumes.
    registered = { ...def(), buildArgs: () => ['--replacement'] };
    expect(lookups).toBe(1);
    await expect(pending).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(args).toEqual([['--model', 'cli-pinned']]);
    expect(lookups).toBe(1);
  });

  it('passes the resolved default into the native model-selection flag', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const agent = def(); const args: string[][] = [];
    const executor = createAgentExecutor({ lifecycle }, {
      getAgentDef: () => agent, resolveAgentLaunch: () => launch, ensureAgentCapabilities: async () => {}, applyAgentLaunchEnv: ({ env }) => env,
      createCommandInvocation: ({ command, args }) => ({ command, args: [...(args ?? [])], windowsVerbatimArguments: false }),
      spawn: ((_command: string, argv: readonly string[]) => { args.push([...argv]); throw new Error('Fixture stops before a real process'); }) as unknown as typeof nodeSpawn,
    });
    const { run } = await lifecycle.start({ contextRef: 'fixture' });
    await expect(executor.run({ runId: run.id, agentId: 'fixture', cwd: '/workspace', prompt: 'hello' })).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(args).toEqual([['--model', 'cli-pinned']]);
  });
  it('does not spawn or send a prompt when the concrete default is unresolved', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const agent = def(); let spawned = false;
    agent.resolveDefaultModel = async () => ({ status: 'unresolved', selectionId: 'adaptive', reason: 'No concrete evidence' });
    const executor = createAgentExecutor({ lifecycle }, { getAgentDef: () => agent, resolveAgentLaunch: () => launch, ensureAgentCapabilities: async () => {}, applyAgentLaunchEnv: ({ env }) => env,
      spawn: (() => { spawned = true; throw new Error('Must not spawn'); }) as unknown as typeof nodeSpawn });
    const { run } = await lifecycle.start({ contextRef: 'fixture' });
    await expect(executor.run({ runId: run.id, agentId: 'fixture', cwd: '/workspace', prompt: 'hello' })).rejects.toEqual(new AgentExecutorError({ code: 'AGENT_MODEL_UNRESOLVED', message: 'AgentExecutor: pick a concrete model; the starting model could not be resolved for this launch.' }));
    expect(spawned).toBe(false);
  });
});

// Exercise both entry paths so the public compatibility facade stays wired to the split
// implementation and model-receipt assertions continue to cover consumer behavior.
for (const [name, create] of [['split', createAgentExecutor], ['public', publicCreateAgentExecutor]] as const) {
  describe(`${name} executor launch-scoped model receipts`, () => {
    for (const format of ['claude-stream-json', 'acp-json-rpc', 'pi-rpc']) {
      it(`uses catalog aliases for ${format} receipts and retains real switches`, async () => {
        const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
        const agent = def(); agent.streamFormat = format;
        agent.discoverModels = async ({ context }) => ({
          ...(await fixtureModelDiscovery.discoverModels({ context })),
          models: [
            { id: 'vendor-model', label: 'Vendor Model', identityKind: 'alias', resolvedId: 'cli-pinned' },
            { id: 'vendor-next', label: 'Vendor Next', identityKind: 'alias', resolvedId: 'cli-next' },
          ],
        });
        const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
        const spawn = (() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; }) as typeof nodeSpawn;
        let report: (model: string) => void = () => { throw new Error('Transport was not attached'); };
        const acp: typeof attachAcpSession = ({ send }) => {
          report = model => send({ event: 'agent', payload: { type: 'status', label: 'model', model } });
          return { hasFatalError: () => false, getDurableSessionId: () => null, completedSuccessfully: () => true, abort() {} };
        };
        const pi: typeof attachPiRpcSession = ({ send }) => {
          report = model => send({ event: 'agent', payload: { type: 'status', label: 'model', model } });
          return { hasFatalError: () => false, getLastSessionPath: () => null, abort() {} };
        };
        const executor = create({ lifecycle }, { getAgentDef: () => agent, resolveAgentLaunch: () => launch, ensureAgentCapabilities: async () => {},
          applyAgentLaunchEnv: ({ env }) => env, spawn, attachAcpSession: acp, attachPiRpcSession: pi });
        const { run } = await lifecycle.start({ contextRef: 'aliases' });
        await executor.run({ runId: run.id, agentId: agent.id, cwd: '/workspace', prompt: 'hello' });
        if (format === 'claude-stream-json') report = model => child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'init', model, tools: [] })}\n`);
        for (const model of ['vendor-model', 'cli-pinned', 'vendor-next', 'cli-next']) report(model);
        child.emit('close', 0, null);
        await lifecycle.waitForTerminal({ runId: run.id });
        const receipts: unknown[] = [];
        await lifecycle.stream({ runId: run.id, onEvent: event => {
          if (event.kind === 'agent' && event.payload.type === 'status' && ['starting_model', 'model_switch', 'observed_model'].includes(event.payload.label)) receipts.push(event.payload);
        } });
        expect(receipts).toEqual([
          { type: 'status', label: 'starting_model', model: 'cli-pinned' },
          { type: 'status', label: 'model_switch', model: 'cli-next', previousModel: 'cli-pinned', detail: 'Previous model: cli-pinned' },
        ]);
      });
    }
  });
}

it.each(['default', 'native-routing-alias'])('trusted parity leaves default or explicit model selection to the native CLI (%s)', async model => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const agent = def(); let selections = 0; const args: string[][] = [];
  agent.buildArgs = (_input, { options = {} } = {}) => options.model && options.model !== 'default' ? ['--model', options.model] : [];
  const executor = createAgentExecutor({ lifecycle }, {
    getAgentDef: () => agent, resolveAgentLaunch: () => launch,
    resolveModelForLaunch: async () => { selections++; throw new Error('No concrete model evidence'); },
    ensureAgentCapabilities: async () => {}, applyAgentLaunchEnv: ({ env }) => env,
    createCommandInvocation: ({ command, args }) => ({ command, args: [...(args ?? [])], windowsVerbatimArguments: false }),
    spawn: ((_command: string, argv: readonly string[]) => { args.push([...argv]); throw new Error('fixture stops before spawn'); }) as unknown as typeof nodeSpawn,
  });
  const { run } = await lifecycle.start({ contextRef: 'parity' });
  await expect(executor.run({ runId: run.id, agentId: agent.id, cwd: '/workspace', prompt: 'hello' },
    { cliParity: true, nativeToolAccess: true, permissionMode: 'bypass', model })).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
  expect(selections).toBe(0); expect(args).toEqual([model === 'default' ? [] : ['--model', model]]);
});

it.each([false, true])('W5 forwards launch-scoped discovery context and declared env (parity %s)', async cliParity => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const agent = def();
  agent.env = { ENABLE_TOOL_SEARCH: 'false', DECLARED: 'default' };
  const contexts: unknown[] = [];
  const spawnEnvs: unknown[] = [];
  const executor = createAgentExecutor({ lifecycle }, {
    hostEnv: {}, getAgentDef: () => agent, resolveAgentLaunch: () => launch,
    resolveModelForLaunch: async ({ context }) => {
      contexts.push(context);
      return { model: 'selected', catalog: await fixtureModelDiscovery.discoverModels({ context }),
        resolution: { status: 'resolved', id: 'selected', source: 'rpc', resolvedAt: '2026-10-06T00:00:00.000Z', launchFingerprint: 'fixture' } };
    },
    ensureAgentCapabilities: async () => {}, applyAgentLaunchEnv: ({ env }) => env,
    spawn: ((_command: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      spawnEnvs.push(options.env); throw new Error('Stop before process creation');
    }) as unknown as typeof nodeSpawn,
  });
  const { run } = await lifecycle.start({ contextRef: 'w5-model-context' });
  await expect(executor.run({ runId: run.id, agentId: agent.id, prompt: 'hello', cwd: '/workspace' }, {
    cliParity, permissionMode: 'bypass', model: 'default', resumeSessionId: 'prior', newSessionId: 'new',
    settingSources: [], settings: '{}', env: { DECLARED: 'override' },
  })).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
  expect(contexts).toEqual(cliParity ? [] : [{ executable: '/fake', cwd: '/workspace', env: { ENABLE_TOOL_SEARCH: 'false', DECLARED: 'override' }, resumeSessionId: 'prior', settingSources: [], settings: '{}' }]);
  expect(spawnEnvs).toEqual([cliParity ? { DECLARED: 'override' } : { ENABLE_TOOL_SEARCH: 'false', DECLARED: 'override' }]);
  expect((await lifecycle.waitForTerminal({ runId: run.id })).state).toBe('failed');
});
