import { expect, it } from 'vitest';
import { createJsonEventStreamHandler } from '@jini-ai/agent-runtime';
import { foldDelegatedWrapperCalls, type AgentEvent } from '@jini-ai/chat/core';
import { translateRunAgentPayload } from '@jini-ai/chat/core/run-events';
import { createToolRegistry } from '@jini-ai/core';
import { createDelegatedToolBridge } from '../../delegated-tool-bridge.js';
import { createToolExecutor } from '../../tool-executor.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { translateAgentRuntimeEvent } from '../event-translation.js';
import { createCliToolCallReceiver } from '../tool-call-receipts.js';

for (const kind of ['legacy-google-stream-json', 'opencode', 'codex']) {
  it(`${kind}: shows one tool row for a CLI call and its bridge execution`, async () => {
    const events: AgentEvent[] = [];
    const save = (payload: { type: string; readonly [key: string]: unknown }) => {
      const event = translateRunAgentPayload({ payload });
      if (event) events.push(event);
    };
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const { run } = await lifecycle.start({ contextRef: 'one-row' });
    const subscription = await lifecycle.stream({ runId: run.id, onEvent: event => {
      if (event.kind === 'agent') save(event.payload);
    } });
    const registry = createToolRegistry({});
    registry.register({ descriptor: { id: 'theme_read_file' }, policy: { authorize: async () => 'allow' as const }, handler: async () => 'contents' });
    const bridge = createDelegatedToolBridge({ lifecycle, toolExecutor: createToolExecutor({ registry }) });
    const input = { path: 'a' };
    const item = { id: 'cli', type: 'mcp_tool_call', server: 'host-server', tool: 'theme_read_file', arguments: input };
    const receiver = createCliToolCallReceiver({ kind, onEvent: rawEvent => {
      const translated = translateAgentRuntimeEvent({ rawEvent });
      if (translated.kind === 'agent') save(translated.payload);
    } });
    const parser = createJsonEventStreamHandler({ kind, onEvent: receiver });
    const feed = (frame: unknown) => parser.feed({ chunk: JSON.stringify(frame) + '\n' });
    try {
      // OpenCode's completed receipt can arrive after the daemon already saved the canonical row.
      if (kind !== 'opencode') feed(kind === 'codex' ? { type: 'item.started', item } : {
        type: 'tool_use', tool_id: 'cli', tool_name: 'theme_read_file', parameters: input,
      });
      await bridge.execute({ runId: run.id, toolUseId: 'canonical', toolId: 'theme_read_file', principal: { id: 'owner' }, input });
      if (kind === 'opencode') feed({ type: 'tool_use', sessionID: 'session', part: { callID: 'cli', tool: 'host_theme_read_file', state: { status: 'completed', input, output: 'contents' } } });
      else feed(kind === 'codex' ? { type: 'item.completed', item: { ...item, status: 'completed', result: { content: [] } } } : {
        type: 'tool_result', tool_id: 'cli', output: 'contents',
      });
      parser.flush();
      const folded = foldDelegatedWrapperCalls({ events });
      expect(folded.filter(event => event.kind === 'tool_use').map(event => event.id)).toEqual(['canonical']);
      expect(folded.filter(event => event.kind === 'tool_result').map(event => event.toolUseId)).toEqual(['canonical']);
    } finally { if (subscription.kind === 'ok') subscription.unsubscribe(); }
  });
}

it('keeps repeated native Gemini calls and a refusal before the bridge visible', () => {
  const events: AgentEvent[] = [];
  const receiver = createCliToolCallReceiver({ kind: 'legacy-google-stream-json', onEvent: payload => {
    const translated = translateAgentRuntimeEvent({ rawEvent: payload });
    if (translated.kind !== 'agent') return;
    const event = translateRunAgentPayload({ payload: translated.payload });
    if (event) events.push(event);
  } });
  for (const id of ['first', 'second']) {
    receiver({ type: 'tool_use', id, name: 'read_file', input: { path: 'a' } });
    receiver({ type: 'tool_result', toolUseId: id, content: 'refused', isError: true });
  }
  expect(foldDelegatedWrapperCalls({ events })).toEqual(events);
  expect(events.filter(event => event.kind === 'tool_use')).toHaveLength(2);
});
