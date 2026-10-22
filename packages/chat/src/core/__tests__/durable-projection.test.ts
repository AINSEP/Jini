import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import type { ChatMessage } from '../messages.js';
import { mergeRunEvents, preserveAssistantContent, terminalMessageNotice, continuingRunNotice, recoveredRunEvents } from '../durable-projection.js';

const partial = 'Need a repo-creation tool. Check the github plugin skill and capabilities.\n\nCreating the repo via the saved `github` credential.\n\nRepo created (private, `main`). Now the backup plan.';
describe('durable projection', () => {
  it('preserves equal usage segments while replaying each occurrence only once', () => {
    const usage = { kind: 'usage' as const, inputTokens: 10, outputTokens: 5, costUsd: 0.01, durationMs: 1000 };
    expect(mergeRunEvents({ incoming: [usage, usage] }, {})).toEqual([usage, usage]);
    expect(mergeRunEvents({ saved: [usage], incoming: [usage, usage] }, {})).toEqual([usage, usage]);
    expect(mergeRunEvents({ saved: [usage, usage], incoming: [usage, usage] }, {})).toEqual([usage, usage]);
  });
  it('silently reconstructs a missing native resume without losing saved work or unrelated diagnostics', () => {
    const saved = [
      { kind: 'text' as const, text: 'Prior answer.' },
      { kind: 'status' as const, label: 'An unrelated earlier failure' },
      { kind: 'raw' as const, line: 'thread/resume failed: no rollout found for thread id t1' },
      { kind: 'status' as const, label: 'Run failed — the agent process exited without answering', detail: 'status=failed, code=1' },
    ];
    const events = recoveredRunEvents({ saved }, { notice: 'silent' });
    expect(events).toEqual([saved[0], saved[1], { kind: 'status', code: 'run_recovering', label: '' }]);
    expect(continuingRunNotice({ events, active: true }, {})).toBeNull();
  });
  it('recognizes missing-rollout details and removes only the current attempt failure', () => {
    const prior = { kind: 'status' as const, label: 'Run failed — the agent process exited without answering' };
    const marker = { kind: 'status' as const, code: 'run_recovering', label: 'Continuing…' };
    expect(recoveredRunEvents({ saved: [prior, marker, prior,
      { kind: 'status', label: 'Codex resume failed', detail: 'no rollout found for thread id t1' },
    ] }, { notice: 'silent' })).toEqual([prior, marker, { kind: 'status', code: 'run_recovering', label: '' }]);
  });
  it('keeps the incident 182 characters after empty or shortened completion', () => {
    expect(partial.length).toBe(182);
    const saved = [{ kind: 'text' as const, text: partial }];
    expect(mergeRunEvents({ saved, incoming: [] }, {})).toEqual(saved);
    expect(mergeRunEvents({ saved, incoming: [{ kind: 'text', text: 'Need a repo' }] }, {})).toEqual(saved);
    expect(preserveAssistantContent({ saved: partial, incoming: '' }, {})).toBe(partial);
  });
  it('merges tool identity and longer coalesced text without repeating saved text', () => {
    const tool = { kind: 'tool_use' as const, id: 'repo', name: 'create_repo', input: {} };
    expect(mergeRunEvents({ saved: [{ kind: 'text', text: 'Repo created.' }, tool], incoming: [tool, { kind: 'text', text: 'Repo created. Backup complete.' }] }, {})).toEqual([
      { kind: 'text', text: 'Repo created.' }, tool, { kind: 'text', text: ' Backup complete.' },
    ]);
  });
  it('shows recovery until new visible work, and hides it on terminal completion', () => {
    const events = [{ kind: 'status' as const, code: 'run_recovering', label: 'Continuing…' }];
    expect(continuingRunNotice({ events, active: true }, {})).toBe('Continuing…');
    expect(continuingRunNotice({ events, active: false }, {})).toBeNull();
    expect(continuingRunNotice({ events: [...events, { kind: 'text', text: 'Backup complete.' }], active: true }, {})).toBeNull();
  });
  it('keeps one neutral terminal notice for a legacy canceled row without resuming it', () => {
    expect(terminalMessageNotice({ message: { id: 'm', role: 'assistant', content: partial, runStatus: 'canceled', events: [{ kind: 'status', label: 'Stopped.', detail: 'Saved work is above. Send your message again to retry.' }] } }, {})).toBe('Stopped. Saved work is above.');
  });
});

