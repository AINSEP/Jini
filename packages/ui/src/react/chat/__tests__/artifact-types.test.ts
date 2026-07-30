import { describe, expect, it } from 'vitest';
import { RendererRegistry, type ArtifactFile, type ArtifactRenderer } from '../artifact-types.js';

function file(overrides: Partial<ArtifactFile> = {}): ArtifactFile {
  return { name: 'a.txt', kind: 'text', ...overrides };
}

describe('RendererRegistry', () => {
  it('resolves the first registered renderer whose canRender() accepts the context', () => {
    const registry = new RendererRegistry();
    const textRenderer: ArtifactRenderer = { id: 'text', supportsStreaming: false, canRender: (ctx) => ctx.file.kind === 'text' };
    registry.register(textRenderer);
    const match = registry.resolve({ file: file() });
    expect(match).toEqual({ renderer: textRenderer, file: expect.objectContaining({ name: 'a.txt' }) });
  });

  it('returns null when no registered renderer accepts the context', () => {
    const registry = new RendererRegistry();
    registry.register({ id: 'image', supportsStreaming: false, canRender: (ctx) => ctx.file.kind === 'image' });
    expect(registry.resolve({ file: file({ kind: 'text' }) })).toBeNull();
  });

  it('returns null when the registry is empty (the for-of loop never iterates)', () => {
    const registry = new RendererRegistry();
    expect(registry.resolve({ file: file() })).toBeNull();
  });

  it('registers newest-first, so a later registration takes priority over an earlier match', () => {
    const registry = new RendererRegistry();
    const older: ArtifactRenderer = { id: 'older', supportsStreaming: false, canRender: () => true };
    const newer: ArtifactRenderer = { id: 'newer', supportsStreaming: false, canRender: () => true };
    registry.register(older);
    registry.register(newer);
    expect(registry.resolve({ file: file() })?.renderer).toBe(newer);
  });

  it('the register() unregister handle removes exactly the renderer it was created for', () => {
    const registry = new RendererRegistry();
    const renderer: ArtifactRenderer = { id: 'r', supportsStreaming: false, canRender: () => true };
    const unregister = registry.register(renderer);
    expect(registry.list()).toContain(renderer);
    unregister();
    expect(registry.list()).not.toContain(renderer);
    expect(registry.resolve({ file: file() })).toBeNull();
  });

  it('calling the unregister handle a second time is a safe no-op', () => {
    const registry = new RendererRegistry();
    const renderer: ArtifactRenderer = { id: 'r', supportsStreaming: false, canRender: () => true };
    const other: ArtifactRenderer = { id: 'other', supportsStreaming: false, canRender: () => true };
    const unregister = registry.register(renderer);
    registry.register(other);
    unregister();
    expect(registry.list()).toEqual([other]);
    // idx is now -1 (already removed) — must not throw or mutate the list further.
    expect(() => unregister()).not.toThrow();
    expect(registry.list()).toEqual([other]);
  });

  it('list() exposes the current registrations for inspection', () => {
    const registry = new RendererRegistry();
    expect(registry.list()).toEqual([]);
    const renderer: ArtifactRenderer = { id: 'r', supportsStreaming: true, canRender: () => true, renderPartial: (c) => c };
    registry.register(renderer);
    expect(registry.list()).toEqual([renderer]);
  });
});
