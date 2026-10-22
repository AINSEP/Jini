import { expect, it, vi } from 'vitest';

// Any attempt to evaluate the optional vendor peer fails, even when workspace links exist.
vi.mock('@jini-ai/integrations/media-providers/catalog', () => {
  throw new Error('The host did not install the optional integrations peer');
});

it('imports generic UI root, core and feature entries without the integrations peer', async () => {
  const [root, core, media, execution] = await Promise.all([
    import('../../../index.js'),
    import('../../../core.js'),
    import('../index.js'),
    import('../../execution/index.js'),
  ]);
  expect(root.MediaProvidersTab).toBe(media.MediaProvidersTab);
  expect(root.ExecutionTab).toBe(execution.ExecutionTab);
  expect(core.DEFAULT_MEDIA_PROVIDER_CATALOG).toEqual([]);
  expect(media.DEFAULT_MEDIA_PROVIDER_CATALOG).toEqual([]);
  expect(execution.DEFAULT_PROVIDER_PRESETS).toEqual([]);
});
