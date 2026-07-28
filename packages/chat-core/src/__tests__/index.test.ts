import { describe, expect, it } from 'vitest';
import {
  buildTranscript,
  dedupeToolUsesById,
  deriveToolStatus,
  isTerminalRunStatus,
  parsePartialJson,
  repairJsonPrefix,
  splitOnQuestionForms,
  stripArtifact,
  type AgentEvent,
  type ChatMessage,
  type RunStatus,
} from '../index.js';

describe('@injini/chat-core barrel', () => {
  it('re-exports the full public surface from a single entry point', () => {
    expect(typeof stripArtifact).toBe('function');
    expect(typeof dedupeToolUsesById).toBe('function');
    expect(typeof deriveToolStatus).toBe('function');
    expect(typeof splitOnQuestionForms).toBe('function');
    expect(typeof buildTranscript).toBe('function');
  });

  it('assembles a realistic run end-to-end: events accumulate onto a message, then feed a transcript', () => {
    const events: AgentEvent[] = [
      { kind: 'status', label: 'started' },
      { kind: 'tool_use', id: 'tu_1', name: 'Read', input: { path: 'README.md' } },
      { kind: 'tool_result', toolUseId: 'tu_1', content: 'contents', isError: false },
      { kind: 'text', text: 'Here is a summary.' },
      { kind: 'usage', inputTokens: 120, outputTokens: 40 },
      { kind: 'ext', name: 'host.customThing', data: { anything: true } },
    ];
    const message: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'Here is a summary.',
      agentId: 'agent-x',
      events,
      runStatus: 'succeeded',
    };
    const status: RunStatus = message.runStatus ?? 'queued';
    expect(isTerminalRunStatus(status)).toBe(true);
    expect(dedupeToolUsesById(events)).toHaveLength(events.length); // no duplicates present

    const history: ChatMessage[] = [{ id: 'u1', role: 'user', content: 'summarize the readme' }, message];
    expect(buildTranscript(history)).toBe('## user\nsummarize the readme\n\n## assistant\nHere is a summary.');
  });

  it('RUN_STATUSES/isTerminalRunStatus agree on which states are terminal', () => {
    expect(isTerminalRunStatus('queued')).toBe(false);
    expect(isTerminalRunStatus('running')).toBe(false);
    expect(isTerminalRunStatus('succeeded')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('canceled')).toBe(true);
    expect(isTerminalRunStatus(undefined)).toBe(false);
  });
});

describe('partial-json: repairJsonPrefix / parsePartialJson', () => {
  it('drops a dangling incomplete key (no colon yet) and closes the object empty, rather than throwing', () => {
    expect(parsePartialJson('{"hel')).toEqual({});
    expect(repairJsonPrefix('{"hello"')).toBe('{}');
  });

  it('closes a string value cut off mid-token and repairs a dangling escape at the cut point', () => {
    expect(parsePartialJson('{"a":"b\\')).toEqual({ a: 'b' });
  });

  it('trims a dangling comma / trailing key-with-no-value and closes open containers', () => {
    expect(parsePartialJson('{"a":1,')).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":1,"b":')).toEqual({ a: 1 });
  });

  it('drops a partial boolean/null/number token cut mid-literal instead of emitting invalid JSON', () => {
    expect(parsePartialJson('{"a":tru')).toEqual({});
    expect(parsePartialJson('{"a":1.5,"b":fal')).toEqual({ a: 1.5 });
    expect(parsePartialJson('[1,2,3.')).toEqual([1, 2]);
  });

  it('closes nested open arrays/objects innermost-first', () => {
    expect(parsePartialJson('{"a":[1,2,{"b":3')).toEqual({ a: [1, 2, { b: 3 }] });
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(parsePartialJson('')).toBeNull();
    expect(parsePartialJson('   ')).toBeNull();
  });

  it('parses already-complete JSON unchanged', () => {
    expect(parsePartialJson('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });
});
