import { describe, expect, it, vi } from 'vitest';
import { createMemoryMembersApi } from '../adapters/memory.js';
import { createHttpMembersApi } from '../adapters/http.js';
import { createMembersController } from '../controllers/members.controller.js';
import { member } from './people.fixtures.js';

describe('member list cursor', () => {
  it('pages a workspace in ID order, preserves afterId, and refuses malformed continuations', async () => {
    const members = ['c', 'a', 'b'].map(id => ({ ...member, id }));
    members.push({ ...member, id: 'foreign', workspaceId: 'other' });
    const api = createMemoryMembersApi({ workspaceId: 'w' }, { members });
    const first = await api.listMembers({}, { limit: 2 });
    expect(first.members.map(row => row.id)).toEqual(['a', 'b']);
    expect(typeof first.nextCursor).toBe('string');
    const second = await api.listMembers({}, { limit: 2, cursor: first.nextCursor });
    expect(second.members.map(row => row.id)).toEqual(['c']);
    expect(second.nextCursor).toBeNull();
    expect((await api.listMembers({}, { afterId: 'b', limit: 2 })).members.map(row => row.id)).toEqual(['c']);
    await expect(api.listMembers({}, { cursor: 'invalid' })).rejects.toThrow(/invalid cursor/i);
    await expect(api.listMembers({}, { cursor: first.nextCursor, afterId: 'a' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Pass cursor or afterId, not both.' });
    await expect(createMemoryMembersApi({ workspaceId: 'w' }).listMembers({}, { cursor: 'invalid' })).rejects.toThrow(/invalid cursor/i);
  });

  it('passes the continuation through the HTTP adapter', async () => {
    const request = vi.fn().mockResolvedValue({ members: [member], nextCursor: 'next' });
    const api = createHttpMembersApi({ transport: { request }, workspaceId: 'w' });
    expect(await api.listMembers({}, { cursor: 'abc+/=', limit: 2 })).toEqual({ members: [member], nextCursor: 'next' });
    expect(request.mock.calls[0]?.[0].path).toBe('/workspaces/w/members?cursor=abc%2B%2F%3D&limit=2');
    await expect(api.listMembers({}, { cursor: 'next', afterId: 'm' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('exposes the first-page continuation to the headless controller', async () => {
    const members = Array.from({ length: 101 }, (_, i) => ({ ...member, id: `m${String(i).padStart(3, '0')}` }));
    const api = createMemoryMembersApi({ workspaceId: 'w' }, { members });
    const controller = createMembersController({ api });
    await controller.load({});
    expect(controller.getSnapshot({}).members).toHaveLength(100);
    expect(typeof controller.getSnapshot({}).nextCursor).toBe('string');
    const oversized = await api.listMembers({}, { limit: 1000 });
    expect(oversized.members).toHaveLength(100);
    expect(typeof oversized.nextCursor).toBe('string');
    controller.dispose();
  });
});