describe('mergeRunEvents', () => {
  it('appends every incoming event when nothing is saved', () => {
    const incoming: AgentEvent[] = [{ kind: 'text', text: 'Hi' }, { kind: 'tool_use', id: 't', name: 'x', input: {} }];
    expect(mergeRunEvents({ incoming })).toEqual(incoming);
  });

  it('matches wire events by eventId even when their payloads differ', () => {
    const saved: (AgentEvent & { eventId: string })[] = [{ kind: 'status', label: 'Working', eventId: 'e1' }];
    const replay: AgentEvent & { eventId: string } = { kind: 'status', label: 'Working (updated)', eventId: 'e1' };
    expect(mergeRunEvents({ saved, incoming: [replay] })).toEqual(saved);
  });

  it('matches wire events by cursor when there is no eventId', () => {
    const saved: (AgentEvent & { cursor: number })[] = [{ kind: 'raw', line: 'a', cursor: 4 }];
    const replay: AgentEvent & { cursor: number } = { kind: 'raw', line: 'b', cursor: 4 };
    expect(mergeRunEvents({ saved, incoming: [replay] })).toEqual(saved);
  });

  it('matches a tool_result by its toolUseId', () => {
    const saved: AgentEvent[] = [{ kind: 'tool_result', toolUseId: 't', content: 'partial', isError: false }];
    expect(mergeRunEvents({ saved, incoming: [{ kind: 'tool_result', toolUseId: 't', content: 'full', isError: false }] })).toEqual(saved);
  });

  it('matches other events by their full JSON snapshot', () => {
    const status: AgentEvent = { kind: 'status', label: 'Working' };
    const other: AgentEvent = { kind: 'status', label: 'Done' };
    expect(mergeRunEvents({ saved: [status], incoming: [{ ...status }, other] })).toEqual([status, other]);
  });

  it('keeps the saved text and drops incoming text that does not extend it', () => {
    const saved: AgentEvent[] = [{ kind: 'text', text: 'Saved answer.' }];
    expect(mergeRunEvents({ saved, incoming: [{ kind: 'text', text: 'Different answer, longer than the saved one.' }] })).toEqual(saved);
  });

  it('appends only the unsaved tail when the saved prefix spans several incoming deltas', () => {
    const saved: AgentEvent[] = [{ kind: 'text', text: 'Hello wor' }];
    expect(mergeRunEvents({ saved, incoming: [{ kind: 'text', text: 'Hel' }, { kind: 'text', text: 'lo ' }, { kind: 'text', text: 'world' }] })).toEqual([
      ...saved, { kind: 'text', text: 'ld' },
    ]);
  });
});

describe('continuingRunNotice', () => {
  const marker: AgentEvent = { kind: 'status', code: 'run_recovering', label: 'Continuing…' };

  it('returns null for an active run with no events', () => {
    expect(continuingRunNotice({ events: undefined, active: true })).toBeNull();
  });

  it('returns null when the run has no recovery marker', () => {
    expect(continuingRunNotice({ events: [{ kind: 'status', label: 'Working' }], active: true })).toBeNull();
  });

  it('returns null for a silent (empty-label) marker', () => {
    expect(continuingRunNotice({ events: [{ kind: 'status', code: 'run_recovering', label: '' }], active: true })).toBeNull();
  });

  it('returns null once a tool call follows the marker', () => {
    expect(continuingRunNotice({ events: [marker, { kind: 'tool_use', id: 't', name: 'x', input: {} }], active: true })).toBeNull();
  });

  it('returns null once a tool result follows the marker', () => {
    expect(continuingRunNotice({ events: [marker, { kind: 'tool_result', toolUseId: 't', content: '', isError: false }], active: true })).toBeNull();
  });

  it('keeps the notice while only non-visible events follow the marker', () => {
    expect(continuingRunNotice({ events: [marker, { kind: 'status', label: 'Working' }], active: true })).toBe('Continuing…');
  });

  it('reads the latest marker, ignoring progress made before it', () => {
    expect(continuingRunNotice({ events: [{ kind: 'text', text: 'a' }, marker], active: true })).toBe('Continuing…');
  });
});

