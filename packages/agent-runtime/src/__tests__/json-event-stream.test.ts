import { describe, expect, it } from 'vitest';
import { createJsonEventStreamHandler } from '../json-event-stream.js';

/**
 * Behavioral replay tests against synthetic traces shaped like real Codex
 * `exec --json`, OpenCode `run --format json`, Gemini CLI `--output-format
 * stream-json`, Kimi's OpenAI-chat-style JSONL, and Cursor CLI
 * (`cursor-agent --output-format stream-json`) output (per this file's own
 * parser branches). Same network-access limitation as `claude-stream.test.ts`
 * applies — see that file's header comment.
 */
function feed(kind: string, lines: unknown[]) {
  const events: Record<string, unknown>[] = [];
  const handler = createJsonEventStreamHandler({ kind: kind, onEvent: (event) => events.push(event) });
  for (const line of lines) handler.feed({ chunk: `${JSON.stringify(line)}\n` });
  handler.flush();
  return events;
}

describe('createJsonEventStreamHandler (codex)', () => {
  it('surfaces direct file patches as one native tool event, with paths and no diff content', () => {
    const patch = { type: 'item.completed', item: { id: 'patch-1', type: 'file_change', status: 'completed',
      changes: [{ path: '/tmp/a', kind: 'update', diff: '+private file body' }] } };
    const events = feed('codex', [patch, patch]);
    expect(events.filter(event => event.type === 'tool_use')).toEqual([
      { type: 'tool_use', id: 'patch-1', name: 'apply_patch', input: { paths: ['/tmp/a'] } },
    ]);
    expect(JSON.stringify(events)).not.toContain('private file body');
  });
  it('replays a thread-start → command execution → agent message → usage trace', () => {
    const events = feed('codex', [
      { type: 'thread.started', thread_id: 'thread_abc' },
      { type: 'turn.started' },
      {
        type: 'item.started',
        item: { id: 'cmd_1', type: 'command_execution', command: 'ls' },
      },
      {
        type: 'item.completed',
        item: { id: 'cmd_1', type: 'command_execution', command: 'ls', aggregated_output: 'index.html\n', exit_code: 0 },
      },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Done listing files.' } },
      { type: 'turn.completed', usage: { input_tokens: 200, output_tokens: 30, cached_input_tokens: 50 } },
    ]);

    const types = events.map((e) => e.type);
    expect(types).toEqual(['status', 'status', 'tool_use', 'tool_result', 'text_delta', 'usage']);
    // item.started AND item.completed for the same command id both try to
    // emit tool_use, but the dedupe set only lets the first through.
    const toolUseEvents = events.filter((e) => e.type === 'tool_use');
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0]).toEqual({ type: 'tool_use', id: 'cmd_1', name: 'Bash', input: { command: 'ls' } });

    const toolResult = events.find((e) => e.type === 'tool_result')!;
    expect(toolResult.isError).toBe(false);
    expect(toolResult.content).toContain('index.html');

    const textDelta = events.find((e) => e.type === 'text_delta')!;
    expect(textDelta.delta).toBe('Done listing files.');

    const usage = events.find((e) => e.type === 'usage')!;
    expect(usage.usage).toEqual({ input_tokens: 200, output_tokens: 30, cached_read_tokens: 50 });

    const firstStatus = events[0]!;
    expect(firstStatus.sessionId).toBe('thread_abc');
  });

  it('marks a failed command as an error tool_result', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: { id: 'cmd_2', type: 'command_execution', command: 'false', aggregated_output: '', exit_code: 1 },
      },
    ]);
    const toolResult = events.find((e) => e.type === 'tool_result')!;
    expect(toolResult.isError).toBe(true);
  });

  it('marks a failed command as an error tool_result via status when exit_code is not a number', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: { id: 'cmd_2b', type: 'command_execution', command: 'flaky', aggregated_output: '', status: 'failed' },
      },
    ]);
    const toolResult = events.find((e) => e.type === 'tool_result')!;
    expect(toolResult.isError).toBe(true);
  });

  it('emits a non-fatal status for a recoverable reconnect error', () => {
    const events = feed('codex', [
      { type: 'error', message: 'Reconnecting... stream disconnected before completion' },
    ]);
    expect(events[0]?.type).toBe('status');
  });

  it('recognizes the other recoverable-reconnect substring', () => {
    const events = feed('codex', [
      { type: 'error', message: 'Reconnecting... timeout waiting for child process to exit' },
    ]);
    expect(events[0]?.type).toBe('status');
  });

  it('emits a fatal error event for a non-recoverable error', () => {
    const events = feed('codex', [{ type: 'error', message: 'invalid API key' }]);
    expect(events[0]?.type).toBe('error');
  });

  it('swallows a second fatal error event once one has already been emitted', () => {
    const events = feed('codex', [
      { type: 'error', message: 'invalid API key' },
      { type: 'error', message: 'a second unrelated failure' },
    ]);
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
  });

  it('emits a fatal error for turn.failed and swallows a second one', () => {
    const events = feed('codex', [
      { type: 'turn.failed', error: { message: 'the turn blew up' } },
      { type: 'turn.failed', message: 'a second turn failure' },
    ]);
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('the turn blew up');
  });

  it('surfaces a null sessionId when thread.started has no thread_id', () => {
    const events = feed('codex', [{ type: 'thread.started' }]);
    expect(events[0]).toEqual({ type: 'status', label: 'initializing', sessionId: null });
  });

  it('falls through to raw for an item.started with an unrecognized item type', () => {
    const events = feed('codex', [
      { type: 'item.started', item: { id: 'x', type: 'reasoning' } },
    ]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'item.started', item: { id: 'x', type: 'reasoning' } }) }]);
  });

  // Fixtures below are the actual raw JSON lines a real, locally installed Codex CLI (0.151.0)
  // emitted against a throwaway MCP server during live root-cause reproduction — not synthesized
  // from the docs alone. Before this parser recognized `item.type: 'mcp_tool_call'`, every one of
  // these fell through to `{type:'raw', line}` (see the "falls through to raw" test above for the
  // shape that produces), which `@jini-ai/chat`'s transcript reducer never renders — so a genuine
  // tool call, success or failure, was invisible to both the operator and the audit trail. This is
  // the actual bug: Codex's own MCP client can call `execute_delegated_tool` for real and even have
  // it denied by Codex's own approval gate, and the daemon/UI would show nothing at all.
  it('emits a tool_use for an item.started mcp_tool_call (in_progress)', () => {
    const events = feed('codex', [
      {
        type: 'item.started',
        item: {
          id: 'item_0',
          type: 'mcp_tool_call',
          server: 'jini',
          tool: 'execute_delegated_tool',
          arguments: { toolId: 'media_generate_asset', input: { prompt: 'A solid green square' } },
          result: null,
          error: null,
          status: 'in_progress',
        },
      },
    ]);
    expect(events).toEqual([
      {
        type: 'tool_use',
        id: 'item_0',
        name: 'execute_delegated_tool',
        input: { toolId: 'media_generate_asset', input: { prompt: 'A solid green square' } },
      },
    ]);
  });

  it('reports a denied/failed mcp_tool_call as an error tool_result, not silence', () => {
    // Captured verbatim from a real denial: Codex's headless approval gate auto-denies an MCP tool
    // call whose def carries no `readOnlyHint: true` annotation (`execute_delegated_tool`'s own
    // annotations are all `false` — see `packages/mcp/src/server/tools/delegated-tool.ts`), before
    // the call ever reaches the target MCP server.
    const events = feed('codex', [
      {
        type: 'item.started',
        item: {
          id: 'item_0',
          type: 'mcp_tool_call',
          server: 'probe',
          tool: 'probe_tool',
          arguments: { note: 'hello-from-repro' },
          result: null,
          error: null,
          status: 'in_progress',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'mcp_tool_call',
          server: 'probe',
          tool: 'probe_tool',
          arguments: { note: 'hello-from-repro' },
          result: null,
          error: { message: 'MCP tool call requires approval, but approval policy is never' },
          status: 'failed',
        },
      },
    ]);
    // Exactly one tool_use (deduped against the item.started frame), plus a matching error result —
    // never a silent drop, and never a second, duplicate tool_use for the same call id.
    expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(1);
    const toolResult = events.find((e) => e.type === 'tool_result')!;
    expect(toolResult).toEqual({
      type: 'tool_result',
      toolUseId: 'item_0',
      content: 'MCP tool call requires approval, but approval policy is never',
      isError: true,
    });
  });

  it('reports a completed mcp_tool_call as a successful tool_result carrying the real output', () => {
    // Captured verbatim from a real success: the identical probe tool, annotated `readOnlyHint:
    // true`, completes normally under Codex's headless approval gate.
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'mcp_tool_call',
          server: 'probe',
          tool: 'probe_tool',
          arguments: { note: 'hello-readonly' },
          result: { content: [{ type: 'text', text: 'PROBE_OK: received "hello-readonly"' }], structured_content: null },
          error: null,
          status: 'completed',
        },
      },
    ]);
    // No preceding item.started in this trace (a truncated/mid-stream feed) — the fallback inside
    // the item.completed branch still emits the tool_use, mirroring command_execution's own
    // fallback shape, so the call is never silently missing its opening card either.
    expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(1);
    const toolResult = events.find((e) => e.type === 'tool_result')!;
    expect(toolResult.isError).toBe(false);
    expect(toolResult.toolUseId).toBe('item_0');
    expect(JSON.parse(toolResult.content as string)).toEqual({
      content: [{ type: 'text', text: 'PROBE_OK: received "hello-readonly"' }],
      structured_content: null,
    });
  });

  // Source-shaped fixtures, not captured logs: installed Codex 0.161.0's exec schema and mapper
  // preserve result.content/structured_content independently of error and status.
  // https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/exec/src/exec_events.rs#L243
  it.each([
    {
      name: 'result text when the error is null',
      error: null,
      result: { content: [{ type: 'text', text: 'TOOL_OPERATION_DENIED: Write access required.' }], structured_content: null },
      expected: 'TOOL_OPERATION_DENIED: Write access required.',
    },
    {
      name: 'all text blocks while ignoring image blocks and metadata',
      error: null,
      result: { content: [{ type: 'image', data: 'private-image', mimeType: 'image/png' },
        { type: 'text', text: 'Permission denied.' }, { type: 'text', text: 'Request write access.' }],
        structured_content: null, _meta: { trace: 'private-metadata' } },
      expected: 'Permission denied.\nRequest write access.',
    },
    {
      name: 'JSON text with its error code and recovery hint intact',
      error: null,
      result: { content: [{ type: 'text', text: '{"error":{"code":"DEFINITION_NOT_FOUND","message":"List forms first."}}' }], structured_content: null },
      expected: '{"error":{"code":"DEFINITION_NOT_FOUND","message":"List forms first."}}',
    },
    {
      name: 'structured errors with their code when there are no text blocks',
      error: null,
      result: { content: [], structured_content: { error: { code: 'TOOL_OPERATION_DENIED', message: 'Write access required.' } } },
      expected: 'TOOL_OPERATION_DENIED: Write access required.',
    },
    {
      name: 'explicit errors before result diagnostics',
      error: { message: 'Approval denied.' },
      result: { content: [{ type: 'text', text: 'Result diagnostic.' }], structured_content: null },
      expected: 'Approval denied.',
    },
    {
      name: 'result diagnostics when the explicit error message is blank',
      error: { message: ' \n ' },
      result: { content: [{ type: 'text', text: 'Permission denied.' }], structured_content: null },
      expected: 'Permission denied.',
    },
    {
      name: 'numeric codes in JSON encoded transport errors',
      error: { message: '{"error":{"code":-32602,"message":"Invalid arguments."}}' },
      result: null,
      expected: '-32602: Invalid arguments.',
    },
    {
      name: 'code-only errors in JSON encoded transport errors',
      error: { message: '{"error":{"code":"TOOL_OPERATION_DENIED"}}' },
      result: null,
      expected: 'TOOL_OPERATION_DENIED',
    },
    {
      name: 'the fallback when result and error are null',
      error: null,
      result: null,
      expected: 'MCP tool call failed',
    },
    {
      name: 'the fallback when result contains no diagnostic',
      error: {},
      result: { content: [{ type: 'text', text: ' \n ' }, { type: 'image', data: 'private-image' }], structured_content: {} },
      expected: 'MCP tool call failed',
    },
  ])('reports $name for a failed MCP call', ({ error, result, expected }) => {
    const events = feed('codex', [{ type: 'item.completed', item: {
      id: 'mcp-failed', type: 'mcp_tool_call', server: 'probe', tool: 'probe_tool',
      arguments: {}, error, result, status: 'failed',
    } }]);
    expect(events).toEqual([
      // External MCP tools retain their server namespace to prevent built-in tool impersonation.
      { type: 'tool_use', id: 'mcp-failed', name: 'mcp__probe__probe_tool', input: {} },
      { type: 'tool_result', toolUseId: 'mcp-failed', content: expected, isError: true },
    ]);
  });

  it.each(['error', 'text', 'structured'])('sanitizes failed MCP diagnostics from %s', source => {
    const secret = 'x7Qm2Pz9Vb4Nc8Ld1Rf6Yt3Wk5';
    const escape = String.fromCharCode(27);
    const message = `${escape}[31mTOOL_OPERATION_DENIED api_key=${secret}${escape}[0m`;
    const events = feed('codex', [{ type: 'item.completed', item: {
      id: 'mcp-secret', type: 'mcp_tool_call', server: 'probe', tool: 'probe_tool', arguments: {},
      error: source === 'error' ? { message } : null,
      result: { content: source === 'text' ? [{ type: 'text', text: message }] : [],
        structured_content: source === 'structured' ? { error: { message } } : null },
      status: 'failed',
    } }]);
    expect(events.find(event => event.type === 'tool_result')).toEqual({
      type: 'tool_result', toolUseId: 'mcp-secret',
      content: 'TOOL_OPERATION_DENIED api_key=[redacted]', isError: true,
    });
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain('\\u001b');
  });

  it('bounds failed MCP diagnostics with the shared sanitizer', () => {
    const events = feed('codex', [{ type: 'item.completed', item: {
      id: 'mcp-long', type: 'mcp_tool_call', server: 'probe', tool: 'probe_tool', arguments: {},
      error: null, result: { content: [{ type: 'text', text: 'denied '.repeat(200) }], structured_content: null },
      status: 'failed',
    } }]);
    const content = events.find(event => event.type === 'tool_result')?.content as string;
    expect(content).toHaveLength(500);
    expect(content).toMatch(/^denied .*… \[truncated\]$/u);
  });

  it('emits a TodoWrite tool_use for an item.started todo_list', () => {
    const events = feed('codex', [
      {
        type: 'item.started',
        item: { id: 'todo_1', type: 'todo_list', items: [{ content: 'write tests', status: 'in_progress' }] },
      },
    ]);
    expect(events).toEqual([
      {
        type: 'tool_use',
        id: 'todo_1',
        name: 'TodoWrite',
        input: { todos: [{ content: 'write tests', status: 'in_progress' }] },
      },
    ]);
  });

  it('emits a TodoWrite tool_use for an item.updated todo_list and falls through otherwise', () => {
    const updated = feed('codex', [
      {
        type: 'item.updated',
        item: { id: 'todo_1', type: 'todo_list', items: [{ content: 'write tests', status: 'completed' }] },
      },
    ]);
    expect(updated[0]?.type).toBe('tool_use');

    const notTodo = feed('codex', [
      { type: 'item.updated', item: { id: 'x', type: 'reasoning' } },
    ]);
    expect(notTodo).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'item.updated', item: { id: 'x', type: 'reasoning' } }) }]);
  });

  it('emits a TodoWrite tool_use for an item.completed todo_list', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: { id: 'todo_1', type: 'todo_list', items: [{ content: 'ship it', status: 'stopped' }] },
      },
    ]);
    expect(events).toEqual([
      {
        type: 'tool_use',
        id: 'todo_1',
        name: 'TodoWrite',
        input: { todos: [{ content: 'ship it', status: 'stopped' }] },
      },
    ]);
  });

  it('surfaces a connector-tool-selection error alongside the failed command tool_result, once', () => {
    const connectorPayload = JSON.stringify({
      error: {
        code: 'CONNECTOR_TOOL_NOT_FOUND',
        details: { connectorId: 'conn_1', toolName: 'search_docs' },
      },
    });
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: { id: 'cmd_3', type: 'command_execution', command: 'call-tool', aggregated_output: connectorPayload, exit_code: 1 },
      },
      // A second connector error in the same turn must be swallowed.
      {
        type: 'item.completed',
        item: { id: 'cmd_4', type: 'command_execution', command: 'call-tool-again', aggregated_output: connectorPayload, exit_code: 1 },
      },
    ]);
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('search_docs');
    expect(errors[0]?.message).toContain('conn_1');
  });

  it('formats a connector-tool error without a connectorId and without a toolName', () => {
    const withoutConnector = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'cmd_5',
          type: 'command_execution',
          command: 'x',
          aggregated_output: JSON.stringify({ error: { code: 'CONNECTOR_TOOL_NOT_FOUND', details: {} } }),
          exit_code: 1,
        },
      },
    ]);
    const error = withoutConnector.find((e) => e.type === 'error')!;
    expect(error.message).toContain('the requested connector tool');
    expect(error.message).not.toContain('for connector');
  });

  it('does not treat a CONNECTOR_TOOL_NOT_FOUND mention as an error unless it parses to that code', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'cmd_6',
          type: 'command_execution',
          command: 'x',
          aggregated_output: 'saw CONNECTOR_TOOL_NOT_FOUND in the logs but not as JSON',
          exit_code: 0,
        },
      },
    ]);
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
  });

  it('inserts a newline boundary between two agent_message chunks when the first did not end with one', () => {
    const events = feed('codex', [
      { type: 'item.completed', item: { type: 'agent_message', text: 'no trailing newline' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'continues right after' } },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual(['no trailing newline', '\ncontinues right after']);
  });

  it('does not insert a boundary when the prior chunk already ended with a newline', () => {
    const events = feed('codex', [
      { type: 'item.completed', item: { type: 'agent_message', text: 'ends with newline\n' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'next chunk' } },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual(['ends with newline\n', 'next chunk']);
  });

  it('does not insert a boundary when the next chunk itself starts with a newline', () => {
    const events = feed('codex', [
      { type: 'item.completed', item: { type: 'agent_message', text: 'no trailing newline' } },
      { type: 'item.completed', item: { type: 'agent_message', text: '\nstarts with newline' } },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual(['no trailing newline', '\nstarts with newline']);
  });

  it('resets the agent-message boundary tracking on turn.started', () => {
    const events = feed('codex', [
      { type: 'item.completed', item: { type: 'agent_message', text: 'first turn text' } },
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'second turn text' } },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual(['first turn text', 'second turn text']);
  });

  it('falls through to raw for item.completed with an agent_message that has empty text', () => {
    const events = feed('codex', [
      { type: 'item.completed', item: { type: 'agent_message', text: '' } },
    ]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '' } }) }]);
  });

  it('captures reasoning_output_tokens as thought_tokens on turn.completed', () => {
    const events = feed('codex', [
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 3 } },
    ]);
    expect(events[0]).toEqual({ type: 'usage', usage: { input_tokens: 10, output_tokens: 5, thought_tokens: 3 } });
  });

  it('falls through to raw for turn.completed without a usage object', () => {
    const events = feed('codex', [{ type: 'turn.completed' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'turn.completed' }) }]);
  });
});

