import { describe, expect, it } from 'vitest';
import {
  agentHandle, agentHandleProps, createGenUiEncoder, createJsonRpcRequest,
  findCapability, PAGE_CAPABILITIES, toWebMcpTool,
} from '../index.js';
import { createA2uiInterpreter, createLabCatalog, resolveDynamicValue } from '../a2ui/index.js';

describe('public argument-object contracts', () => {
  it('separates handle and RPC options while preserving attribute and wire data', () => {
    expect(agentHandle({ handle: 'save' }, { role: 'button', label: 'Save' })).toEqual({
      'data-agent-element': 'save', 'data-agent-role': 'button', 'data-agent-label': 'Save',
    });
    expect(agentHandleProps({}, { base: 'card', action: 'save' })).toEqual({ 'data-agent-element': 'card-save' });
    expect(agentHandleProps({}, {})).toEqual({});
    expect(createJsonRpcRequest({ id: 7, method: 'page.action' }, { params: { handle: 'save' } })).toEqual({
      jsonrpc: '2.0', id: 7, method: 'page.action', params: { handle: 'save' },
    });
    expect(createJsonRpcRequest({ id: 8, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 8, method: 'ping' });
  });

  it('forwards one required argument object to the WebMCP execution port', async () => {
    const capability = findCapability({ capabilities: PAGE_CAPABILITIES, id: 'page.click' })!;
    const calls: unknown[] = [];
    const tool = toWebMcpTool({ capability, execute: async required => { calls.push(required); return 'clicked'; } });
    expect(await tool.execute({ handle: 'save' })).toBe('clicked');
    expect(calls).toEqual([{ id: 'page.click', args: { handle: 'save' } }]);
    await expect(tool.execute({ handle: 7 })).rejects.toThrow('"handle" must be a string');
    expect(calls).toHaveLength(1);
  });

  it('keeps the item scope in optional arguments and resolves against the injected model', () => {
    const catalog = createLabCatalog({});
    const ctx = { catalog, dataModel: { rows: [{ title: 'first' }, { title: 'second' }] }, side: 'renderer' as const };
    expect(resolveDynamicValue({ value: { path: 'title' }, ctx }, { itemScope: { basePath: '/rows', index: 1 } })).toEqual({ ok: true, value: 'second' });
    expect(resolveDynamicValue({ value: { path: 'title' }, ctx })).toMatchObject({ ok: false, reason: 'RELATIVE_PATH_OUTSIDE_LIST_CONTEXT' });
  });

  it('uses injected clocks and IDs when an action requests a response', () => {
    const catalog = createLabCatalog({});
    let next = 0;
    const interpreter = createA2uiInterpreter({ catalog, clock: { nowMs: () => 1_000 }, ids: { next: () => `action-${++next}` } });
    interpreter.applyAgentMessage({ raw: { version: 'v1.0', createSurface: { surfaceId: 's', catalogId: catalog.catalogId } } });
    interpreter.applyAgentMessage({ raw: { version: 'v1.0', updateComponents: { surfaceId: 's', components: [
      { id: 'root', component: 'Button', child: 'label', action: { event: { name: 'save', wantResponse: true } } },
      { id: 'label', component: 'Text', text: 'Save' },
    ] } } });
    expect(interpreter.buildAction({ surfaceId: 's', componentId: 'root' })).toMatchObject({
      ok: true, kind: 'agent', message: { action: { actionId: 'action-1', timestamp: '1970-01-01T00:00:01.000Z' } },
    });
    expect(next).toBe(1);
  });

  it('takes encoder run context separately from optional sequence and clock overrides', () => {
    const encoder = createGenUiEncoder({ clock: { nowMs: () => 31 } });
    const event = { kind: 'start', payload: { runId: 'r', contextRef: 'ctx' } } as Parameters<typeof encoder.encode>[0]['event'];
    expect(encoder.encode({ event, runId: 'r' })).toEqual({ runId: 'r', ts: 31, kind: 'run.lifecycle', status: 'started' });
    expect(encoder.encode({ event, runId: 'r' }, { seq: 2, now: () => 47 })).toEqual({ runId: 'r', ts: 47, seq: 2, kind: 'run.lifecycle', status: 'started' });
  });
});
