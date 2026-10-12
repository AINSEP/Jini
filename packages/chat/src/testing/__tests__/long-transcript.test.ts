import { expect, it } from 'vitest';
import { createLongTranscriptFixture } from '../index.js';

it('creates deterministic paired messages with linked finished tool rows and the render probe', () => {
  const input = { turns: 2, toolRowsPerTurn: 1 };
  const messages = createLongTranscriptFixture(input, {});
  expect(messages.map(({ id, role, createdAt }) => ({ id, role, createdAt }))).toEqual([
    { id: 'u0', role: 'user', createdAt: 0 }, { id: 'a0', role: 'assistant', createdAt: 1 },
    { id: 'u1', role: 'user', createdAt: 2 }, { id: 'a1', role: 'assistant', createdAt: 3 },
  ]);
  expect(messages[3]).toEqual({ id: 'a1', role: 'assistant', createdAt: 3,
    content: 'Done with step 1.', runStatus: 'succeeded', events: [
      { kind: 'tool_use', id: 't1-0', name: 'Bash', input: { command: 'ls 0' } },
      { kind: 'tool_result', toolUseId: 't1-0', content: 'file\n'.repeat(50), isError: false },
      { kind: 'text', text: 'Done with step 1.' }, { kind: 'ext', name: 'render-probe', data: { turn: 1 } },
    ] });
  expect(createLongTranscriptFixture(input)).toEqual(messages);
  expect(createLongTranscriptFixture({ turns: 0, toolRowsPerTurn: 15 })).toEqual([]);
  expect(createLongTranscriptFixture({ turns: 250, toolRowsPerTurn: 15 })).toHaveLength(500);
});
