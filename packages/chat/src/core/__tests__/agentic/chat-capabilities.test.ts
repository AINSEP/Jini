import { describe, expect, it } from 'vitest';

import { CHAT_CAPABILITIES } from '../../agentic/chat-capabilities.js';

// Stryker L5 (2026-10-25): 27 of 40 mutants survived — no test compared the manifest to an
// expected literal. Inline, exact (descriptions only checked as strings): the schema is the
// contract a model sees, risk/surface/requiresConfirmation drive approval and routing.
describe('CHAT_CAPABILITIES contract (F3)', () => {
  const text = expect.any(String);
  const str = { type: 'string', description: text };
  const empty = { type: 'object', properties: {}, additionalProperties: false };

  it('matches the expected manifest exactly', () => {
    expect(CHAT_CAPABILITIES).toEqual([
      { id: 'chat.send_message', description: text, risk: 'write', surface: 'server',
        inputSchema: { type: 'object', properties: { prompt: str }, required: ['prompt'], additionalProperties: false } },
      { id: 'chat.set_draft', description: text, risk: 'write', surface: 'session',
        inputSchema: { type: 'object', properties: { text: str }, required: ['text'], additionalProperties: false } },
      { id: 'chat.select_agent', description: text, risk: 'write', surface: 'session',
        inputSchema: { type: 'object', properties: { agentId: str, model: str, reasoning: str }, required: ['agentId'], additionalProperties: false } },
      { id: 'chat.cancel_run', description: text, risk: 'write', surface: 'session', inputSchema: empty },
      { id: 'chat.reset_conversation', description: expect.stringContaining('DESTRUCTIVE'), risk: 'write', surface: 'session', requiresConfirmation: true,
        inputSchema: { type: 'object', properties: { confirm: { type: 'boolean', description: text } }, required: ['confirm'], additionalProperties: false } },
      { id: 'chat.set_working_directory', description: expect.stringContaining('recentDirectories'), risk: 'write', surface: 'session',
        inputSchema: { type: 'object', properties: { path: str }, required: ['path'], additionalProperties: false } },
      { id: 'chat.get_state', description: text, risk: 'read', surface: 'session', inputSchema: empty },
    ]);
  });

  it('only reset_conversation requires confirmation, and only get_state is read-only', () => {
    expect(CHAT_CAPABILITIES.filter((c) => c.requiresConfirmation).map((c) => c.id)).toEqual(['chat.reset_conversation']);
    expect(CHAT_CAPABILITIES.filter((c) => c.risk === 'read').map((c) => c.id)).toEqual(['chat.get_state']);
  });
});
