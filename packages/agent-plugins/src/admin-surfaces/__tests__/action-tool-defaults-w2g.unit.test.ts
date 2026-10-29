import { expect, test, vi } from 'vitest';
import { buildAdminSurfaceActionTools } from '../action-tools.js';
import { parseAdminSurfacesFile } from '../descriptor.js';

test('an action with no connections discloses a frozen empty list and uses the shared dispatcher without decoration', async () => {
  const parsed = parseAdminSurfacesFile({ raw: JSON.stringify({ schemaVersion: 1, surfaces: [{
    id: 'account', title: 'Account', entry: 'index.html', handlerModule: 'handlers.mjs',
    actions: [{ name: 'save', input: { type: 'string' }, result: { type: 'string' } }],
  }] }) });
  if (!parsed.ok) throw new Error(parsed.reason);
  const connectionRefFor = vi.fn(() => 'unused');
  const authorize = vi.fn(async () => {});
  const save = vi.fn(async () => 'saved');
  const [contribution] = buildAdminSurfaceActionTools({ surfaces: [{ pluginId: 'acme', descriptor: parsed.descriptors[0]! }],
    authorize, handlersFor: () => ({ save }) }, { connectionRefFor });
  expect(contribution!.connections).toEqual([]);
  expect(Object.isFrozen(contribution!.connections)).toBe(true);
  expect(connectionRefFor).not.toHaveBeenCalled();
  expect(contribution!.tool.effect).toBe('write');
  expect(await contribution!.tool.handler({ pluginId: 'acme', auth: { workspaceId: 'site', principalId: 'owner' }, input: { payload: 'answer' } })).toEqual({ ok: true, result: 'saved' });
  expect(save).toHaveBeenCalledWith({ payload: 'answer', context: { workspaceId: 'site', principalId: 'owner', pluginId: 'acme', surfaceId: 'account' } });
  expect(contribution!.describeAffectedResources!({ input: { payload: 'answer' } })).toEqual(['Account: save']);
  expect(() => contribution!.describeAffectedResources!({ input: { payload: 42 } })).toThrow('Supply payload matching');
});
