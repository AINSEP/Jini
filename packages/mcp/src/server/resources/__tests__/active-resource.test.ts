import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ getDaemonJson: vi.fn() }));
const { getDaemonJson } = hoisted;
vi.mock('../../daemon-client.js', () => hoisted);

import { activeContextResource, KERNEL_RESOURCES } from '../active-resource.js';
import { buildResourceIndex, handleResourceRead } from '../../resource-protocol.js';
import type { McpToolContext } from '../../tool-protocol.js';

const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

describe('KERNEL_RESOURCES', () => {
  it('exports exactly the active-context resource', () => {
    expect(KERNEL_RESOURCES).toEqual([activeContextResource]);
  });
});

describe('activeContextResource', () => {
  it('declares a jini:// uri and a JSON mimeType', () => {
    expect(activeContextResource.uri).toBe('jini://active');
    expect(activeContextResource.uri.startsWith('jini://')).toBe(true);
    expect(activeContextResource.mimeType).toBe('application/json');
  });

  it('GETs /api/active and returns the payload as formatted JSON text, unchanged, when active', async () => {
    getDaemonJson.mockResolvedValueOnce({ active: true, resourceRef: 'x', detail: null, ts: 1, ageMs: 0 });
    const result = await activeContextResource.read({ ctx: ctx });
    expect(getDaemonJson).toHaveBeenCalledWith({ baseUrl: 'http://d.example', route: '/api/active' }, { fetchImpl: ctx.fetchImpl });
    expect(result).toEqual({ text: JSON.stringify({ active: true, resourceRef: 'x', detail: null, ts: 1, ageMs: 0 }, null, 2) });
  });

  it('returns the raw payload with no added hint when the daemon reports active:false (unlike the get_active_context tool)', async () => {
    getDaemonJson.mockResolvedValueOnce({ active: false });
    const result = await activeContextResource.read({ ctx: ctx });
    expect(result).toEqual({ text: JSON.stringify({ active: false }, null, 2) });
    expect(result.text).not.toContain('hint');
  });

  it('propagates a daemon-unreachable failure through handleResourceRead as a sanitized rejection, not a silently-empty resource', async () => {
    getDaemonJson.mockRejectedValueOnce(new Error('cannot reach the daemon at http://d.example. Is it running?'));
    const resources = buildResourceIndex({ resources: [activeContextResource] });
    await expect(handleResourceRead({ uri: 'jini://active', resources, ctx })).rejects.toThrow('cannot reach the daemon');
  });

  it('end-to-end via handleResourceRead: wraps the read into MCP contents with the declared mimeType', async () => {
    getDaemonJson.mockResolvedValueOnce({ active: true, resourceRef: 'x' });
    const resources = buildResourceIndex({ resources: [activeContextResource] });
    const result = await handleResourceRead({ uri: 'jini://active', resources, ctx });
    expect(result).toEqual({
      contents: [
        {
          uri: 'jini://active',
          text: JSON.stringify({ active: true, resourceRef: 'x' }, null, 2),
          mimeType: 'application/json',
        },
      ],
    });
  });
});
