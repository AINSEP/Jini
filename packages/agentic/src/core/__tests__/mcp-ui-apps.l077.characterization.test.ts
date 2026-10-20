import { describe, expect, it } from 'vitest';
import { isJsonRpcMessage } from '../mcp-ui-apps.js';

describe('L077 JSON-RPC shape separation', () => {
  it.each([
    [null, false], [[], false], ['message', false], [{}, false],
    [{ jsonrpc: '1.0', method: 'ping' }, false],
    [{ jsonrpc: '2.0', method: 'ping' }, true],
    [{ jsonrpc: '2.0', method: 'ping', id: 0 }, true],
    [{ jsonrpc: '2.0', method: 'ping', id: '' }, true],
    [{ jsonrpc: '2.0', method: 'ping', id: null }, false],
    [{ jsonrpc: '2.0', method: 'ping', id: {} }, false],
    [{ jsonrpc: '2.0', method: 'ping', id: undefined }, false],
    [{ jsonrpc: '2.0', method: 'ping', params: [] }, true],
    [{ jsonrpc: '2.0', method: 'ping', params: {} }, true],
    [{ jsonrpc: '2.0', method: 'ping', params: null }, false],
    [{ jsonrpc: '2.0', method: 'ping', params: 'bad' }, false],
    [{ jsonrpc: '2.0', method: 'ping', result: 0 }, false],
    [{ jsonrpc: '2.0', method: 'ping', error: {} }, false],
    [{ jsonrpc: '2.0', method: 0, id: 1, result: 0 }, false],
    [{ jsonrpc: '2.0', result: 0 }, false],
    [{ jsonrpc: '2.0', id: 1 }, false],
    [{ jsonrpc: '2.0', id: 1, result: undefined }, true],
    [{ jsonrpc: '2.0', id: 1, result: 0, error: { code: 1, message: 'bad' } }, false],
    [{ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'bad' } }, true],
    [{ jsonrpc: '2.0', id: 1, error: 'bad' }, false],
    [{ jsonrpc: '2.0', id: 1, error: [] }, false],
    [{ jsonrpc: '2.0', id: 1, error: { code: '1', message: 'bad' } }, false],
    [{ jsonrpc: '2.0', id: 1, error: { code: 1, message: 0 } }, false],
  ] satisfies [unknown, boolean][])('accepts %j: %s', (value, expected) => {
    expect(isJsonRpcMessage({ value })).toBe(expected);
  });

  it('accepts nonfinite numeric correlation ids (reported, not fixed)', () => {
    expect(isJsonRpcMessage({ value: { jsonrpc: '2.0', id: NaN, method: 'ping' } })).toBe(true);
    expect(isJsonRpcMessage({ value: { jsonrpc: '2.0', id: Infinity, result: null } })).toBe(true);
  });
});