describe('preserveAssistantContent', () => {
  it('takes the incoming content when it is at least as long as the saved content', () => {
    expect(preserveAssistantContent({ saved: 'Repo', incoming: 'Repo created' })).toBe('Repo created');
  });

  it('takes the incoming content when both are equally long', () => {
    expect(preserveAssistantContent({ saved: 'abc', incoming: 'xyz' })).toBe('xyz');
  });
});

describe('terminalMessageNotice', () => {
  const base: ChatMessage = { id: 'm', role: 'assistant', content: '' };

  it('returns null for a message that is not failed or canceled', () => {
    expect(terminalMessageNotice({ message: { ...base, runStatus: 'succeeded', events: [{ kind: 'status', label: 'Run failed' }] } })).toBeNull();
  });

  it('falls back to a generic failure notice when no status explains it', () => {
    expect(terminalMessageNotice({ message: { ...base, runStatus: 'failed' } })).toBe('This turn failed.');
  });

  it('falls back to a generic stop notice for a canceled message with no explaining status', () => {
    expect(terminalMessageNotice({ message: { ...base, runStatus: 'canceled', events: [{ kind: 'status', label: 'Working' }] } })).toBe('Stopped.');
  });

  it('uses a run_terminal status whatever its label says', () => {
    expect(terminalMessageNotice({ message: { ...base, runStatus: 'failed', events: [{ kind: 'status', code: 'run_terminal', label: 'Quota reached' }] } })).toBe('Quota reached');
  });

  it('uses the latest matching status and joins its detail', () => {
    expect(terminalMessageNotice({ message: { ...base, runStatus: 'failed', events: [
      { kind: 'status', label: 'Agent could not start' },
      { kind: 'status', label: 'Agent not logged in', detail: 'Run login first.' },
    ] } })).toBe('Agent not logged in Run login first.');
  });
});

describe('recoveredRunEvents', () => {
  it('adds no Continued divider when the saved attempt has no visible answer', () => {
    const saved: AgentEvent[] = [{ kind: 'text', text: '  \n' }, { kind: 'status', label: 'Starting' }];
    expect(recoveredRunEvents({ saved })).toEqual([...saved, { kind: 'status', code: 'run_recovering', label: 'Continuing…' }]);
  });

  it('adds a Continued divider after a saved visible answer', () => {
    const saved: AgentEvent[] = [{ kind: 'text', text: 'Answer.' }];
    expect(recoveredRunEvents({ saved }, { notice: 'visible' })).toEqual([
      ...saved, { kind: 'text', text: '\n\n---\n\nContinued\n\n' }, { kind: 'status', code: 'run_recovering', label: 'Continuing…' },
    ]);
  });

  it('keeps every saved event when the silent attempt has no missing-rollout diagnostic', () => {
    const saved: AgentEvent[] = [
      { kind: 'text', text: 'Prior answer.' },
      { kind: 'status', label: 'Run failed — the agent process exited without answering' },
      { kind: 'raw', line: 'other noise' },
    ];
    expect(recoveredRunEvents({ saved }, { notice: 'silent' })).toEqual([...saved, { kind: 'status', code: 'run_recovering', label: '' }]);
  });

  it('ignores a missing-rollout diagnostic from an earlier attempt', () => {
    const saved: AgentEvent[] = [
      { kind: 'raw', line: 'no rollout found for thread id t0' },
      { kind: 'status', code: 'run_recovering', label: '' },
      { kind: 'status', label: 'Run failed — the agent process exited without answering' },
    ];
    expect(recoveredRunEvents({ saved }, { notice: 'silent' })).toEqual([...saved, { kind: 'status', code: 'run_recovering', label: '' }]);
  });

  it('recognizes a missing-rollout status label and keeps unrelated current-attempt events', () => {
    const saved: AgentEvent[] = [
      { kind: 'status', label: 'no rollout found for thread id t1' },
      { kind: 'raw', line: 'unrelated' },
      { kind: 'tool_use', id: 't', name: 'x', input: {} },
    ];
    expect(recoveredRunEvents({ saved }, { notice: 'silent' })).toEqual([saved[1], saved[2], { kind: 'status', code: 'run_recovering', label: '' }]);
  });
});
