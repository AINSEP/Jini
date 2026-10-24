import { expect, it } from 'vitest';
import type { RunAgentPayload } from '@jini-ai/protocol';
import { createMessageRelay } from '../message-relay.js';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { resolveMcpBridgeForRun } from '../mcp-bridge.js';

it('spawn_gate_uses_fresh_nonces_only_for_mcp_relay_engines', async () => {
  const options = { command: 'node', daemonUrl: 'http://daemon', env: { JINI_MESSAGE_RELAY: '1', JINI_MESSAGE_RELAY_NONCE: 'forged' } };
  const resolve = async (agentId: string, runId: string) => resolveMcpBridgeForRun({
    input: { runId, cwd: '/work', def: getAgentDef({ id: agentId })! },
    deps: { mcpJsonInjection: options, cleanupStagedFiles: async () => {}, failBeforeSpawn: async ({ message }) => { throw new Error(message); } },
  });
  const native = await resolve('claude', 'native');
  expect(native?.kind).toBe('claude-mcp-json');
  if (native?.kind !== 'claude-mcp-json') throw new Error('native bridge missing');
  expect(native.serverEntry.env).not.toHaveProperty('JINI_MESSAGE_RELAY');
  const first = await resolve('codex', 'first');
  const second = await resolve('codex', 'second');
  if (first?.kind !== 'codex-toml' || second?.kind !== 'codex-toml') throw new Error('codex bridge missing');
  expect(first.serverEntry.env.JINI_MESSAGE_RELAY).toBe('1');
  expect(first.serverEntry.env.JINI_MESSAGE_RELAY_NONCE).toMatch(/^[a-f0-9]{48}$/u);
  expect(second.serverEntry.env.JINI_MESSAGE_RELAY_NONCE).not.toBe(first.serverEntry.env.JINI_MESSAGE_RELAY_NONCE);
  expect(await resolve('aider', 'no-bridge')).toBeNull();
});

it('stops_prefix_at_attachment_message', () => {
  const receipts: RunAgentPayload[] = [];
  const relay = createMessageRelay({ emit: payload => { receipts.push(payload); } });
  relay.enqueue({ id: 'first', text: 'first', hasAttachments: false });
  relay.enqueue({ id: 'image', text: 'see image', hasAttachments: true });
  relay.enqueue({ id: 'last', text: 'after image', hasAttachments: false });
  expect(relay.claim({ via: 'tool-result' })).toEqual([{ id: 'first', seq: 1, text: 'first' }]);
  expect(relay.claim({ via: 'check_messages' })).toEqual([]);
  expect(receipts.filter(payload => payload.type === 'user_message' && payload.deliveryState === 'consumed'))
    .toEqual([{ type: 'user_message', id: 'first', text: 'first', deliveryState: 'consumed', via: 'tool-result' }]);
});

it('delivers_whole_oversized_messages_alone_and_keeps_sequence', () => {
  const relay = createMessageRelay({ emit: () => {} }, { maxChars: 100 });
  const text = 'a'.repeat(1000);
  relay.enqueue({ id: 'big', text, hasAttachments: false });
  relay.enqueue({ id: 'small', text: 'last', hasAttachments: false });
  expect(relay.claim({ via: 'check_messages' })).toEqual([{ id: 'big', seq: 1, text }]);
  expect(relay.claim({ via: 'tool-result' })).toEqual([{ id: 'small', seq: 2, text: 'last' }]);
  relay.close();
  expect(relay.enqueue({ id: 'late', text: 'late', hasAttachments: false })).toBe('not-running');
  expect(relay.claim({ via: 'check_messages' })).toEqual([]);
});
