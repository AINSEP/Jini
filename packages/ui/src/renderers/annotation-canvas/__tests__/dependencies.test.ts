import { describe, expect, it } from 'vitest';
import { createFakeAnnotationCanvasPort } from '../dependencies.js';

describe('createFakeAnnotationCanvasPort', () => {
  it('resolves onSubmit with ok:true by default', async () => {
    const port = createFakeAnnotationCanvasPort();
    await expect(port.onSubmit({ file: null, note: '', action: 'send' })).resolves.toEqual({ ok: true });
  });

  it('has no capture strategy by default', () => {
    const port = createFakeAnnotationCanvasPort();
    expect(port.captureSnapshot).toBeUndefined();
    expect(port.captureFrameRect).toBeUndefined();
  });

  it('allows overriding any field', async () => {
    const port = createFakeAnnotationCanvasPort({ onSubmit: async () => ({ ok: false, message: 'nope' }) });
    await expect(port.onSubmit({ file: null, note: '', action: 'queue' })).resolves.toEqual({ ok: false, message: 'nope' });
  });
});