describe('createJsonEventStreamHandler (opencode)', () => {
  it('replays a step_start → text → tool_use trace and captures the session id', () => {
    const events = feed('opencode', [
      { type: 'step_start', sessionID: 'ses_123' },
      { type: 'text', part: { text: 'Working on it.' } },
      {
        type: 'tool_use',
        sessionID: 'ses_123',
        part: { tool: 'write', callID: 'call_1', state: { input: { path: 'a.html' } } },
      },
    ]);

    const types = events.map((e) => e.type);
    expect(types).toEqual(['status', 'text_delta', 'tool_use']);
    expect(events[0]).toMatchObject({ type: 'status', label: 'running', sessionId: 'ses_123' });
    expect(events[1]).toEqual({ type: 'text_delta', delta: 'Working on it.' });
  });

  it('falls through to a raw event for an unrecognized shape', () => {
    const events = feed('opencode', [{ type: 'totally-unknown-event' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'totally-unknown-event' }) }]);
  });

  it('surfaces a null sessionId when step_start has no sessionID', () => {
    const events = feed('opencode', [{ type: 'step_start' }]);
    expect(events[0]).toEqual({ type: 'status', label: 'running', sessionId: null });
  });

  it('falls through to raw for a text event with empty or missing text', () => {
    const empty = feed('opencode', [{ type: 'text', part: { text: '' } }]);
    expect(empty).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'text', part: { text: '' } }) }]);

    const missing = feed('opencode', [{ type: 'text' }]);
    expect(missing).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'text' }) }]);
  });

  it('falls through to raw for a tool_use event missing a tool name or callID', () => {
    const events = feed('opencode', [{ type: 'tool_use', part: { tool: 'write' } }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'tool_use', part: { tool: 'write' } }) }]);
  });

  it('dedupes a repeated tool_use by session+callID but still re-emits tool_result each time state is completed', () => {
    const trace = [
      {
        type: 'tool_use',
        sessionID: 'ses_1',
        part: { tool: 'bash', callID: 'call_9', state: { input: { command: 'ls' }, status: 'completed', output: 'a.txt' } },
      },
      {
        type: 'tool_use',
        sessionID: 'ses_1',
        part: { tool: 'bash', callID: 'call_9', state: { input: { command: 'ls' }, status: 'completed', output: 'a.txt' } },
      },
    ];
    const events = feed('opencode', trace);
    const toolUses = events.filter((e) => e.type === 'tool_use');
    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolUses).toHaveLength(1);
    expect(toolResults).toHaveLength(2);
  });

  it('emits an empty tool_result content when a completed state has no output field', () => {
    const events = feed('opencode', [
      {
        type: 'tool_use',
        sessionID: 'ses_3',
        part: { tool: 'bash', callID: 'call_12', state: { input: {}, status: 'completed' } },
      },
    ]);
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toEqual({ type: 'tool_result', toolUseId: 'call_12', content: '', isError: false });
  });

  it('emits a tool_use with null input and no tool_result when there is no state part', () => {
    const events = feed('opencode', [
      { type: 'tool_use', sessionID: 'ses_2', part: { tool: 'bash', callID: 'call_10' } },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'call_10', name: 'bash', input: null }]);
  });

  it('falls back to a raw session key when sessionID is absent for tool_use dedupe', () => {
    const events = feed('opencode', [
      { type: 'tool_use', part: { tool: 'bash', callID: 'call_11' } },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'call_11', name: 'bash', input: null }]);
  });

  it('swallows step_finish silently when there is no usable usage', () => {
    const events = feed('opencode', [{ type: 'step_finish', part: {} }]);
    expect(events).toEqual([]);
  });

  it('emits a usage event with an undefined cost when step_finish has no numeric cost', () => {
    const events = feed('opencode', [
      { type: 'step_finish', part: { tokens: { input: 5, output: 2 } } },
    ]);
    expect(events).toEqual([
      { type: 'usage', usage: { input_tokens: 5, output_tokens: 2 }, costUsd: undefined },
    ]);
  });

  it('captures reasoning tokens and cache read/write tokens on step_finish', () => {
    const events = feed('opencode', [
      {
        type: 'step_finish',
        part: { tokens: { input: 5, output: 2, reasoning: 1, cache: { read: 3, write: 4 } }, cost: 0.01 },
      },
    ]);
    expect(events[0]).toEqual({
      type: 'usage',
      usage: { input_tokens: 5, output_tokens: 2, thought_tokens: 1, cached_read_tokens: 3, cached_write_tokens: 4 },
      costUsd: 0.01,
    });
  });

  it('surfaces an OpenCode error frame using obj.error over obj.message', () => {
    const events = feed('opencode', [
      { type: 'error', error: { message: 'auth failed' }, message: 'fallback message' },
    ]);
    expect(events[0]).toMatchObject({ type: 'error', message: 'auth failed' });
  });

  it('falls back to obj.message and then the default when there is no obj.error', () => {
    const withMessage = feed('opencode', [{ type: 'error', message: 'network blip' }]);
    expect(withMessage[0]).toMatchObject({ type: 'error', message: 'network blip' });

    const withNeither = feed('opencode', [{ type: 'error' }]);
    expect(withNeither[0]).toMatchObject({ type: 'error', message: 'OpenCode error' });
  });
});

