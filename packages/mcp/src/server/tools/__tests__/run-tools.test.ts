import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ getDaemonJson: vi.fn(), postDaemonJson: vi.fn() }));
const { getDaemonJson, postDaemonJson } = hoisted;
vi.mock('../../daemon-client.js', () => hoisted);

import {
  RUN_TOOLS,
  cancelRunTool,
  getActiveContextTool,
  getRunTool,
  listAgentsTool,
  startRunTool,
} from '../run-tools.js';
import type { McpToolContext } from '../../tool-protocol.js';

const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

describe('RUN_TOOLS', () => {
  it('exports all five tools with unique names', () => {
    expect(RUN_TOOLS.map((t) => t.name)).toEqual([
      'start_run',
      'get_run',
      'cancel_run',
      'get_active_context',
      'list_agents',
    ]);
  });
});

describe('startRunTool', () => {
  it('requires contextRef', async () => {
    await expect(startRunTool.handler({ args: {}, ctx: ctx })).rejects.toThrow('contextRef is required (string).');
  });

  it('posts {contextRef} only when agentId/idempotencyKey are omitted', async () => {
    postDaemonJson.mockResolvedValueOnce({ run: { id: 'r1' }, started: true });
    const result = await startRunTool.handler({ args: { contextRef: 'c1' }, ctx: ctx });
    expect(postDaemonJson).toHaveBeenCalledWith({ baseUrl: 'http://d.example', route: '/api/runs', body: { contextRef: 'c1' } }, { fetchImpl: ctx.fetchImpl });
    expect(result).toEqual({ run: { id: 'r1' }, started: true });
  });

  it('includes agentId and idempotencyKey when supplied as non-empty strings', async () => {
    postDaemonJson.mockResolvedValueOnce({ run: { id: 'r1' }, started: true });
    await startRunTool.handler({ args: { contextRef: 'c1', agentId: 'a1', idempotencyKey: 'k1' }, ctx: ctx });
    expect(postDaemonJson).toHaveBeenCalledWith(
      { baseUrl: 'http://d.example', route: '/api/runs', body: { contextRef: 'c1', agentId: 'a1', idempotencyKey: 'k1' } }, { fetchImpl: ctx.fetchImpl },
    );
  });

  it('omits agentId/idempotencyKey when they are empty strings or non-strings', async () => {
    postDaemonJson.mockResolvedValueOnce({});
    await startRunTool.handler({ args: { contextRef: 'c1', agentId: '', idempotencyKey: 42 }, ctx: ctx });
    expect(postDaemonJson).toHaveBeenCalledWith({ baseUrl: 'http://d.example', route: '/api/runs', body: { contextRef: 'c1' } }, { fetchImpl: ctx.fetchImpl });
  });

  it('declares its input schema and write annotations', () => {
    expect(startRunTool.inputSchema).toMatchObject({ type: 'object', required: ['contextRef'] });
    expect(startRunTool.annotations).toMatchObject({ readOnlyHint: false, title: 'Start a run' });
  });
});

describe('getRunTool', () => {
  it('requires runId', async () => {
    await expect(getRunTool.handler({ args: {}, ctx: ctx })).rejects.toThrow('runId is required (string).');
  });

  it('GETs the run status route with the runId URI-encoded', async () => {
    getDaemonJson.mockResolvedValueOnce({ run: { id: 'r/1' } });
    const result = await getRunTool.handler({ args: { runId: 'r/1' }, ctx: ctx });
    expect(getDaemonJson).toHaveBeenCalledWith({ baseUrl: 'http://d.example', route: '/api/runs/r%2F1' }, { fetchImpl: ctx.fetchImpl });
    expect(result).toEqual({ run: { id: 'r/1' } });
  });

  it('declares read-only annotations', () => {
    expect(getRunTool.annotations).toMatchObject({ readOnlyHint: true, title: 'Check a run' });
  });
});

