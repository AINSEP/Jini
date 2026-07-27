import { describe, expect, it } from 'vitest';

import {
  JINI_PAGE_ACTION_METHOD,
  JSON_RPC_ERROR_CODES,
  MCP_UI_HOST_NOTIFICATIONS,
  MCP_UI_VIEW_METHODS,
  createJsonRpcError,
  createJsonRpcNotification,
  createJsonRpcRequest,
  createJsonRpcResult,
  createPageActionRequest,
  isJsonRpcMessage,
  isJsonRpcRequest,
} from '../index.js';

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

describe('mcp-ui envelope — optional field branches', () => {
  it('includes params on a notification when supplied', () => {
    expect(createJsonRpcNotification('ui/notifications/size-changed', { width: 320, height: 200 }))
      .toEqual({
        jsonrpc: '2.0',
        method: 'ui/notifications/size-changed',
        params: { width: 320, height: 200 },
      });
  });

  it('includes error data when supplied', () => {
    expect(createJsonRpcError(7, JSON_RPC_ERROR_CODES.invalidParams, 'bad', { field: 'element' }))
      .toEqual({
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32602, message: 'bad', data: { field: 'element' } },
      });
  });
});