describe('createJsonEventStreamHandler (gemini)', () => {
  it('replays an init → user message (swallowed) → assistant text → tool_use → tool_result → usage result trace', () => {
    const events = feed('legacy-google-stream-json', [
      { type: 'init', model: 'gemini-2.5-pro' },
      { type: 'message', role: 'user', content: 'hello' },
      { type: 'message', role: 'assistant', content: 'Looking into it.' },
      {
        type: 'tool_use',
        tool_id: 'tool_1',
        tool_name: 'read_file',
        parameters: { path: 'a.txt' },
      },
      { type: 'tool_result', tool_id: 'tool_1', output: 'file contents' },
      {
        type: 'result',
        status: 'ok',
        stats: { input_tokens: 10, output_tokens: 4, cached: 2, duration_ms: 120 },
      },
    ]);

    expect(events.map((e) => e.type)).toEqual(['status', 'text_delta', 'tool_use', 'tool_result', 'usage']);
    expect(events[0]).toEqual({ type: 'status', label: 'initializing', model: 'gemini-2.5-pro' });
    expect(events[1]).toEqual({ type: 'text_delta', delta: 'Looking into it.' });
    expect(events[2]).toEqual({ type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: 'a.txt' } });
    expect(events[3]).toEqual({ type: 'tool_result', toolUseId: 'tool_1', content: 'file contents', isError: false });
    expect(events[4]).toMatchObject({
      type: 'usage',
      usage: { input_tokens: 10, output_tokens: 4, cached_read_tokens: 2 },
      durationMs: 120,
    });
  });

  it('emits an init status with an undefined model when init has no model field', () => {
    const events = feed('legacy-google-stream-json', [{ type: 'init' }]);
    expect(events[0]).toEqual({ type: 'status', label: 'initializing', model: undefined });
  });

  it('emits a null-input tool_use when a gemini tool_use has no parameters field at all', () => {
    const events = feed('legacy-google-stream-json', [
      { type: 'tool_use', tool_id: 'tool_noparams', tool_name: 'list_dir' },
    ]);
    expect(events[0]).toEqual({ type: 'tool_use', id: 'tool_noparams', name: 'list_dir', input: null });
  });

  it('falls through to raw for an assistant message with empty content', () => {
    const events = feed('legacy-google-stream-json', [{ type: 'message', role: 'assistant', content: '' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'message', role: 'assistant', content: '' }) }]);
  });

  it('emits a native TodoWrite tool_use for a write_todos tool call', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_2',
        tool_name: 'write_todos',
        parameters: { todos: [{ content: 'plan the work', status: 'pending' }] },
      },
    ]);
    expect(events).toEqual([
      {
        type: 'tool_use',
        id: 'tool_2:todo-native',
        name: 'TodoWrite',
        input: { todos: [{ content: 'plan the work', status: 'pending' }] },
      },
    ]);
  });

  it('falls back to a plain tool_use for write_todos when the parsed input has no usable todo list', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_3',
        tool_name: 'write_todos',
        parameters: { nothing: 'useful' },
      },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'tool_3', name: 'write_todos', input: { nothing: 'useful' } }]);
  });

  it('suppresses the very next assistant text once a file-write tool_use has fired', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_4',
        tool_name: 'write_file',
        parameters: { file_path: 'index.html', content: '<html></html>' },
      },
      {
        type: 'message',
        role: 'assistant',
        content: '<artifact identifier="a" type="text/html">echoed content</artifact>',
      },
    ]);
    const toolUse = events.find((e) => e.type === 'tool_use')!;
    expect(toolUse).toMatchObject({ name: 'write_file' });
    expect(events.some((e) => e.type === 'text_delta')).toBe(false);
  });

  it('recovers a partial artifact-open tag split across two assistant-text chunks', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_5',
        tool_name: 'write_file',
        parameters: { file_path: 'index.html', content: '<html></html>' },
      },
      { type: 'message', role: 'assistant', content: 'Wrote it. <artif' },
      { type: 'message', role: 'assistant', content: 'act>hidden</artifact> visible after' },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual(['Wrote it. ', ' visible after']);
  });

  it('passes assistant text through unmodified when suppressNextArtifactText has no tag to find', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_6',
        tool_name: 'write_file',
        parameters: { file_path: 'index.html', content: '<html></html>' },
      },
      { type: 'message', role: 'assistant', content: 'Just plain text, no tags at all.' },
    ]);
    const textDelta = events.find((e) => e.type === 'text_delta')!;
    expect(textDelta.delta).toBe('Just plain text, no tags at all.');
  });

  it('does not suppress a file-write tool_use for a tool name outside the write set', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_7',
        tool_name: 'read_file',
        parameters: { file_path: 'index.html' },
      },
      { type: 'message', role: 'assistant', content: '<artifact>should pass through</artifact>' },
    ]);
    const textDelta = events.find((e) => e.type === 'text_delta')!;
    expect(textDelta.delta).toBe('<artifact>should pass through</artifact>');
  });

  it('surfaces a tool_result error using the error object message and flags isError', () => {
    const events = feed('legacy-google-stream-json', [
      { type: 'tool_result', tool_id: 'tool_8', error: { message: 'permission denied' } },
    ]);
    expect(events[0]).toEqual({ type: 'tool_result', toolUseId: 'tool_8', content: 'permission denied', isError: true });
  });

  it('stringifies a non-string tool_result output', () => {
    const events = feed('legacy-google-stream-json', [
      { type: 'tool_result', tool_id: 'tool_9', output: { rows: 3 }, status: 'ok' },
    ]);
    expect(events[0]).toEqual({ type: 'tool_result', toolUseId: 'tool_9', content: JSON.stringify({ rows: 3 }), isError: false });
  });

  it('flags a tool_result as an error via status=error even with no error object', () => {
    const events = feed('legacy-google-stream-json', [
      { type: 'tool_result', tool_id: 'tool_10', output: 'nope', status: 'error' },
    ]);
    expect(events[0]).toMatchObject({ isError: true });
  });

  it('downgrades a warning-severity error frame to a status event', () => {
    const events = feed('legacy-google-stream-json', [{ type: 'error', severity: 'WARNING', message: 'quota nearing limit' }]);
    expect(events[0]).toEqual({ type: 'status', label: 'warning', detail: 'quota nearing limit' });
  });

  it('emits a fatal error event for a non-warning error frame using the default message', () => {
    const events = feed('legacy-google-stream-json', [{ type: 'error' }]);
    expect(events[0]).toMatchObject({ type: 'error', message: 'Google stream error' });
  });

  it('surfaces a result with an error status as an error event', () => {
    const events = feed('legacy-google-stream-json', [{ type: 'result', status: 'error', error: { message: 'ran out of quota' } }]);
    expect(events[0]).toEqual({ type: 'error', message: 'ran out of quota', raw: JSON.stringify({ type: 'result', status: 'error', error: { message: 'ran out of quota' } }) });
  });

  it('swallows a result event with no stats object', () => {
    const events = feed('legacy-google-stream-json', [{ type: 'result', status: 'ok' }]);
    expect(events).toEqual([]);
  });

  it('falls through to raw for an unrecognized legacy Google stream event shape', () => {
    const events = feed('legacy-google-stream-json', [{ type: 'session.summary' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'session.summary' }) }]);
  });

  it('flushes pending artifact text still buffered when the stream ends mid-tag', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_11',
        tool_name: 'write_file',
        parameters: { file_path: 'index.html', content: '<html></html>' },
      },
      { type: 'message', role: 'assistant', content: 'trailing partial <artif' },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    // The partial "<artif" candidate never resolves before flush(), so it is
    // flushed back out rather than silently dropped.
    expect(deltas).toEqual(['trailing partial ', '<artif']);
  });
});

