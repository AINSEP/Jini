import { expect, it } from 'vitest';
import { fixture } from '../settings-fixture.js';
import { registerSettingsRoutes } from '../../index.js';

it('the HTTP fixture refuses unmounted routes while invoking registered handlers', async () => {
  const f = fixture();
  await expect(f.invoke('GET', '/prefs/definitions')).rejects.toThrow('missing route GET /prefs/definitions');
  registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke('GET', '/prefs/definitions');
  expect(capture.statusCode).toBe(200);
  expect(capture.jsonBody).toEqual({ data: [] });
  expect(f.deps.service.listDefinitions).toHaveBeenCalledTimes(1);
  expect(f.deps.service.listDefinitions).toHaveBeenCalledWith({ workspaceId: 'workspace-a' });
});
