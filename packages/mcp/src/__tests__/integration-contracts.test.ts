import { defaultFederationMessages } from "../federation/messages.js";
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { DaemonHttpError, getDaemonJson, postDaemonJson } from '../index.js';
import { createAskChoiceTool, type AskChoicePolicy } from '../tools/ask-choice/index.js';
import { messages, presentation, createSurfaceExchangeStore } from '../tools/ask-choice/__tests__/fixtures.js';
import { createAskChoiceAnswerTicketStore } from '../tools/ask-choice/index.js';
import { buildFederatedMcpRegistrations } from '../federation/index.js';
import { InMemoryMcpSession, ScriptedMcpStdioChannel } from '../federation/testing/index.js';
import type { ToolExecutionOptions } from '@jini-ai/core';

test.each([
  ['./bin', 'bin/serve', 'node'],
  ['./federation', 'federation/index', 'node'],
  ['./federation/approvals', 'federation/approvals/index', 'node'],
  ['./federation/stdio', 'federation/stdio/index', 'node'],
  ['./federation/testing', 'federation/testing/index', 'universal'],
  ['./tools/ask-choice', 'tools/ask-choice/index', 'universal'],
])('publishes %s with declarations and runtime metadata', (subpath, source, runtime) => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports[subpath]).toEqual({
    types: `./dist/${source}.d.ts`, import: `./dist/${source}.js`, default: `./dist/${source}.js`,
  });
  expect(manifest.jini.entries[subpath]).toBe(runtime);
  expect(existsSync(new URL(`../${source}.ts`, import.meta.url))).toBe(true);
});

test('daemon requests use object inputs and forward headers and JSON bodies', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}'));
  expect(await getDaemonJson({ baseUrl: 'https://daemon.example', route: '/status' }, { fetchImpl })).toEqual({ ok: true });
  fetchImpl.mockResolvedValueOnce(new Response('{"id":"run-1"}'));
  expect(await postDaemonJson({ baseUrl: 'https://daemon.example', route: '/runs', body: { title: 'Run' } },
    { fetchImpl, headers: { authorization: 'Bearer secret' } })).toEqual({ id: 'run-1' });
  expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{"title":"Run"}',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' } });
});

test('HTTP errors retain status after the argument conversion', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 }));
  await expect(getDaemonJson({ baseUrl: 'https://daemon.example', route: '/missing' }, { fetchImpl }))
    .rejects.toMatchObject({ name: 'DaemonHttpError', status: 404 });
  expect(new DaemonHttpError({ message: 'missing', status: 404 })).toBeInstanceOf(Error);
});

test('ask-choice authorizes the wrapped context before rendering', async () => {
  const authorize = vi.fn<AskChoicePolicy['authorize']>();
  const render = vi.fn(presentation.render);
  const ctx = { principalId: 'human', signal: new AbortController().signal,
    input: { title: 'Pick', singleSelect: { label: 'Plan', options: [{ value: 'now', label: 'Now' }] } } };
  const tool = createAskChoiceTool({ toolId: 'question', description: 'Ask', permission: 'ask', messages,
    policy: { authorize, inputError: ({ message }) => new Error(message), shapeError: ({ message }) => new Error(message) },
    presentation: { ...presentation, render }, surfaceExchanges: createSurfaceExchangeStore(),
    pendingQuestions: createAskChoiceAnswerTicketStore({ now: () => 0, newTicketId: () => 'ticket', ttlMs: 100 }),
  });
  await tool.handler({ ctx });
  expect(authorize).toHaveBeenCalledWith({ ctx, toolId: 'question' });
  expect(render.mock.calls[0]?.[0]).toMatchObject({ principalId: 'human', toolName: 'question' });
  expect(render.mock.invocationCallOrder[0]).toBeGreaterThan(authorize.mock.invocationCallOrder[0]!);
});

test('federation preserves core optional surface ports and checks gates before the remote call', async () => {
  const order: string[] = [];
  const emitSurface: NonNullable<ToolExecutionOptions['emitSurface']> = async () => undefined;
  const config = { connectionId: 'example', label: 'Example', allowedToolNames: ['update'],
    writeAllowedToolNames: ['update'], connectTimeoutMs: 100, callTimeoutMs: 100, maxResultBytes: 1000, maxTools: 1 };
  const tools = [{ name: 'update', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: true } }];
  const session = new InMemoryMcpSession({ tools }, { onCall: ({ name }) => {
    order.push(`remote:${name}`); return { content: [] };
  } });
  const { registrations } = buildFederatedMcpRegistrations({ tools, session, config, nativeToolIds: new Set(), deps: {
    errorCode: "EXTERNAL_MCP", messages: defaultFederationMessages, scope: 'workspace',
    assertConnectionUsable: ({ connectionId }) => { order.push(`live:${connectionId}`); },
    permissionGate: () => { order.push('permission'); },
    confirmCall: async ({ context, request }) => {
      order.push(`confirm:${request.remoteName}`);
      expect(context.emitSurface).toBe(emitSurface);
      expect(Object.isFrozen(request.arguments)).toBe(true);
      return { confirmed: true };
    },
  } });
  await registrations[0]!.handler({ executionId: 'execution', principal: { id: 'human' }, run: { id: 'run' },
    input: {}, signal: new AbortController().signal }, { emitSurface });
  expect(order).toEqual(['live:example', 'permission', 'confirm:update', 'remote:update']);
});

test('scripted channels use named listener arguments and do not send after close', async () => {
  const channel = new ScriptedMcpStdioChannel({ messages: defaultFederationMessages, respond: ({ message }) => ({ result: message.id }) });
  const messages: string[] = [];
  const reasons: string[] = [];
  channel.onMessage({ listener: ({ message }) => { messages.push(message); } });
  channel.onClose({ listener: ({ reason }) => { reasons.push(reason); } });
  channel.send({ message: '{"id":7}' });
  await Promise.resolve();
  expect(messages).toEqual(['{"result":7}']);
  channel.close({});
  expect(reasons).toEqual(['closed by the host']);
  expect(() => channel.send({ message: '{}'})).toThrow('closed');
});
