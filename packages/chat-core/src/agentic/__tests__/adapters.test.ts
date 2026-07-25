import { describe, expect, it, vi } from 'vitest';

import {
  AG_UI_TOOL_CALL_EVENTS,
  CHAT_CAPABILITIES,
  JINI_PAGE_ACTION_METHOD,
  JSON_RPC_ERROR_CODES,
  MCP_UI_HOST_NOTIFICATIONS,
  MCP_UI_VIEW_METHODS,
  PAGE_CAPABILITIES,
  createAgUiToolResult,
  createJsonRpcError,
  createJsonRpcNotification,
  createJsonRpcRequest,
  createJsonRpcResult,
  createPageActionRequest,
  isJsonRpcMessage,
  isJsonRpcRequest,
  toAgUiTool,
  toAgUiTools,
  toWebMcpTool,
  toWebMcpTools,
} from '../index.js';

const ALL = [...CHAT_CAPABILITIES, ...PAGE_CAPABILITIES];
const HIGHLIGHT = PAGE_CAPABILITIES.find((c) => c.id === 'page.highlight')!;

describe('webmcp projection', () => {
  it('maps a capability onto the registerTool shape and dispatches by id', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const tool = toWebMcpTool(HIGHLIGHT, execute);

    expect(tool.name).toBe('page.highlight');
    expect(tool.description).toBe(HIGHLIGHT.description);
    // WebMCP names the schema field `inputSchema` — see ag-ui.test for the contrast.
    expect(tool.inputSchema).toBe(HIGHLIGHT.inputSchema);

    await tool.execute({ element: 'task-water-plants' });
    expect(execute).toHaveBeenCalledWith('page.highlight', { element: 'task-water-plants' });
  });

  it('substitutes an empty object when a caller passes nothing', async () => {
    const execute = vi.fn(async () => null);
    await toWebMcpTool(HIGHLIGHT, execute).execute(undefined as unknown as Record<string, unknown>);
    expect(execute).toHaveBeenCalledWith('page.highlight', {});
  });

  it('projects a whole manifest in order', () => {
    const tools = toWebMcpTools(ALL, async () => null);
    expect(tools.map((t) => t.name)).toEqual(ALL.map((c) => c.id));
  });
});

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

describe('mcp-ui envelope', () => {
  it('names the spec methods it borrows', () => {
    expect(MCP_UI_VIEW_METHODS.initialize).toBe('ui/initialize');
    expect(MCP_UI_VIEW_METHODS.callTool).toBe('tools/call');
    expect(MCP_UI_HOST_NOTIFICATIONS.initialized).toBe('ui/notifications/initialized');
    expect(MCP_UI_HOST_NOTIFICATIONS.teardown).toBe('ui/resource-teardown');
  });

  it('keeps the Jini page-action extension out of the spec namespace', () => {
    // A compliant host that does not know this method must reject it as unknown, not confuse it
    // for a spec method.
    expect(JINI_PAGE_ACTION_METHOD).toBe('x-jini/page-action');
    expect(JINI_PAGE_ACTION_METHOD.startsWith('ui/')).toBe(false);
    const specMethods = [...Object.values(MCP_UI_VIEW_METHODS), ...Object.values(MCP_UI_HOST_NOTIFICATIONS)];
    expect(specMethods).not.toContain(JINI_PAGE_ACTION_METHOD);
  });

  it('builds requests, notifications, results and errors', () => {
    expect(createJsonRpcRequest(1, 'ping')).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(createJsonRpcRequest(1, 'ping', { a: 1 }).params).toEqual({ a: 1 });
    expect(createJsonRpcNotification('ui/notifications/initialized')).toEqual({
      jsonrpc: '2.0',
      method: 'ui/notifications/initialized',
    });
    expect(createJsonRpcResult(2, { ok: true })).toEqual({ jsonrpc: '2.0', id: 2, result: { ok: true } });
    expect(createJsonRpcError(3, JSON_RPC_ERROR_CODES.methodNotFound, 'nope')).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32601, message: 'nope' },
    });
  });

  it('omits optional fields rather than sending them undefined', () => {
    expect(createJsonRpcRequest(1, 'ping')).not.toHaveProperty('params');
    expect(createJsonRpcError(1, -1, 'x').error).not.toHaveProperty('data');
  });

  it('builds a namespaced page-action request carrying capability and input', () => {
    expect(createPageActionRequest('inv-1', 'page.click', { element: 'add-task-button' })).toEqual({
      jsonrpc: '2.0',
      id: 'inv-1',
      method: JINI_PAGE_ACTION_METHOD,
      params: { capabilityId: 'page.click', input: { element: 'add-task-button' } },
    });
  });

  describe('isJsonRpcMessage', () => {
    it('accepts requests, notifications and both response shapes', () => {
      expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe(true);
      expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 'note' })).toBe(true);
      expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: null })).toBe(true);
      expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 'a', error: { code: 1, message: 'x' } })).toBe(true);
    });

    it('rejects anything a hostile page could post at the frame', () => {
      // Any page able to reach the frame can post arbitrary data; shape is never assumable.
      for (const hostile of [
        null,
        undefined,
        'ping',
        42,
        [],
        {},
        { jsonrpc: '1.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0' },
        { jsonrpc: '2.0', id: 1 },
        { jsonrpc: '2.0', id: { nested: true }, result: 1 },
        { method: 'ping', id: 1 },
      ]) {
        expect(isJsonRpcMessage(hostile)).toBe(false);
      }
    });

    it('distinguishes a request from a notification', () => {
      expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe(true);
      expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'ping' })).toBe(false);
      expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, result: 1 })).toBe(false);
    });
  });
});
