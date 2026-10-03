import { describe, expect, it } from 'vitest';
import { createTauriRenderService } from '../tauri-render-service.js';
import { NotImplementedError } from '../not-implemented.js';

describe('createTauriRenderService', () => {
  it('rejects every method with NotImplementedError, clearly marked as out of scope', async () => {
    const service = createTauriRenderService({});
    await expect(service.renderToPdf({ html: '<html></html>' })).rejects.toBeInstanceOf(NotImplementedError);
    await expect(service.capture({ html: '<html></html>' })).rejects.toBeInstanceOf(NotImplementedError);
    await expect(service.exportArtifact({ html: '<html></html>', format: 'pdf' })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
