import { describe, expect, it } from 'vitest';

import {
  AG_UI_TOOL_CALL_EVENTS,
  PAGE_CAPABILITIES,
  createAgUiToolResult,
  toAgUiTool,
  toAgUiTools,
} from '../index.js';

// PAGE_CAPABILITIES alone already has multiple entries, which is all "projects a whole manifest
// in order" below needs — this package ships no product-specific manifest of its own to combine
// it with (chat-core's CHAT_CAPABILITIES stays in chat-core; see source-map.md's "What moves").
const ALL = PAGE_CAPABILITIES;
const HIGHLIGHT = PAGE_CAPABILITIES.find((c) => c.id === 'page.highlight')!;

describe('ag-ui projection', () => {
  it('renames the schema field to `parameters`', () => {
    const tool = toAgUiTool(HIGHLIGHT);
    expect(tool.name).toBe('page.highlight');
    expect(tool.parameters).toBe(HIGHLIGHT.inputSchema);
    // The bug this guards: reading a manifest through the wrong field name sends a tool with
    // no arguments, and the failure is silent.
    expect(tool).not.toHaveProperty('inputSchema');
  });

  it('projects a whole manifest in order', () => {
    expect(toAgUiTools(ALL).map((t) => t.name)).toEqual(ALL.map((c) => c.id));
  });

  it('names the streaming tool-call events', () => {
    expect(AG_UI_TOOL_CALL_EVENTS).toEqual({
      start: 'TOOL_CALL_START',
      args: 'TOOL_CALL_ARGS',
      end: 'TOOL_CALL_END',
    });
  });

  it('encodes a successful result as a role:"tool" message referencing the call', () => {
    const message = createAgUiToolResult('m1', 'call-1', { ok: true, output: { found: 3 } });
    expect(message).toEqual({
      id: 'm1',
      role: 'tool',
      content: '{"found":3}',
      toolCallId: 'call-1',
    });
  });

  it('passes string output through without double-encoding it', () => {
    expect(createAgUiToolResult('m2', 'c2', { ok: true, output: 'done' }).content).toBe('done');
  });

  it('returns a refusal as a result rather than losing it', () => {
    // A guard saying no is information the agent must be able to reason about, not an
    // exception that disappears into a transport.
    const message = createAgUiToolResult('m3', 'c3', {
      ok: false,
      error: 'this field holds a credential or payment instrument',
    });
    expect(message.role).toBe('tool');
    expect(JSON.parse(message.content)).toEqual({
      error: 'this field holds a credential or payment instrument',
    });
  });

  it('encodes undefined output as null rather than dropping the field', () => {
    expect(createAgUiToolResult('m4', 'c4', { ok: true, output: undefined }).content).toBe('null');
  });
});
