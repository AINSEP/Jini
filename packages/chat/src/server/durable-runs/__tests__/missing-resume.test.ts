import { expect, it } from 'vitest';
import { createDurableRecovery } from '../recover.js';
import type { DurableRun, DurableRunStore, RecoveryPorts } from '../../../core/durable-runs/ports.js';

/** mri: the already-confirmed locator can name a rollout lost during a hard cancel. */
it('reconstructs a missing Codex rollout once with prior turns and no visible failure/recovery note', async () => {
  const now = 1_790_000_000_000;
  let run: DurableRun = {
    conversationId: 'chat', messageId: 'answer', runId: 'old', principalId: 'admin', workspaceId: 'ws', engine: 'daemon',
    request: { agentId: 'codex', contextRef: JSON.stringify({ prompt: 'Now change the footer', conversationId: 'chat' }) },
    message: { id: 'answer', role: 'assistant', runStatus: 'running', runId: 'old', content: '', events: [
      { kind: 'raw', line: 'thread/resume failed: no rollout found for thread id thread-1' },
      { kind: 'status', label: 'Run failed — the agent process exited without answering' },
    ] },
    transcript: [{ id: 'u1', role: 'user', content: 'Remember the site is Luvira.' }, { id: 'a1', role: 'assistant', content: 'The site is Luvira.' }],
    attemptBase: [], sessionId: 'thread-1', sessionConfirmed: true, child: { pid: 10, startedAt: 'start' },
    cancelReason: null, attemptStartedAt: now, lastProgressAt: now, recoveryDeadline: null, recoveryCount: 0,
  };
  const launches: Parameters<RecoveryPorts['launch']>[0][] = [];
  const store = {
    load: async () => run,
    advance: async (input: Parameters<DurableRunStore['advance']>[0]) => {
      run = { ...run, runId: input.nextRunId, attemptBase: input.events, message: { ...run.message, runId: input.nextRunId, events: [...input.events] } };
      return true;
    },
    recoveryClock: async () => {},
  } as unknown as DurableRunStore;
  const recovery = createDurableRecovery({
    store, now: () => now + 1000, mintRunId: () => 'fresh', probe: async () => 'dead', attach: () => {},
    cancelAttempt: async () => {}, verifyChildDead: async () => true, supportsNativeResume: () => true,
    launch: async input => { launches.push(input); }, settle: async () => { throw new Error('must continue'); },
  }, {});
  expect(await recovery.recover({ messageId: 'answer', trigger: 'attempt-failed' }, {})).toBe('continued');
  expect(launches).toHaveLength(1);
  const request = JSON.parse(launches[0]!.request.contextRef);
  expect(request.recoveryMode).toBe('reconstruction');
  expect(request.recoverySessionId).toBeUndefined();
  expect(request.prompt).toContain('user: Remember the site is Luvira.\n\nassistant: The site is Luvira.');
  expect(request.prompt).toContain('Accepted task:\nNow change the footer');
  expect(run.message.events).toEqual([{ kind: 'status', code: 'run_recovering', label: '' }]);
});
