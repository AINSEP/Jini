import { expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireActivatedPlugin } from '../../plugin-contributions.js';
import type { PluginContributionsSnapshot } from '@jini-ai/core/contracts/site/plugins-host';

it('does not advance to auth or body parsers for an inactive plugin', async () => {
  const json = vi.fn();
  const next = vi.fn();
  const response = { status: vi.fn(() => ({ json })), locals: {} } as unknown as Response;
  await requireActivatedPlugin({ workspaceId: 'w', pluginActivationRepo: { getActivation: async () => ({ enabled: false }) } }, { pluginId: 'plugin' } as PluginContributionsSnapshot)({} as Request, response, next);
  expect(response.status).toHaveBeenCalledWith(404);
  expect(json).toHaveBeenCalledWith({ code: 'NOT_FOUND' });
  expect(next).not.toHaveBeenCalled();
});
