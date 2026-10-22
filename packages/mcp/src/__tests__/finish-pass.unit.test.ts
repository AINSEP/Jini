import { defaultFederationMessages } from "../federation/messages.js";
import { afterEach, expect, test, vi } from 'vitest';
import { createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool, createMcpIdleExitController, sanitizeMcpConfig, sanitizeMcpServer } from '../index.js';
import { registerFederatedMcpPreset, resetFederatedMcpPresetsForTests, listFederatedMcpPresets } from '../federation/index.js';
import { IDENTITY_STDIO_LAUNCH_RESOLVER, McpLaunchUnavailableError, stdioLaunchResolverFromEnv } from '../federation/stdio/index.js';
import { createInMemoryConversationToolApprovalStore, InMemoryExternalMcpToolApprovalRepo, InMemoryMcpSession, ScriptedMcpStdioChannel } from '../federation/testing/index.js';
import { QuestionShapeError, parseQuestion } from '../tools/ask-choice/question.js';

afterEach(() => {
  vi.useRealTimers();
  resetFederatedMcpPresetsForTests({});
});

test.each([null, false, 123, 'unknown'])('rejects a supplied invalid transport: %s', transport => {
  expect(sanitizeMcpServer({ raw: { id: 'server', command: 'node', transport } })).toBeNull();
});

test.each([null, false, 123, 'unknown'])('rejects a supplied invalid authentication mode: %s', authMode => {
  for (const url of ['http://localhost:3000', 'https://server.example']) {
    expect(sanitizeMcpServer({ raw: { id: 'server', transport: 'http', url, authMode } })).toBeNull();
  }
});

test('an invalid server cannot discard a valid sibling or replace its credentials', () => {
  const valid = { id: 'valid', transport: 'http', url: 'https://server.example', authMode: 'oauth' };
  expect(sanitizeMcpConfig({ raw: { servers: [
    { id: 'invalid', transport: 'http', url: 'http://localhost:3000', authMode: 'typo' }, valid,
  ] } }).servers).toEqual([{ ...valid, url: 'https://server.example/', enabled: true }]);
});

const resolverInput = {
  messages: defaultFederationMessages, toolchainDirEnvVar: 'EXAMPLE_TOOLCHAIN', npmRootEnvVar: 'EXAMPLE_NPM',
};
const launch = { command: 'npx', args: ['-y', 'package'], env: { TOKEN: 'secret' } };

test('absence of both toolchain variables selects the ordinary identity resolver', () => {
  expect(stdioLaunchResolverFromEnv({ ...resolverInput, env: {} })).toBe(IDENTITY_STDIO_LAUNCH_RESOLVER);
});

test.each([{ EXAMPLE_TOOLCHAIN: '/toolchain' }, { EXAMPLE_NPM: '/npm' }, { EXAMPLE_TOOLCHAIN: '', EXAMPLE_NPM: '' }])('rejects a partially configured toolchain', env => {
  const exists = vi.fn(() => true);
  expect(() => stdioLaunchResolverFromEnv({ ...resolverInput, env }, { exists })).toThrow(McpLaunchUnavailableError);
  expect(exists).not.toHaveBeenCalled();
});

test('a missing configured toolchain refuses fallback until the host explicitly permits it', () => {
  const env = { EXAMPLE_TOOLCHAIN: '/toolchain', EXAMPLE_NPM: '/npm' };
  const exists = () => false;
  expect(() => stdioLaunchResolverFromEnv({ ...resolverInput, env }, { exists })).toThrow('npx-cli.js is missing');
  const resolver = stdioLaunchResolverFromEnv({ ...resolverInput, env }, { exists, allowIdentityFallback: true });
  expect(resolver.resolve({ spec: launch })).toMatchObject({ ...launch, launchEnv: {}, warning: expect.stringContaining('falling back') });
});

test('partial toolchain fallback is an explicit host decision and carries a warning', () => {
  const resolver = stdioLaunchResolverFromEnv({ ...resolverInput, env: { EXAMPLE_TOOLCHAIN: '/toolchain' } }, { allowIdentityFallback: true });
  expect(resolver.resolve({ spec: launch })).toMatchObject({ ...launch, launchEnv: {}, warning: expect.stringContaining('must both be set') });
});

