import { expect, it } from 'vitest';
import type { RuntimeAgentDef } from '../../../../../agent-runtime/src/index.js';
import { createAgentExecutor } from '../../../../../daemon/src/agent-executor/launch.js';
import { fixtureLaunchModel, fixtureModelDiscovery } from '../../../../../daemon/src/agent-executor/__tests__/model-discovery-fixture.js';
import { createInMemoryEventLog } from '../../../../../daemon/src/event-log.js';
import { createRunLifecycle } from '../../../../../daemon/src/run-lifecycle.js';
import { createAssistantRunFinalizer } from '../../../server/run-finalizer/entry.js';
import { notices } from '../../../core/run-events/__tests__/fixture.js';
import { createChatHistoryStore } from '../chat-history-store.js';
import { createChatRunLedger } from '../run-ledger.js';
import { runtimeFixture } from './runtime-fixture.js';

it.each(['startup refusal', 'nonzero CLI exit'] as const)('persists a real %s and its UI diagnostic through the run finalizer', async failure => {
  const fixture = runtimeFixture();
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'user asks the assistant to answer' });
  const isDaemonRunId = () => true;
  const ledger = createChatRunLedger({ kernel: fixture.kernel, isDaemonRunId });
  const history = createChatHistoryStore({ kernel: fixture.kernel, isDaemonRunId,
    scope: { scopeId: 'workspace', ownerKind: 'user', ownerId: 'alice' } });
  try {
    await history.create({ id: 'chat' });
    const accepted = await ledger.durable!.accept({ conversationId: 'chat', messageId: 'answer', runId: run.id,
      principalId: 'alice', workspaceId: 'workspace', now: 1,
      request: { agentId: 'missing-cli', contextRef: JSON.stringify({ userMessage: {
        id: 'question', role: 'user', content: 'Answer me', createdAt: 1,
      } }) } }, {});
    expect(accepted).not.toBeNull();
    const def: RuntimeAgentDef = { ...fixtureModelDiscovery, id: 'fixture-cli', name: 'Fixture CLI', bin: process.execPath,
      versionArgs: ['--version'], fallbackModels: [], streamFormat: 'plain', promptViaStdin: true, promptInputFormat: 'text',
      buildArgs: () => ['-e', 'process.stdin.resume(); process.stdin.on("end", () => { process.stderr.write("fixture CLI failed\\n"); process.exit(7); });'],
    };
    const executor = createAgentExecutor({ lifecycle }, {
      getAgentDef: () => failure === 'startup refusal' ? null : def,
      ensureAgentCapabilities: async () => {}, resolveModelForLaunch: fixtureLaunchModel,
      resolveAgentLaunch: () => ({ selectedPath: process.execPath, pathResolvedPath: process.execPath,
        configuredOverridePath: null, launchPath: process.execPath, launchKind: 'selected', childPathPrepend: [], diagnostic: null }),
    });
    const launched = executor.run({ runId: run.id, agentId: def.id, prompt: 'Answer me', cwd: process.cwd() });
    if (failure === 'startup refusal') await expect(launched).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
    else await launched;
    expect((await lifecycle.waitForTerminal({ runId: run.id }, { signal: AbortSignal.timeout(5000) })).state).toBe('failed');
    // Replay the real lifecycle events over the same SSE boundary the API watches; no listener.
    const frames: string[] = [];
    const subscription = await lifecycle.stream({ runId: run.id, onEvent: event => {
      frames.push(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    } });
    if (subscription.kind === 'ok') subscription.unsubscribe();
    const errors: unknown[] = [];
    const finalizer = createAssistantRunFinalizer({ ledger,
      notices: { ...notices, neverStarted: { kind: 'status', label: 'Run failed before the agent started' } },
      clock: { nowMs: () => 10 }, runIdClassifier: { isDaemonRunId },
      daemon: { openEvents: async () => new Response(frames.join('')), runStatus: async () => 200 },
      scheduler: { schedule: ({ task, delayMs }) => setTimeout(task, delayMs),
        cancel: ({ handle }) => clearTimeout(handle as ReturnType<typeof setTimeout>), sleep: async () => {} },
      onError: error => { errors.push(error); },
    }, { checkpointIntervalMs: 0, maxReconnects: 0 });
    finalizer.watch({ principalId: 'alice', conversationId: 'chat', message: accepted!.message });
    await finalizer.idle({});
    expect(errors).toEqual([]);
    const stored = fixture.rows<{ run_status: string; events_json: string }>(
      'SELECT run_status, events_json FROM ai_chat_messages WHERE id = ?', 'answer')[0]!;
    expect(stored.run_status).toBe('failed');
    const events = JSON.parse(stored.events_json);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'status', label: expect.stringContaining('failed') }));
    if (failure === 'startup refusal') {
      expect(events).toContainEqual(expect.objectContaining({ kind: 'status', label: expect.stringContaining('unknown agentId') }));
    } else {
      expect(events).toContainEqual({ kind: 'raw', line: 'fixture CLI failed\n' });
      expect(events).toContainEqual(expect.objectContaining({ kind: 'status', detail: expect.stringContaining('exit code 7') }));
    }
    expect((await history.messages({ conversationId: 'chat' })).at(-1)).toMatchObject({ runStatus: 'failed' });
    expect((await ledger.durable!.find({ runId: run.id }, {}))!.message.runStatus).toBe('failed');
  } finally { fixture.close(); }
}, 10_000);
