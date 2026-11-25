import type { SiteUpdateStatusReply } from '@jini-ai/core/contracts/site/devops-deploy';
import { describe, expect, it, vi } from 'vitest';
import { siteUpdateStatusRoute, type SiteUpdateStatusRouteDeps } from '../site-update-status.js';

const status: SiteUpdateStatusReply = { availability: { kind: 'current', runningVersion: '1.0.0' } };

describe('siteUpdateStatusRoute', () => {
  it('authorizes system.read before reading site update status', async () => {
    const effects: string[] = [];
    const authorize = vi.fn(async () => {
      await Promise.resolve();
      effects.push('authorized');
    });
    const getStatus = vi.fn<SiteUpdateStatusRouteDeps['getStatus']>(async () => {
      effects.push('read');
      return status;
    });

    expect(siteUpdateStatusRoute.method).toBe('get');
    expect(siteUpdateStatusRoute.path).toBe('/api/admin/v1/workspaces/:workspaceId/system/site-update/status');
    expect(siteUpdateStatusRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: {} });
    const result = siteUpdateStatusRoute.handle({ input: {}, deps: { getStatus }, authorize });

    expect(authorize).toHaveBeenCalledExactlyOnceWith({ permission: 'system.read', entityType: 'site-update' });
    expect(getStatus).not.toHaveBeenCalled();
    expect(await result).toEqual({ ok: true, value: status });
    expect(effects).toEqual(['authorized', 'read']);
  });

  it('refuses to read status when no authorizer is supplied', async () => {
    const getStatus = vi.fn<SiteUpdateStatusRouteDeps['getStatus']>().mockResolvedValue(status);

    await expect(siteUpdateStatusRoute.handle({ input: {}, deps: { getStatus } }))
      .rejects.toThrow('JSON route authorizer is required');
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('forwards the request abort signal to the status reader', async () => {
    const getStatus = vi.fn<SiteUpdateStatusRouteDeps['getStatus']>().mockResolvedValue(status);
    const authorize = vi.fn(async () => {});
    const { signal } = new AbortController();

    expect(await siteUpdateStatusRoute.handle({ input: {}, deps: { getStatus }, authorize }, { signal }))
      .toEqual({ ok: true, value: status });
    expect(getStatus).toHaveBeenCalledExactlyOnceWith({}, { signal });
  });
});