describe('createJsonEventStreamHandler (kimi)', () => {
  it('replays tool_calls → tool result → assistant text', () => {
    const events = feed('kimi', [
      {
        role: 'assistant',
        tool_calls: [
          { id: 'call_1', function: { name: 'bash', arguments: '{"command":"ls"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'index.html' },
      { role: 'assistant', content: 'Here is the listing.' },
    ]);
    expect(events.map((e) => e.type)).toEqual(['tool_use', 'tool_result', 'text_delta']);
    expect(events[0]).toEqual({ type: 'tool_use', id: 'call_1', name: 'bash', input: { command: 'ls' } });
    expect(events[1]).toEqual({ type: 'tool_result', toolUseId: 'call_1', content: 'index.html', isError: false });
    expect(events[2]).toEqual({ type: 'text_delta', delta: 'Here is the listing.' });
  });

  it('skips malformed tool_calls entries lacking an id or function name', () => {
    const events = feed('kimi', [
      {
        role: 'assistant',
        tool_calls: [
          { function: { name: 'bash' } }, // no id
          { id: 'call_2' }, // no function/name
          { id: '  ', function: { name: 'bash' } }, // blank id
          { id: 'call_3', function: { name: '   ' } }, // blank name
          { id: 'call_4', function: { name: 'grep', arguments: { pattern: 'foo' } } },
        ],
      },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'call_4', name: 'grep', input: { pattern: 'foo' } }]);
  });

  it('emits a null-input tool_use when a tool_calls entry has no arguments field at all', () => {
    const events = feed('kimi', [
      {
        role: 'assistant',
        tool_calls: [{ id: 'call_5', function: { name: 'noop' } }],
      },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'call_5', name: 'noop', input: null }]);
  });

  it('falls through to raw when tool_call_id is blank on a tool-role message', () => {
    const events = feed('kimi', [{ role: 'tool', tool_call_id: '   ', content: 'x' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ role: 'tool', tool_call_id: '   ', content: 'x' }) }]);
  });

  it('swallows a session.resume_hint meta message', () => {
    const events = feed('kimi', [{ role: 'meta', type: 'session.resume_hint', sessionId: 'abc' }]);
    expect(events).toEqual([]);
  });

  it('falls through to raw for an unrecognized kimi shape', () => {
    const events = feed('kimi', [{ role: 'system', content: 'be nice' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ role: 'system', content: 'be nice' }) }]);
  });
});

