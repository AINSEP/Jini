import { expect, test } from 'vitest';
import { buildMediaViewImageAgentToolCatalog } from '../view-image-tool.js';

test('uses the injected metadata write id for read-only image guidance', () => {
  const [tool] = buildMediaViewImageAgentToolCatalog({
    mediaAssetReadToolId: 'assets.read', mediaMetadataWriteToolId: 'assets.save_metadata',
  });
  expect(tool!.sideEffects).toBe('none');
  expect(tool!.description).toContain('Read-only: it changes nothing');
  expect(tool!.description).toContain('to save new alt text afterwards, use assets.save_metadata.');
  expect(tool!.description).toContain("When asked to save what you see, call assets.save_metadata with a short factual description of the picture and the asset's current version.");
  expect(tool!.description).not.toContain('media_update_metadata');
});