test.each([false, 'true', 1])('a truthy substitute cannot grant identity fallback: %s', allowIdentityFallback => {
  expect(() => stdioLaunchResolverFromEnv({ ...resolverInput, env: { EXAMPLE_TOOLCHAIN: '/toolchain' } }, {
    allowIdentityFallback: allowIdentityFallback as boolean,
  })).toThrow(McpLaunchUnavailableError);
});

test('question errors take objects while retaining their original message and error classification', () => {
  expect(new QuestionShapeError({ message: 'invalid' }, { cause: 'cause' })).toMatchObject({ message: 'invalid', cause: 'cause' });
  expect(() => parseQuestion({ input: {}, toolId: 'question' })).toThrow(QuestionShapeError);
  expect(() => parseQuestion({ input: {}, toolId: 'question' })).toThrow("question: 'title' is required.");
});

test.each([createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool])('delegated gateways request correlation ids through an object port', async createTool => {
  const generateToolUseId = vi.fn(() => 'correlation');
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: { executionId: 'execution', status: 'completed', output: 'ok' } }), {
    headers: { 'content-type': 'application/json' },
  }));
  const tool = createTool({ runId: 'run' }, { generateToolUseId });
  expect(await tool.handler({ args: { toolId: 'example.tool' }, ctx: { baseUrl: 'http://localhost:3000', fetchImpl } }))
    .toEqual({ executionId: 'execution', status: 'completed', output: 'ok' });
  expect(generateToolUseId).toHaveBeenCalledWith({});
  const request = fetchImpl.mock.calls[0] as unknown as [unknown, RequestInit];
  expect(JSON.parse(request[1].body as string)).toMatchObject({ toolUseId: 'correlation', runId: 'run' });
});

test('effectful lifecycle ports take empty objects and preserve teardown and expiry', async () => {
  vi.useFakeTimers();
  const onIdle = vi.fn();
  const idle = createMcpIdleExitController({ idleMs: 100, onIdle });
  vi.advanceTimersByTime(50);
  idle.noteActivity({});
  vi.advanceTimersByTime(99);
  expect(onIdle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onIdle).toHaveBeenCalledTimes(1);
  expect(onIdle).toHaveBeenCalledWith({});
  const request = vi.fn(() => 'value');
  expect(await idle.trackRequest({ fn: request })).toBe('value');
  expect(request).toHaveBeenCalledWith({});
  idle.dispose({});
  const session = new InMemoryMcpSession({ tools: [] });
  await session.close({});
  expect(session.closed).toBe(true);
  const channel = new ScriptedMcpStdioChannel({ messages: defaultFederationMessages, respond: () => undefined });
  channel.close({});
  expect(channel.closedReason).toBe('closed by the host');
  registerFederatedMcpPreset({ preset: { presetId: 'example', resolve: () => null } });
  resetFederatedMcpPresetsForTests({});
  expect(listFederatedMcpPresets()).toEqual([]);
});

test('empty object store constructors retain single-use-independent memory isolation', async () => {
  const first = new InMemoryExternalMcpToolApprovalRepo({});
  const second = new InMemoryExternalMcpToolApprovalRepo({});
  const row = { serverId: 'server', toolName: 'tool', fingerprint: 'hash', grantedByPrincipalId: 'principal', grantedAt: '2026-10-02' };
  await first.upsert(row, { scope: 'workspace' });
  expect(await second.find(row, { scope: 'workspace' })).toBeNull();
  const chat = createInMemoryConversationToolApprovalStore({});
  const key = { conversationId: 'conversation', principalId: 'principal', connectionId: 'server', toolName: 'tool', fingerprint: 'hash' };
  await chat.grant({ key, grantedAt: '2026-10-02' });
  expect(await chat.has(key)).toBe(true);
  expect(await createInMemoryConversationToolApprovalStore({}).has(key)).toBe(false);
});
