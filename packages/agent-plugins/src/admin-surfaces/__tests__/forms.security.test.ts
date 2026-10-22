import { describe, expect, test, vi } from 'vitest';
import { parseAdminSurfacesFile } from '../descriptor.js';
import { openAdminSurfaceCapabilitySession } from '../surface-capabilities.js';
import { validateAdminSurfaceMessage } from '../host-validator.js';
import { createFakeSurfaceHost } from './surface-support.js';

const form = { slug: 'contact', title: 'Contact us' };

function open(input: { declared?: boolean; hosted?: boolean; actorId?: string; live?: () => boolean } = {}) {
  const list = vi.fn(async () => [form]);
  const capabilities = createFakeSurfaceHost().port({ pluginId: 'acme-office', workspaceId: 'ws-1' });
  const session = openAdminSurfaceCapabilitySession({
    capabilities: { ...capabilities, ...(input.hosted === false ? {} : { forms: { list } }) },
    declared: input.declared === false ? {} : { forms: ['list'] },
    isLive: input.live ?? (() => true), issued: new Set(),
  }, input.actorId === undefined ? {} : { actorId: input.actorId });
  return { ...session, list };
}

describe('forms declarations', () => {
  const parse = (forms: unknown, handler = true) => parseAdminSurfacesFile({ raw: JSON.stringify({ schemaVersion: 1, surfaces: [{
    id: 'destinations', title: 'Destinations', entry: 'ui/index.html', forms,
    ...(handler ? { handlerModule: 'ui/handler.mjs' } : {}),
  }] }) });

  test('preserves the read-only declaration', () => {
    const parsed = parse(['list']);
    expect(parsed.ok && parsed.descriptors[0]?.forms).toEqual(['list']);
  });
  test.each([true, 'list', ['save'], ['list', 'list'], ['list', 'remove']].map((forms) => ({ forms })))('refuses malformed or writable grants: $forms', ({ forms }) => {
    expect(parse(forms)).toMatchObject({ ok: false, reason: expect.stringContaining('.forms') });
  });
  test('needs server-side handlers', () => {
    expect(parse(['list'], false)).toEqual({ ok: false, reason: 'surfaces[0].forms needs a handlerModule that uses it' });
  });
});

test('an undeclared or unavailable forms capability is absent and never calls the host', () => {
  for (const input of [{ declared: false }, { hosted: false }]) {
    const session = open(input);
    expect(session.capabilities).not.toHaveProperty('forms');
    expect(session.list).not.toHaveBeenCalled();
  }
});

test('listing requires a signed-in actor before calling the host', async () => {
  const session = open();
  await expect(session.capabilities.forms!.list({})).rejects.toThrow(/signed-in admin/);
  expect(session.list).not.toHaveBeenCalled();
});

test('only bounded form choices leave the host; private fields are dropped', async () => {
  const session = open({ actorId: 'admin-1' });
  session.list.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({ slug: `form-${index}`, title: 't'.repeat(1025), private: 'hidden' })));
  const result = await session.capabilities.forms!.list({});
  expect(result).toHaveLength(200);
  expect(result[0]).toEqual({ slug: 'form-0', title: 't'.repeat(1024) });
  expect(session.list).toHaveBeenCalledTimes(1);
  expect(session.list).toHaveBeenCalledWith({});
});

test('a revoked capability retained by a handler cannot read forms', async () => {
  let live = true;
  const session = open({ actorId: 'admin-1', live: () => live });
  await expect(session.capabilities.forms!.list({})).resolves.toEqual([form]);
  live = false;
  await expect(session.capabilities.forms!.list({})).rejects.toThrow(/revoked/);
  expect(session.list).toHaveBeenCalledTimes(1);
});

test('the host message validator refuses an undeclared forms action even for a forms-enabled surface', () => {
  const frame = {};
  const descriptor = { actions: [], forms: ['list'] as const };
  const verdict = validateAdminSurfaceMessage({
    mount: { mountId: 'mount-1', frame, descriptor },
    event: { origin: 'null', source: frame, data: { protocol: 'jini.admin-surface', version: 1, kind: 'action-request', mountId: 'mount-1', requestId: 'r-1', action: 'list-forms', payload: {} } },
  });
  expect(verdict).toMatchObject({ ok: false, refused: 'action-undeclared' });
});

test.each([{ slug: '', title: 'Contact' }, { slug: 's'.repeat(65), title: 'Contact' }])('refuses an invalid host form identity: $slug', async (invalid) => {
  const session = open({ actorId: 'admin-1' });
  session.list.mockResolvedValue([invalid]);
  await expect(session.capabilities.forms!.list({})).rejects.toThrow('invalid form choice');
});