describe('createJsonEventStreamHandler (cursor-agent)', () => {
  it('replays a system-init status', () => {
    const events = feed('cursor-agent', [{ type: 'system', subtype: 'init', model: 'cursor-large' }]);
    expect(events).toEqual([{ type: 'status', label: 'initializing', model: 'cursor-large' }]);
  });

  it('accumulates timestamped incremental deltas verbatim without dedup, including a repeated-prefix chunk', () => {
    const events = feed('cursor-agent', [
      { type: 'assistant', timestamp_ms: 1, message: { content: [{ type: 'text', text: 'ha' }] } },
      { type: 'assistant', timestamp_ms: 2, message: { content: [{ type: 'text', text: 'ha' }] } },
    ]);
    expect(events.map((e) => e.delta)).toEqual(['ha', 'ha']);
  });

  it('ignores an assistant message with no extractable text and no timestamp', () => {
    const events = feed('cursor-agent', [{ type: 'assistant', message: { content: [] } }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'assistant', message: { content: [] } }) }]);
  });

  it('filters non-text content blocks when extracting cursor text', () => {
    const events = feed('cursor-agent', [
      {
        type: 'assistant',
        timestamp_ms: 5,
        message: { content: [{ type: 'image', data: 'xyz' }, { type: 'text', text: 'only this' }] },
      },
    ]);
    expect(events).toEqual([{ type: 'text_delta', delta: 'only this' }]);
  });

  it('reconciles a model_call_id terminal replay against the emitted turn text, emitting only the missing suffix', () => {
    const events = feed('cursor-agent', [
      { type: 'assistant', timestamp_ms: 1, message: { content: [{ type: 'text', text: 'Hel' }] } },
      { type: 'assistant', timestamp_ms: 2, message: { content: [{ type: 'text', text: 'lo' }] } },
      { type: 'assistant', model_call_id: 'call_1', message: { content: [{ type: 'text', text: 'Hello there' }] } },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual(['Hel', 'lo', ' there']);
  });

  it('does not duplicate text on a diverging model_call_id replay (a non-final chunk was dropped)', () => {
    const events = feed('cursor-agent', [
      { type: 'assistant', timestamp_ms: 1, message: { content: [{ type: 'text', text: 'Goodbye' }] } },
      // Replay diverges from what was streamed — must not re-emit anything.
      { type: 'assistant', model_call_id: 'call_2', message: { content: [{ type: 'text', text: 'Something else entirely' }] } },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual(['Goodbye']);
  });

  it('handles a model_call_id replay with no prior emitted text for the turn (empty prefix case)', () => {
    const events = feed('cursor-agent', [
      { type: 'assistant', model_call_id: 'call_3', message: { content: [{ type: 'text', text: 'Full reply' }] } },
    ]);
    expect(events).toEqual([{ type: 'text_delta', delta: 'Full reply' }]);
  });

  it('reconciles a non-timestamped terminal assistant message the same way and advances the turn boundary', () => {
    const events = feed('cursor-agent', [
      { type: 'assistant', timestamp_ms: 1, message: { content: [{ type: 'text', text: 'part one ' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'part one and two' }] } },
      // A second, later turn: emitted turn text must reset independently.
      { type: 'assistant', timestamp_ms: 3, message: { content: [{ type: 'text', text: 'second turn' }] } },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual(['part one ', 'and two', 'second turn']);
  });

  it('emits a usage event from a result with cache read/write tokens and duration', () => {
    const events = feed('cursor-agent', [
      {
        type: 'result',
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 },
        duration_ms: 300,
      },
    ]);
    expect(events).toEqual([
      {
        type: 'usage',
        usage: { input_tokens: 10, output_tokens: 5, cached_read_tokens: 2, cached_write_tokens: 1 },
        durationMs: 300,
      },
    ]);
  });

  it('falls through to raw for a result event with no usage object', () => {
    const events = feed('cursor-agent', [{ type: 'result' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'result' }) }]);
  });

  it('falls through to raw for an unrecognized cursor-agent shape', () => {
    const events = feed('cursor-agent', [{ type: 'ping' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'ping' }) }]);
  });
});

describe('createJsonEventStreamHandler (dispatch/plumbing)', () => {
  it('emits a raw event for a malformed JSON line instead of throwing', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createJsonEventStreamHandler({ kind: 'codex', onEvent: (event) => events.push(event) });
    handler.feed({ chunk: '{not valid json\n' });
    handler.flush();
    expect(events).toEqual([{ type: 'raw', line: '{not valid json' }]);
  });

  it('falls back to raw for every event under an unrecognized parser kind', () => {
    const events = feed('some-unknown-cli', [{ type: 'system', subtype: 'init' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'system', subtype: 'init' }) }]);
  });

  it('skips blank lines within a chunk instead of emitting an event for them', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createJsonEventStreamHandler({ kind: 'codex', onEvent: (event) => events.push(event) });
    handler.feed({ chunk: '\n   \n' + `${JSON.stringify({ type: 'turn.started' })}\n` + '\n' });
    handler.flush();
    expect(events).toEqual([{ type: 'status', label: 'thinking' }]);
  });

  it('flush() is a no-op when there is no buffered remainder and nothing pending', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createJsonEventStreamHandler({ kind: 'codex', onEvent: (event) => events.push(event) });
    handler.flush();
    expect(events).toEqual([]);
  });

  it('processes a final unterminated line on flush()', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createJsonEventStreamHandler({ kind: 'codex', onEvent: (event) => events.push(event) });
    handler.feed({ chunk: JSON.stringify({ type: 'turn.started' }) }); // no trailing newline
    expect(events).toEqual([]); // not processed until flush
    handler.flush();
    expect(events).toEqual([{ type: 'status', label: 'thinking' }]);
  });

  it('treats a non-record top-level JSON value (e.g. a bare array) as unhandled and falls back to raw', () => {
    const events = feed('legacy-google-stream-json', [[] as unknown]);
    expect(events).toEqual([{ type: 'raw', line: '[]' }]);
  });
});

describe('extractConnectorApiError / connectorToolSelectionErrorMessage (via codex connector errors)', () => {
  it('finds the connector error nested under error.data.error when the top-level error has no code', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'cmd_nested',
          type: 'command_execution',
          command: 'x',
          aggregated_output: JSON.stringify({
            error: {
              data: {
                error: {
                  code: 'CONNECTOR_TOOL_NOT_FOUND',
                  details: { connectorId: 'conn_9', toolName: 'deep_tool' },
                },
              },
            },
          }),
          exit_code: 1,
        },
      },
    ]);
    const error = events.find((e) => e.type === 'error')!;
    expect(error.message).toContain('deep_tool');
    expect(error.message).toContain('conn_9');
  });

  it('gives up (no connector error surfaced) when the error object has no string code anywhere', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'cmd_nocode',
          type: 'command_execution',
          command: 'x',
          aggregated_output: JSON.stringify({
            error: { message: 'CONNECTOR_TOOL_NOT_FOUND happened but no code field' },
          }),
          exit_code: 1,
        },
      },
    ]);
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
  });

  it('falls back to an empty details object when the connector error has no details field at all', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'cmd_nodetails',
          type: 'command_execution',
          command: 'x',
          aggregated_output: JSON.stringify({ error: { code: 'CONNECTOR_TOOL_NOT_FOUND' } }),
          exit_code: 1,
        },
      },
    ]);
    const error = events.find((e) => e.type === 'error')!;
    expect(error.message).toContain('the requested connector tool');
    expect(error.message).toContain('is not allowed.');
  });

  it('scans a multi-line aggregated_output for the connector error, skipping lines that are not JSON objects', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'cmd_multiline',
          type: 'command_execution',
          command: 'x',
          aggregated_output: [
            'plain non-JSON noise line, mentions CONNECTOR_TOOL_NOT_FOUND but is not parseable',
            JSON.stringify({ error: { code: 'CONNECTOR_TOOL_NOT_FOUND', details: { toolName: 'listed_tool' } } }),
          ].join('\n'),
          exit_code: 1,
        },
      },
    ]);
    const error = events.find((e) => e.type === 'error')!;
    expect(error.message).toContain('listed_tool');
    expect(error.message).toContain('not allowed.');
  });
});

describe('extractErrorMessage (via opencode error frames)', () => {
  it('recurses through a JSON-string error into its nested message', () => {
    const events = feed('opencode', [
      { type: 'error', error: JSON.stringify({ message: 'deep nested via string' }) },
    ]);
    expect(events[0]).toMatchObject({ message: 'deep nested via string' });
  });

  it('recurses through a nested error object (value.error is itself an object)', () => {
    const events = feed('opencode', [
      { type: 'error', error: { error: { message: 'via nested error object' } } },
    ]);
    expect(events[0]).toMatchObject({ message: 'via nested error object' });
  });

  it('falls back to a nested data object when there is no direct detail/message/error', () => {
    const events = feed('opencode', [
      { type: 'error', error: { data: { message: 'via data wrap' } } },
    ]);
    expect(events[0]).toMatchObject({ message: 'via data wrap' });
  });

  it('falls back to a plain string name field as a last resort', () => {
    const events = feed('opencode', [{ type: 'error', error: { name: 'AuthError' } }]);
    expect(events[0]).toMatchObject({ message: 'AuthError' });
  });

  it('prefers a detail string when present', () => {
    const events = feed('opencode', [{ type: 'error', error: { detail: 'plain detail message' } }]);
    expect(events[0]).toMatchObject({ message: 'plain detail message' });
  });

  it('falls back to a plain string error field when there is no detail/message', () => {
    const events = feed('opencode', [{ type: 'error', error: { error: 'plain nested error string' } }]);
    expect(events[0]).toMatchObject({ message: 'plain nested error string' });
  });
});

