import { describe, expect, it } from 'vitest';
import { createJsonEventStreamHandler } from '../json-event-stream.js';
import { antigravityAgentDef, redactAntigravityAuthUrls } from '../defs/antigravity.js';

/** Published agy step_update/tool_info wire shape, not Gemini CLI's legacy stream. */
function toolFrame(name: string, parameters: Record<string, unknown>, index = 4, state = 'DONE') {
  return { event: 'step_update', step_update: { conversation_id: 'conversation', step_index: index,
    state, step_type: 'tool', tool_name: name, tool_info: { name, parameters, output: 'finished' } } };
}

describe('Antigravity native audit', () => {
  it('redacts sign-in URLs without breaking the structured frame', () => {
    const frame = { event: 'result', result: { status: 'ERROR', error:
      'Sign in at https://accounts.google.com/o/oauth2/auth?client_id=private&redirect_uri=private' } };
    const safe = redactAntigravityAuthUrls({ fullText: JSON.stringify(frame) });
    expect(JSON.parse(safe).result.error).toBe('Sign in at [redacted sign-in URL]');
    expect(safe).not.toContain('private');
  });

  it('requests the structured stream that supplies real native tool receipts', () => {
    const args = antigravityAgentDef.buildArgs({ prompt: 'question', imagePaths: [] });
    expect(args.slice(0, 2)).toEqual(['--output-format', 'stream-json']);
    expect(antigravityAgentDef.streamFormat).toBe('json-event-stream');
    expect(antigravityAgentDef).toMatchObject({ eventParser: 'antigravity' });
    expect(args.slice(-2)).toEqual(['-p', 'question']);
  });

  it('audits a shell invocation once across ACTIVE, DONE and replayed DONE frames', () => {
    const events: Record<string, unknown>[] = [];
    const parser = createJsonEventStreamHandler({ kind: 'antigravity', onEvent: event => events.push(event) });
    const frames = [toolFrame('run_command', { CommandLine: 'echo hello' }, 4, 'ACTIVE'),
      toolFrame('run_command', { CommandLine: 'echo hello' }), toolFrame('run_command', { CommandLine: 'echo hello' })];
    const wire = frames.map(frame => JSON.stringify(frame)).join('\n');
    parser.feed({ chunk: wire.slice(0, 37) });
    parser.feed({ chunk: wire.slice(37) });
    parser.flush();
    expect(events).toEqual([
      { type: 'tool_use', id: 'conversation:4', name: 'Bash', input: { command: 'echo hello' } },
      { type: 'tool_result', toolUseId: 'conversation:4', content: 'finished', isError: false },
    ]);
  });

  it.each(['write_to_file', 'replace_file_content', 'multi_replace_file_content'])(
    'audits %s paths without retaining document contents', name => {
      const events: Record<string, unknown>[] = [];
      const parser = createJsonEventStreamHandler({ kind: 'antigravity', onEvent: event => events.push(event) });
      parser.feed({ chunk: JSON.stringify(toolFrame(name, { TargetFile: '/site/page.html', CodeContent: 'private document' })) });
      parser.flush();
      expect(events[0]).toEqual({ type: 'tool_use', id: 'conversation:4',
        name: name === 'write_to_file' ? 'Write' : 'Edit', input: { file_path: '/site/page.html' } });
      expect(JSON.stringify(events)).not.toContain('private document');
    });

  it('waits for real parameters when ACTIVE only announces a tool name', () => {
    const events: Record<string, unknown>[] = [];
    const parser = createJsonEventStreamHandler({ kind: 'antigravity', onEvent: event => events.push(event) });
    parser.feed({ chunk: JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'conversation',
      step_index: 4, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command' } }) + '\n' });
    expect(events).toEqual([]);
    parser.feed({ chunk: JSON.stringify(toolFrame('run_command', { CommandLine: 'echo actual' })) + '\n' });
    expect(events[0]).toEqual({ type: 'tool_use', id: 'conversation:4', name: 'Bash', input: { command: 'echo actual' } });
  });

  it('preserves native tool failures and a terminal-only response', () => {
    const events: Record<string, unknown>[] = [];
    const parser = createJsonEventStreamHandler({ kind: 'antigravity', onEvent: event => events.push(event) });
    const failed = toolFrame('run_command', { CommandLine: 'denied' });
    parser.feed({ chunk: JSON.stringify({ ...failed, step_update: { ...failed.step_update,
      tool_info: { ...failed.step_update.tool_info, error: { type: 'permission_denied', message: 'denied by policy' } } } }) + '\n' });
    parser.feed({ chunk: JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Done' } }) + '\n' });
    expect(events).toContainEqual({ type: 'tool_result', toolUseId: 'conversation:4', content: 'denied by policy', isError: true });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'Done' });
  });

  it('streams response deltas without repeating the terminal response, and preserves failure', () => {
    const events: Record<string, unknown>[] = [];
    const parser = createJsonEventStreamHandler({ kind: 'antigravity', onEvent: event => events.push(event) });
    for (const frame of [
      { event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'Hello' } },
      { event: 'result', result: { status: 'ERROR', response: 'Hello', error: 'quota exhausted' } },
    ]) parser.feed({ chunk: JSON.stringify(frame) + '\n' });
    expect(events.filter(event => event.type === 'text_delta')).toEqual([{ type: 'text_delta', delta: 'Hello' }]);
    expect(events).toContainEqual({ type: 'error', message: 'quota exhausted' });
  });
});
