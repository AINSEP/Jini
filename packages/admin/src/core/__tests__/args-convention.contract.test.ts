import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  AdminApiError, adminHref, buildNav, createAdminClient, createHttpTransport,
  currentRoutePath, describeApiError, hasPermission, matchRoute, resolvePanels,
} from '../index.js';
import type { AdminPanel, AdminCommentsPort, AdminIdentityPort, AdminTransport } from '../index.js';

describe('admin object argument contracts', () => {
  it('keeps registry, route and permission behavior through the public barrel', () => {
    const panels: readonly AdminPanel[] = [
      { id: 'records', requires: ['records'], permissions: ['records.read'], nav: { label: 'Records' }, render: null },
    ];
    const resolved = resolvePanels({ panels }, { capabilities: ['records'], permissions: ['*'] });
    expect(hasPermission({ permissions: ['*'], permission: 'records.read' })).toBe(true);
    expect(buildNav({ panels: resolved })[0]?.items[0]?.href).toBe('/records');
    expect(matchRoute({ routePath: '/records', panels: resolved }).panelId).toBe('records');
    expect(adminHref({ routePath: '/records' }, { base: '/console' })).toBe('/console/records');
    expect(currentRoutePath({ pathname: '/console/records' }, { base: '/console' })).toBe('/records');
  });

  it('passes object requests through an injected fetch port and preserves HTTP failures', async () => {
    const body = { error: 'Denied', code: 'DENIED', detail: 'fixture' };
    const fetch = vi.fn(async (_args: { url: string }, _options?: RequestInit) => ({
      ok: false, status: 403, json: async () => body,
    }) as Response);
    const transport = createHttpTransport({ baseUrl: '/fixture', fetch }, { credentials: 'omit' });
    await expect(transport.request({ path: '/records' }, { method: 'POST' })).rejects.toMatchObject({
      name: 'AdminApiError', message: 'Denied', status: 403, code: 'DENIED', body,
    });
    expect(fetch).toHaveBeenCalledWith({ url: '/fixture/records' }, expect.objectContaining({
      method: 'POST', credentials: 'omit',
    }));
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Content-Type')).toBe('application/json');
  });

  it('assembles route factories with the same injected transport', async () => {
    const request = vi.fn(async () => ['r1']);
    const transport = { request } as unknown as AdminTransport;
    const client = createAdminClient({ transport, groups: {
      records: ({ transport: port }) => ({ list: () => port.request<string[]>({ path: '/records' }) }),
    } });
    expect(client.transport).toBe(transport);
    await expect(client.records.list()).resolves.toEqual(['r1']);
    expect(request).toHaveBeenCalledWith({ path: '/records' });
  });

  it('preserves error construction and fallback translation', () => {
    const error = new AdminApiError({ message: '', status: 409 }, { code: 'CONFLICT', body: { revision: 2 } });
    expect(error).toBeInstanceOf(Error);
    expect(error.body).toEqual({ revision: 2 });
    expect(describeApiError({ e: error, fallback: 'Conflict' })).toBe('Conflict');
  });

  it('separates required moderation data from optional notes', () => {
    expectTypeOf<Parameters<AdminCommentsPort['moderateComment']>>().toEqualTypeOf<[
      requiredArgs: { commentId: string; action: 'approve' | 'spam' | 'trash' | 'restore'; expectedVersion: number },
      optionalArgs?: { note?: string },
    ]>();
    expectTypeOf<Parameters<AdminIdentityPort['createUser']>>().toEqualTypeOf<[
      requiredArgs: { username: string; password: string }, optionalArgs?: { email?: string },
    ]>();
  });
});