describe('cancelRunTool', () => {
  it('requires runId', async () => {
    await expect(cancelRunTool.handler({ args: {}, ctx: ctx })).rejects.toThrow('runId is required (string).');
  });

  it('posts an empty body when reason is omitted', async () => {
    postDaemonJson.mockResolvedValueOnce({ run: { id: 'r1' } });
    await cancelRunTool.handler({ args: { runId: 'r1' }, ctx: ctx });
    expect(postDaemonJson).toHaveBeenCalledWith({ baseUrl: 'http://d.example', route: '/api/runs/r1/cancel', body: {} }, { fetchImpl: ctx.fetchImpl });
  });

  it('includes a non-empty reason', async () => {
    postDaemonJson.mockResolvedValueOnce({ run: { id: 'r1' } });
    await cancelRunTool.handler({ args: { runId: 'r1', reason: 'user requested' }, ctx: ctx });
    expect(postDaemonJson).toHaveBeenCalledWith({ baseUrl: 'http://d.example', route: '/api/runs/r1/cancel', body: { reason: 'user requested' } }, { fetchImpl: ctx.fetchImpl });
  });

  it('omits an empty-string reason', async () => {
    postDaemonJson.mockResolvedValueOnce({});
    await cancelRunTool.handler({ args: { runId: 'r1', reason: '' }, ctx: ctx });
    expect(postDaemonJson).toHaveBeenCalledWith({ baseUrl: 'http://d.example', route: '/api/runs/r1/cancel', body: {} }, { fetchImpl: ctx.fetchImpl });
  });
});

describe('getActiveContextTool', () => {
  it('returns the daemon payload unchanged when active is true', async () => {
    getDaemonJson.mockResolvedValueOnce({ active: true, resourceRef: 'x', detail: null, ts: 1, ageMs: 0 });
    const result = await getActiveContextTool.handler({ args: {}, ctx: ctx });
    expect(getDaemonJson).toHaveBeenCalledWith({ baseUrl: 'http://d.example', route: '/api/active' }, { fetchImpl: ctx.fetchImpl });
    expect(result).toEqual({ active: true, resourceRef: 'x', detail: null, ts: 1, ageMs: 0 });
  });

  it('adds a hint when the daemon reports active:false', async () => {
    getDaemonJson.mockResolvedValueOnce({ active: false });
    const result = await getActiveContextTool.handler({ args: {}, ctx: ctx });
    expect(result).toMatchObject({ active: false, hint: expect.stringContaining('No active resource') });
  });

  // A host that never mounts GET /api/active answers 404. Surfaced as the bare "daemon 404 on ..."
  // error, a model read it as "no pointer set / aged past the TTL" (a host product, 2026-09-16) and told the
  // user nothing was recorded — the tool must say the host does not support it at all.
  it('fails with an explicit "not supported by this host" error when the daemon does not serve /api/active', async () => {
    getDaemonJson.mockRejectedValueOnce(Object.assign(new Error('daemon 404 on http://d.example/api/active: HTTP 404'), { status: 404 }));
    await expect(getActiveContextTool.handler({ args: {}, ctx: ctx })).rejects.toThrow(
      'get_active_context is not supported by this host: its daemon does not serve GET /api/active (HTTP 404). This is NOT the same as {active:false} — no focus is tracked through this tool here at all. Use any screen/page context the host put in your prompt, or ask the user.',
    );
  });

  it('rethrows any other daemon failure unchanged', async () => {
    const failure = Object.assign(new Error('daemon 500 on http://d.example/api/active: HTTP 500'), { status: 500 });
    getDaemonJson.mockRejectedValueOnce(failure);
    await expect(getActiveContextTool.handler({ args: {}, ctx: ctx })).rejects.toBe(failure);
  });
});

describe('listAgentsTool', () => {
  it('GETs /api/agents', async () => {
    getDaemonJson.mockResolvedValueOnce({ agents: [{ id: 'claude', name: 'Claude' }] });
    const result = await listAgentsTool.handler({ args: {}, ctx: ctx });
    expect(getDaemonJson).toHaveBeenCalledWith({ baseUrl: 'http://d.example', route: '/api/agents' }, { fetchImpl: ctx.fetchImpl });
    expect(result).toEqual({ agents: [{ id: 'claude', name: 'Claude' }] });
  });
});