describe('isRecoverableCodexReconnect edge case', () => {
  it('treats a "Reconnecting..." message with neither known substring as a fatal (non-recoverable) error', () => {
    const events = feed('codex', [
      { type: 'error', message: 'Reconnecting... for an unlisted reason' },
    ]);
    expect(events[0]?.type).toBe('error');
  });
});

describe('normalizeTodoStatus / todoWriteInputFromItems (via codex todo_list items)', () => {
  it('normalizes a wide variety of status spellings, prefixes, and a missing/unrecognized status', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'todo_many',
          type: 'todo_list',
          items: [
            { content: 'a', status: 'complete' },
            { content: 'b', status: 'done' },
            { content: 'c', status: 'COMPLETED LATER' },
            { content: 'd', status: 'doing' },
            { content: 'e', status: 'active' },
            { content: 'f', status: 'IN-PROGRESS-ish' },
            { content: 'g', status: 'failed' },
            { content: 'h', status: 'blocked' },
            { content: 'i', status: 'canceled' },
            { content: 'j', status: 'cancelled' },
            { content: 'k', status: 'STOPPED further detail' },
            { content: 'l', status: 'failed-detail' },
            { content: 'm', status: 'blocked detail' },
            { content: 'n', status: 'canceled-detail' },
            { content: 'o', status: 'cancelled detail' },
            { content: 'p', status: 'some unrecognized status' },
            { content: 'q' }, // no status field at all
          ],
        },
      },
    ]);
    const todos = (events[0]!.input as { todos: { status: string }[] }).todos;
    const statuses = todos.map((t) => t.status);
    expect(statuses).toEqual([
      'completed', 'completed', 'completed',
      'in_progress', 'in_progress', 'in_progress',
      'stopped', 'stopped', 'stopped', 'stopped',
      'stopped', 'stopped', 'stopped', 'stopped', 'stopped',
      'pending', 'pending',
    ]);
  });

  it('marks a todo completed via the `completed: true` shorthand regardless of its status field', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'todo_shorthand',
          type: 'todo_list',
          items: [{ content: 'x', completed: true, status: 'in_progress' }],
        },
      },
    ]);
    const todos = (events[0]!.input as { todos: { status: string }[] }).todos;
    expect(todos[0]?.status).toBe('completed');
  });

  it('falls back through label, description, and text for a todo item content field', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'todo_fallback',
          type: 'todo_list',
          items: [
            { label: 'from label', status: 'pending' },
            { description: 'from description', status: 'pending' },
            { text: 'from text', status: 'pending' },
          ],
        },
      },
    ]);
    const todos = (events[0]!.input as { todos: { content: string }[] }).todos;
    expect(todos.map((t) => t.content)).toEqual(['from label', 'from description', 'from text']);
  });

  it('falls through to raw when every todo item lacks any usable content field', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: { id: 'todo_empty', type: 'todo_list', items: [{ status: 'pending' }, {}] },
      },
    ]);
    expect(events).toEqual([
      { type: 'raw', line: JSON.stringify({ type: 'item.completed', item: { id: 'todo_empty', type: 'todo_list', items: [{ status: 'pending' }, {}] } }) },
    ]);
  });
});

describe('todoWriteInputFromParsedValue (via gemini write_todos)', () => {
  it('accepts a top-level array of todos directly, without a wrapping object', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_arr',
        tool_name: 'write_todos',
        parameters: [{ content: 'bare array item', status: 'pending' }],
      },
    ]);
    expect(events).toEqual([
      {
        type: 'tool_use',
        id: 'tool_arr:todo-native',
        name: 'TodoWrite',
        input: { todos: [{ content: 'bare array item', status: 'pending' }] },
      },
    ]);
  });

  it('accepts the singular `todo` key as an alternate to `todos`', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_singular',
        tool_name: 'write_todos',
        parameters: { todo: [{ content: 'singular key item', status: 'pending' }] },
      },
    ]);
    expect(events).toEqual([
      {
        type: 'tool_use',
        id: 'tool_singular:todo-native',
        name: 'TodoWrite',
        input: { todos: [{ content: 'singular key item', status: 'pending' }] },
      },
    ]);
  });

  it('falls back to a plain tool_use when the parsed parameters are neither an array nor a record', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_string_params',
        tool_name: 'write_todos',
        parameters: 'just a plain non-JSON string',
      },
    ]);
    expect(events).toEqual([
      { type: 'tool_use', id: 'tool_string_params', name: 'write_todos', input: 'just a plain non-JSON string' },
    ]);
  });
});

describe('isFileWriteToolUse fallback path (via gemini tool_use)', () => {
  it('still suppresses artifact echo text for a write tool whose path has no recognized extension but a string content field', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_noext',
        tool_name: 'write_file',
        parameters: { file_path: 'no-extension-here', content: 'hello world' },
      },
      { type: 'message', role: 'assistant', content: '<artifact>echoed</artifact>' },
    ]);
    expect(events.some((e) => e.type === 'text_delta')).toBe(false);
  });

  it('does not suppress artifact echo text for a write tool with neither a recognized extension nor string content/new_string', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_nomatch',
        tool_name: 'write_file',
        parameters: { file_path: 'no-extension-here', content: 42 },
      },
      { type: 'message', role: 'assistant', content: '<artifact>not suppressed</artifact>' },
    ]);
    const textDelta = events.find((e) => e.type === 'text_delta')!;
    expect(textDelta.delta).toBe('<artifact>not suppressed</artifact>');
  });
});

