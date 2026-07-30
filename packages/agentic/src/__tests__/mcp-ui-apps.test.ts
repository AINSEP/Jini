import { describe, expect, it } from 'vitest';

import {
  JINI_PAGE_ACTION_METHOD,
  JSON_RPC_ERROR_CODES,
  MCP_UI_HOST_NOTIFICATIONS,
  MCP_UI_HOST_REQUESTS,
  MCP_UI_VIEW_METHODS,
  MCP_UI_VIEW_NOTIFICATIONS,
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
    expect(MCP_UI_VIEW_NOTIFICATIONS.initialized).toBe('ui/notifications/initialized');
    expect(MCP_UI_HOST_REQUESTS.teardown).toBe('ui/resource-teardown');
  });

  it('keeps the Jini page-action extension out of the spec namespace', () => {
    // A compliant host that does not know this method must reject it as unknown, not confuse it
    // for a spec method.
    expect(JINI_PAGE_ACTION_METHOD).toBe('x-jini/page-action');
    expect(JINI_PAGE_ACTION_METHOD.startsWith('ui/')).toBe(false);
    const specMethods = [
      ...Object.values(MCP_UI_VIEW_METHODS),
      ...Object.values(MCP_UI_HOST_NOTIFICATIONS),
      ...Object.values(MCP_UI_VIEW_NOTIFICATIONS),
      ...Object.values(MCP_UI_HOST_REQUESTS),
    ];
    expect(specMethods).not.toContain(JINI_PAGE_ACTION_METHOD);
  });

  // Regression coverage for the 2026-07-28 audit against the primary spec source
  // (github.com/modelcontextprotocol/ext-apps, specification/2026-01-26/apps.mdx [Stable] and
  // specification/draft/apps.mdx). The bucket these constants lived in had the wrong direction
  // for two lifecycle messages and mis-typed a third as fire-and-forget. Each assertion below
  // pins the corrected shape so a future refactor cannot silently reintroduce the same bug.
  describe('message-direction classification (the bug this file used to have)', () => {
    it('classifies `initialized` and `size-changed` as View→Host, not Host→View', () => {
      // The spec's sequence diagram is unambiguous: `UI ->> H: ui/notifications/initialized`.
      // These do NOT belong in MCP_UI_HOST_NOTIFICATIONS (the Host→View fire-and-forget bucket).
      expect(MCP_UI_VIEW_NOTIFICATIONS.initialized).toBe('ui/notifications/initialized');
      expect(MCP_UI_VIEW_NOTIFICATIONS.sizeChanged).toBe('ui/notifications/size-changed');
      expect(Object.values(MCP_UI_HOST_NOTIFICATIONS)).not.toContain('ui/notifications/initialized');
      expect(Object.values(MCP_UI_HOST_NOTIFICATIONS)).not.toContain('ui/notifications/size-changed');
    });

    it('classifies `resource-teardown` as a Host→View REQUEST, not a fire-and-forget notification', () => {
      // The spec's own wire example gives this message an `id` and a success/error response
      // shape, and the prose says the Host "SHOULD wait for a response ... to prevent data
      // loss." A notification bucket has no `id` field and no response contract — building one
      // with createJsonRpcNotification would silently produce an unanswerable message.
      expect(MCP_UI_HOST_REQUESTS.teardown).toBe('ui/resource-teardown');
      expect(Object.values(MCP_UI_HOST_NOTIFICATIONS)).not.toContain('ui/resource-teardown');
    });

    it('keeps MCP_UI_HOST_NOTIFICATIONS to exactly the Host→View fire-and-forget surface', () => {
      // Enumerate exhaustively rather than probing individual keys, so an accidental future
      // addition to this bucket (e.g. re-adding `initialized`) fails a test even if no one
      // thinks to write a dedicated assertion for it.
      expect(MCP_UI_HOST_NOTIFICATIONS).toEqual({
        toolInputPartial: 'ui/notifications/tool-input-partial',
        toolInput: 'ui/notifications/tool-input',
        toolResult: 'ui/notifications/tool-result',
        toolCancelled: 'ui/notifications/tool-cancelled',
        hostContextChanged: 'ui/notifications/host-context-changed',
      });
    });

    it('keeps MCP_UI_VIEW_NOTIFICATIONS to exactly the View→Host fire-and-forget surface', () => {
      expect(MCP_UI_VIEW_NOTIFICATIONS).toEqual({
        initialized: 'ui/notifications/initialized',
        sizeChanged: 'ui/notifications/size-changed',
        requestTeardown: 'ui/notifications/request-teardown',
      });
    });

    it('keeps MCP_UI_HOST_REQUESTS to exactly the Host-initiated request surface', () => {
      expect(MCP_UI_HOST_REQUESTS).toEqual({
        teardown: 'ui/resource-teardown',
        callAppTool: 'tools/call',
        listAppTools: 'tools/list',
      });
    });

    it('adds the draft spec\'s new View→Host requests without disturbing the existing ones', () => {
      expect(MCP_UI_VIEW_METHODS.downloadFile).toBe('ui/download-file');
      expect(MCP_UI_VIEW_METHODS.createMessage).toBe('sampling/createMessage');
      // The pre-existing methods must survive the addition untouched.
      expect(MCP_UI_VIEW_METHODS.initialize).toBe('ui/initialize');
      expect(MCP_UI_VIEW_METHODS.readResource).toBe('resources/read');
      expect(MCP_UI_VIEW_METHODS.log).toBe('notifications/message');
      expect(MCP_UI_VIEW_METHODS.openLink).toBe('ui/open-link');
      expect(MCP_UI_VIEW_METHODS.sendMessage).toBe('ui/message');
      expect(MCP_UI_VIEW_METHODS.requestDisplayMode).toBe('ui/request-display-mode');
      expect(MCP_UI_VIEW_METHODS.updateModelContext).toBe('ui/update-model-context');
      expect(MCP_UI_VIEW_METHODS.ping).toBe('ping');
    });

    it('never lets the same method string mean two different directions inside one bucket pair', () => {
      // `tools/call` is deliberately bidirectional in the real spec (App→Host to call a server
      // tool via MCP_UI_VIEW_METHODS.callTool, Host→App to call an app-registered tool via
      // MCP_UI_HOST_REQUESTS.callAppTool) — that duplication is intentional. `tools/list` is
      // modeled ONLY in the Host→App direction here (MCP_UI_HOST_REQUESTS.listAppTools); this
      // module does not add a View→Host "list server tools" method, so it must stay single-owner.
      // Every method string other than `tools/call` must appear in at most one bucket, so a
      // future addition cannot silently claim a direction that conflicts with an existing one.
      const buckets: Record<string, readonly string[]> = {
        MCP_UI_VIEW_METHODS: Object.values(MCP_UI_VIEW_METHODS),
        MCP_UI_HOST_NOTIFICATIONS: Object.values(MCP_UI_HOST_NOTIFICATIONS),
        MCP_UI_VIEW_NOTIFICATIONS: Object.values(MCP_UI_VIEW_NOTIFICATIONS),
        MCP_UI_HOST_REQUESTS: Object.values(MCP_UI_HOST_REQUESTS),
      };
      const seenIn = new Map<string, string[]>();
      for (const [bucketName, methods] of Object.entries(buckets)) {
        for (const method of methods) {
          const owners = seenIn.get(method) ?? [];
          owners.push(bucketName);
          seenIn.set(method, owners);
        }
      }
      const deliberatelyBidirectional = new Set(['tools/call']);
      for (const [method, owners] of seenIn) {
        if (deliberatelyBidirectional.has(method)) {
          expect(owners.sort()).toEqual(['MCP_UI_HOST_REQUESTS', 'MCP_UI_VIEW_METHODS']);
        } else {
          expect(owners).toHaveLength(1);
        }
      }
    });
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

    // Found by live adversarial testing (2026-07-28) against a real sandboxed iframe, not by
    // static review: a REQUEST (has a string `method`) whose `id` is present but malformed used
    // to pass this check, because the `method`-is-a-string branch returned early without ever
    // looking at `id`'s type. See the fix's doc comment in mcp-ui-apps.ts for the exact wire
    // message that exposed it (`{ jsonrpc: '2.0', id: { nested: true }, method: 'tools/call' }`).
    it('rejects a request whose method is valid but whose id is malformed', () => {
      expect(isJsonRpcMessage({ jsonrpc: '2.0', id: { nested: true }, method: 'tools/call', params: {} })).toBe(false);
      expect(isJsonRpcMessage({ jsonrpc: '2.0', id: [1, 2], method: 'ui/initialize' })).toBe(false);
      expect(isJsonRpcMessage({ jsonrpc: '2.0', id: null, method: 'ui/initialize' })).toBe(false);
      expect(isJsonRpcMessage({ jsonrpc: '2.0', id: true, method: 'ui/initialize' })).toBe(false);
    });

    it('still accepts a notification (a valid method, deliberately no id at all)', () => {
      // The fix above must not turn "no id" into "invalid id" — a notification never has one.
      expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })).toBe(true);
      expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 1, height: 1 } })).toBe(true);
    });

    it('still accepts a request whose id is a valid string or number', () => {
      expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 'view-1', method: 'ui/initialize' })).toBe(true);
      expect(isJsonRpcMessage({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: {} })).toBe(true);
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
