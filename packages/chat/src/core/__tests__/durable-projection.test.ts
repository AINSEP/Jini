import { describe, expect, it } from 'vitest';
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