describe('remaining narrow branch closures across handlers', () => {
  it('safeParseJson falls through to null for a non-string, non-object, non-null parameters value', () => {
    // gemini tool_use `parameters` as a bare number: safeParseJson(42) hits its
    // `typeof value !== 'string'` true branch and returns null, then the `??`
    // chain falls back to the raw numeric parameters value.
    const events = feed('legacy-google-stream-json', [
      { type: 'tool_use', tool_id: 'tool_num', tool_name: 'inspect', parameters: 42 },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'tool_num', name: 'inspect', input: 42 }]);
  });

  it('stringifyContent returns empty string for a null/undefined tool_result output with no error', () => {
    const events = feed('legacy-google-stream-json', [{ type: 'tool_result', tool_id: 'tool_nothing' }]);
    expect(events).toEqual([{ type: 'tool_result', toolUseId: 'tool_nothing', content: '', isError: false }]);
  });

  it('omits the "for connector X" suffix when connectorId is present but an empty string', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: {
          id: 'cmd_emptyconn',
          type: 'command_execution',
          command: 'x',
          aggregated_output: JSON.stringify({
            error: { code: 'CONNECTOR_TOOL_NOT_FOUND', details: { connectorId: '', toolName: 'search' } },
          }),
          exit_code: 1,
        },
      },
    ]);
    const error = events.find((e) => e.type === 'error')!;
    expect(error.message).not.toContain('for connector');
  });

  it('returns the fallback when value.error is a record but its error/error-string fields are all falsy', () => {
    const events = feed('opencode', [{ type: 'error', error: { error: '' } }]);
    expect(events[0]).toEqual({ type: 'error', message: 'OpenCode error', raw: JSON.stringify({ type: 'error', error: { error: '' } }) });
  });

  it('swallows step_finish when tokens is an empty (but valid) record producing no usable usage fields', () => {
    const events = feed('opencode', [{ type: 'step_finish', part: { tokens: {} } }]);
    expect(events).toEqual([]);
  });

  it('treats a non-record top-level JSON value as unhandled for opencode and falls back to raw', () => {
    const events = feed('opencode', [[] as unknown]);
    expect(events).toEqual([{ type: 'raw', line: '[]' }]);
  });

  it('falls back to the raw state.input value when safeParseJson cannot parse it (opencode tool_use, numeric input)', () => {
    const events = feed('opencode', [
      { type: 'tool_use', sessionID: 'ses_num', part: { tool: 'calc', callID: 'call_num', state: { input: 42 } } },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'call_num', name: 'calc', input: 42 }]);
  });

  it('omits durationMs on a gemini usage result when stats has no duration_ms', () => {
    const events = feed('legacy-google-stream-json', [
      { type: 'result', status: 'ok', stats: { input_tokens: 1 } },
    ]);
    expect(events[0]).toEqual({ type: 'usage', usage: { input_tokens: 1 }, durationMs: undefined });
  });

  it('treats a non-record top-level JSON value as unhandled for kimi and falls back to raw', () => {
    const events = feed('kimi', [[] as unknown]);
    expect(events).toEqual([{ type: 'raw', line: '[]' }]);
  });

  it('skips a non-record entry in a tool_calls array', () => {
    const events = feed('kimi', [
      {
        role: 'assistant',
        tool_calls: ['not an object', { id: 'call_ok', function: { name: 'bash', arguments: 'ls' } }],
      },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'call_ok', name: 'bash', input: 'ls' }]);
  });

  it('falls back to the raw arguments value when safeParseJson cannot parse a numeric tool_calls argument', () => {
    const events = feed('kimi', [
      { role: 'assistant', tool_calls: [{ id: 'call_num', function: { name: 'compute', arguments: 7 } }] },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'call_num', name: 'compute', input: 7 }]);
  });

  it('extractCursorText returns empty text for a truthy non-record message, and for a non-array message.content', () => {
    const nonRecordMessage = feed('cursor-agent', [{ type: 'assistant', message: 'just a string, not an object' }]);
    expect(nonRecordMessage).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'assistant', message: 'just a string, not an object' }) }]);

    const nonArrayContent = feed('cursor-agent', [
      { type: 'assistant', timestamp_ms: 1, message: { content: 'plain string, not an array' } },
    ]);
    expect(nonArrayContent).toEqual([
      { type: 'raw', line: JSON.stringify({ type: 'assistant', timestamp_ms: 1, message: { content: 'plain string, not an array' } }) },
    ]);
  });

  it('skips a non-record entry in a todo_list items array', () => {
    const events = feed('codex', [
      {
        type: 'item.completed',
        item: { id: 'todo_mixed', type: 'todo_list', items: ['not an object', { content: 'valid one', status: 'pending' }] },
      },
    ]);
    expect(events).toEqual([
      { type: 'tool_use', id: 'todo_mixed', name: 'TodoWrite', input: { todos: [{ content: 'valid one', status: 'pending' }] } },
    ]);
  });

  it('withholds artifact text across a chunk boundary that falls between the open tag and the close tag', () => {
    const events = feed('legacy-google-stream-json', [
      {
        type: 'tool_use',
        tool_id: 'tool_split_close',
        tool_name: 'write_file',
        parameters: { file_path: 'index.html', content: '<html></html>' },
      },
      // Open AND close both absent from this first chunk after the tag opens.
      { type: 'message', role: 'assistant', content: '<artifact>no close tag in this chunk' },
      { type: 'message', role: 'assistant', content: ' still no close' },
      { type: 'message', role: 'assistant', content: ' now it closes</artifact> and trails off' },
    ]);
    const deltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta);
    expect(deltas).toEqual([' and trails off']);
  });

  it('treats a non-record top-level JSON value as unhandled for cursor-agent and falls back to raw', () => {
    const events = feed('cursor-agent', [[] as unknown]);
    expect(events).toEqual([{ type: 'raw', line: '[]' }]);
  });

  it('omits the model field on a cursor system/init event with no model', () => {
    const events = feed('cursor-agent', [{ type: 'system', subtype: 'init' }]);
    expect(events).toEqual([{ type: 'status', label: 'initializing', model: undefined }]);
  });

  it('omits durationMs on a cursor usage result when there is no duration_ms', () => {
    const events = feed('cursor-agent', [{ type: 'result', usage: { inputTokens: 1 } }]);
    expect(events[0]).toEqual({ type: 'usage', usage: { input_tokens: 1 }, durationMs: undefined });
  });

  it('treats a non-record top-level JSON value as unhandled for codex and falls back to raw', () => {
    const events = feed('codex', [[] as unknown]);
    expect(events).toEqual([{ type: 'raw', line: '[]' }]);
  });

  it('reads a plain "error" field (not "message") for a codex error frame', () => {
    const events = feed('codex', [{ type: 'error', error: 'invalid token via the error field' }]);
    expect(events[0]).toEqual({ type: 'error', message: 'invalid token via the error field' });
  });

  it('reads a plain "message" field (not "error") for the first codex turn.failed frame in a fresh stream', () => {
    const events = feed('codex', [
      { type: 'turn.failed', message: 'first and only turn failure without an error field' },
    ]);
    expect(events[0]).toEqual({ type: 'error', message: 'first and only turn failure without an error field' });
  });

  it('defaults the Bash command to an empty string when item.started/command_execution has no command field', () => {
    const events = feed('codex', [
      { type: 'item.started', item: { id: 'cmd_nocmd', type: 'command_execution' } },
    ]);
    expect(events).toEqual([{ type: 'tool_use', id: 'cmd_nocmd', name: 'Bash', input: { command: '' } }]);
  });

  it('defaults the Bash command and aggregated_output fallback when item.completed/command_execution has neither field', () => {
    const events = feed('codex', [
      { type: 'item.completed', item: { id: 'cmd_bare', type: 'command_execution', exit_code: 0 } },
    ]);
    expect(events).toEqual([
      { type: 'tool_use', id: 'cmd_bare', name: 'Bash', input: { command: '' } },
      { type: 'tool_result', toolUseId: 'cmd_bare', content: '', isError: false },
    ]);
  });
});

it('Codex native collaboration is reported once, and external MCP named Bash stays distinguishable from the shell', () => {
  const item = { id: 'agent-1', type: 'collab_tool_call', tool: 'spawn_agent', prompt: 'private delegation' };
  const events = feed('codex', [{ type: 'item.started', item }, { type: 'item.completed', item },
    { type: 'item.completed', item: { id: 'mcp-1', type: 'mcp_tool_call', server: 'chrome', tool: 'Bash', arguments: {}, status: 'completed' } }]);
  expect(events.filter(event => event.type === 'tool_use')).toEqual([
    { type: 'tool_use', id: 'agent-1', name: 'spawn_agent', input: {} },
    { type: 'tool_use', id: 'mcp-1', name: 'mcp__chrome__Bash', input: {} },
  ]);
  expect(JSON.stringify(events)).not.toContain('private delegation');
});
describe('pinned behaviour before the complexity refactor', () => {
  it('emits model receipts from message.updated assistant info, with and without a provider prefix', () => {
    const events = feed('opencode', [
      { type: 'message.updated', properties: { info: { role: 'assistant', modelID: 'm1', providerID: 'p1' } } },
      { type: 'message.updated', properties: { info: { role: 'assistant', modelID: 'm2' } } },
      { type: 'message.updated', properties: { info: { role: 'user', modelID: 'm3' } } },
      { type: 'message.updated', properties: { info: { role: 'assistant', modelID: 4 } } },
      { type: 'other', properties: { info: { role: 'assistant', modelID: 'm5' } } },
      { type: 'message.updated' },
    ]);
    expect(events.filter(event => event.label === 'model')).toEqual([
      { type: 'status', label: 'model', model: 'p1/m1' },
      { type: 'status', label: 'model', model: 'm2' },
    ]);
  });

  it('emits a frame.model receipt only for the session/thread/turn/model-change frame types', () => {
    const events = feed('codex', [
      { type: 'thread.started', thread_id: 't1', model: 'gpt-x' },
      { type: 'model.changed', model: 'gpt-y' },
      { type: 'session.created', model: 'gpt-z' },
      { type: 'item.started', model: 'not-a-receipt' },
      { type: 'model.changed', model: 7 },
    ]);
    expect(events.filter(event => event.label === 'model').map(event => event.model)).toEqual(['gpt-x', 'gpt-y', 'gpt-z']);
    expect(events[1]).toEqual({ type: 'status', label: 'initializing', sessionId: 't1' });
  });

  it('falls back to String(value) when stringifying a tool payload throws', async () => {
    const { vi } = await import('vitest');
    const events: Record<string, unknown>[] = [];
    const handler = createJsonEventStreamHandler({ kind: 'opencode', onEvent: event => events.push(event) });
    const spy = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => { throw new Error('boom'); });
    handler.feed({ chunk: '{"type":"error","message":"bad"}\n' });
    spy.mockRestore();
    expect(events).toEqual([{ type: 'error', message: 'bad', raw: '[object Object]' }]);
  });

  it('names codex MCP tool uses for jini, external and nameless servers', () => {
    const events = feed('codex', [
      { type: 'item.started', item: { id: 'a', type: 'mcp_tool_call', server: 'jini', tool: '' } },
      { type: 'item.started', item: { id: 'b', type: 'mcp_tool_call', server: 'jini', tool: 'search_tools', arguments: { q: 1 } } },
      { type: 'item.started', item: { id: 'c', type: 'mcp_tool_call', tool: 'x' } },
      { type: 'item.started', item: { id: 'd', type: 'mcp_tool_call', server: 'chrome' } },
      { type: 'item.started', item: { id: 'd', type: 'mcp_tool_call', server: 'chrome' } },
    ]);
    expect(events).toEqual([
      { type: 'tool_use', id: 'a', name: 'mcp_tool_call', input: {} },
      { type: 'tool_use', id: 'b', name: 'search_tools', input: { q: 1 } },
      { type: 'tool_use', id: 'c', name: 'mcp__external__x', input: {} },
      { type: 'tool_use', id: 'd', name: 'mcp__chrome__call', input: {} },
    ]);
  });

  it('treats an id-less codex mcp_tool_call as raw but still resets the agent-message boundary on item.started', () => {
    const message = (text: string) => ({ type: 'item.completed', item: { type: 'agent_message', text } });
    const noId = { type: 'item.started', item: { type: 'mcp_tool_call', server: 'jini' } };
    const events = feed('codex', [message('one'), noId, message('two'),
      { type: 'item.completed', item: { type: 'mcp_tool_call', status: 'completed' } }, message('three')]);
    expect(events).toEqual([
      { type: 'text_delta', delta: 'one' },
      { type: 'raw', line: JSON.stringify(noId) },
      { type: 'text_delta', delta: 'two' },
      { type: 'raw', line: JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', status: 'completed' } }) },
      { type: 'text_delta', delta: '\nthree' },
    ]);
  });

  it('falls back to raw for codex item frames it does not recognise', () => {
    const frames = [
      { type: 'item.started', item: { id: 'r', type: 'reasoning' } },
      { type: 'item.started', item: 'not-a-record' },
      { type: 'item.updated', item: { id: 'r', type: 'reasoning' } },
      { type: 'item.updated', item: { type: 'todo_list', items: [{ text: 'x' }] } },
      { type: 'item.completed', item: { type: 'file_change' } },
      { type: 'item.completed', item: { id: 't', type: 'todo_list', items: [] } },
      { type: 'item.completed', item: { type: 'agent_message', text: '' } },
      { type: 'item.completed', item: { type: 'collab_tool_call' } },
      { type: 'turn.completed' },
      { type: 'something.else' },
      { type: 7 },
    ];
    expect(feed('codex', frames)).toEqual(frames.map(frame => ({ type: 'raw', line: JSON.stringify(frame) })));
  });

  it('defaults a nameless collab tool, reports its failure once, and lists no paths for change-less patches', () => {
    const collab = { id: 'c1', type: 'collab_tool_call', status: 'failed' };
    const events = feed('codex', [
      { type: 'item.updated', item: collab },
      { type: 'item.completed', item: collab },
      { type: 'item.completed', item: collab },
      { type: 'item.completed', item: { id: 'p1', type: 'file_change', changes: 'nope', status: 'failed' } },
      { type: 'item.completed', item: { id: 'p2', type: 'file_change', changes: [{ path: 1 }, 'x', { path: 'ok' }] } },
    ]);
    expect(events).toEqual([
      { type: 'tool_use', id: 'c1', name: 'collab_tool_call', input: {} },
      { type: 'tool_result', toolUseId: 'c1', content: 'Native agent action completed.', isError: true },
      { type: 'tool_use', id: 'p1', name: 'apply_patch', input: { paths: [] } },
      { type: 'tool_result', toolUseId: 'p1', content: 'File change reported by Codex.', isError: true },
      { type: 'tool_use', id: 'p2', name: 'apply_patch', input: { paths: ['ok'] } },
      { type: 'tool_result', toolUseId: 'p2', content: 'File change reported by Codex.', isError: false },
    ]);
  });

  it('suppresses a connector-tool error after an earlier codex error, and the reverse', () => {
    const connectorOutput = JSON.stringify({ error: { code: 'CONNECTOR_TOOL_NOT_FOUND', details: { toolName: 't' } } });
    const command = { type: 'item.completed', item: { id: 'k', type: 'command_execution', aggregated_output: connectorOutput, exit_code: 1 } };
    const first = feed('codex', [{ type: 'error', message: 'first' }, command]);
    expect(first.filter(event => event.type === 'error')).toEqual([{ type: 'error', message: 'first' }]);
    const second = feed('codex', [command, { type: 'turn.failed', error: { message: 'later' } }]);
    expect(second.filter(event => event.type === 'error')).toHaveLength(1);
    expect(second.at(-1)).toEqual({ type: 'error',
      message: 'Connector tool t is not allowed. Re-list the connector catalog and choose one of the currently allowed read-only tools.' });
  });

  it('maps todo statuses through every alias and prefix, and picks the first string-typed content field', () => {
    const statuses = ['Completed', 'complete', 'done', 'completed-yesterday', 'In Progress', 'doing', 'active', 'in-progress-now',
      'stopped', 'failed', 'blocked', 'canceled', 'cancelled', 'failed_hard', 'blocked by x', 'completely', 'todo', 7];
    const items = statuses.map((status, index) => ({ text: `t${index}`, status }));
    const events = feed('codex', [
      { type: 'item.started', item: { id: 'todo', type: 'todo_list', items } },
      { type: 'item.started', item: { id: 'todo2', type: 'todo_list', items: [
        { content: '', label: 'skipped because content is a string' }, { label: 7, description: 'd' }, { completed: true, text: 'x', status: 'failed' }] } },
    ]);
    expect((events[0]?.input as { todos: { status: string }[] }).todos.map(todo => todo.status)).toEqual([
      'completed', 'completed', 'completed', 'completed', 'in_progress', 'in_progress', 'in_progress', 'in_progress',
      'stopped', 'stopped', 'stopped', 'stopped', 'stopped', 'stopped', 'stopped', 'pending', 'pending', 'pending']);
    expect(events[1]?.input).toEqual({ todos: [{ content: 'd', status: 'pending' }, { content: 'x', status: 'completed' }] });
  });

  it('extracts error messages through detail, nested message, error, data and name, in that order', () => {
    const message = (error: unknown) => feed('opencode', [{ type: 'error', error }])[0]?.message;
    expect(message({ detail: 'd', message: 'm' })).toBe('d');
    expect(message({ detail: '', message: '{"detail":"inner"}' })).toBe('inner');
    expect(message({ message: '', error: 'e' })).toBe('e');
    expect(message({ error: ['array'] , name: 'n' })).toBe('OpenCode error');
    expect(message({ error: { name: 'nested-name' } })).toBe('nested-name');
    expect(message({ data: { message: 'from-data' }, name: 'n' })).toBe('from-data');
    expect(message({ data: ['x'], name: 'n' })).toBe('n');
    expect(message({ data: {}, name: '' })).toBe('OpenCode error');
    expect(message('[1,2]')).toBe('[1,2]');
    expect(message(42)).toBe('OpenCode error');
  });

  it('handles kimi tool calls with blank ids or names, trimmed values and string arguments', () => {
    const events = feed('kimi', [
      { role: 'assistant', tool_calls: [
        { id: ' a ', function: { name: ' read ', arguments: '{"p":1}' } },
        { id: '  ', function: { name: 'x' } },
        { id: 'b', function: { name: '' } },
        { id: 'c' },
        'junk',
        { id: 'd', function: { name: 'w', arguments: 'not json' } },
      ] },
      { role: 'assistant', tool_calls: 'nope', content: 'hello' },
      { role: 'assistant', content: '' },
      { role: 'tool', tool_call_id: '   ', content: 'x' },
      { role: 'tool', tool_call_id: ' t1 ', content: { ok: true } },
      { role: 'meta', type: 'session.resume_hint' },
      { role: 'meta', type: 'other' },
    ]);
    expect(events).toEqual([
      { type: 'tool_use', id: 'a', name: 'read', input: { p: 1 } },
      { type: 'tool_use', id: 'd', name: 'w', input: 'not json' },
      { type: 'text_delta', delta: 'hello' },
      { type: 'raw', line: JSON.stringify({ role: 'assistant', content: '' }) },
      { type: 'raw', line: JSON.stringify({ role: 'tool', tool_call_id: '   ', content: 'x' }) },
      { type: 'tool_result', toolUseId: 't1', content: '{"ok":true}', isError: false },
      { type: 'raw', line: JSON.stringify({ role: 'meta', type: 'other' }) },
    ]);
  });

  it('falls back to raw for opencode and gemini frames whose required fields are missing', () => {
    const openCodeFrames = [
      { type: 'text', part: { text: '' } },
      { type: 'tool_use', part: { tool: 'x' } },
      { type: 'unknown' },
    ];
    expect(feed('opencode', openCodeFrames)).toEqual(openCodeFrames.map(frame => ({ type: 'raw', line: JSON.stringify(frame) })));
    const geminiFrames = [
      { type: 'message', role: 'assistant', content: '' },
      { type: 'tool_use', tool_id: 'x' },
      { type: 'tool_result' },
      { type: 'unknown' },
    ];
    expect(feed('legacy-google-stream-json', geminiFrames)).toEqual(geminiFrames.map(frame => ({ type: 'raw', line: JSON.stringify(frame) })));
  });
});
