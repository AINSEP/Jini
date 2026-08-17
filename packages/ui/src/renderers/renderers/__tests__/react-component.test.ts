import { describe, expect, it } from 'vitest';
import { ReactComponentRenderer } from '../react-component.js';
import type { ArtifactFile } from '../../types.js';

function file(overrides: Partial<ArtifactFile> = {}): ArtifactFile {
  return { name: 'Widget.tsx', kind: 'text', content: 'export default function Widget() { return null; }', ...overrides };
}

describe('ReactComponentRenderer', () => {
  it('no longer matches via legacy inference from a .tsx entry (inference removed)', () => {
    expect(ReactComponentRenderer.canRender({ file: file() })).toBe(false);
  });

  it('matches an explicit react-component manifest', () => {
    const manifest = {
      version: 1 as const,
      kind: 'react-component' as const,
      title: 't',
      entry: 'a',
      renderer: 'react-component' as const,
      exports: [],
    };
    expect(ReactComponentRenderer.canRender({ file: file({ manifest }) })).toBe(true);
  });

  it('refuses an unrelated manifest', () => {
    const manifest = { version: 1 as const, kind: 'html' as const, title: 't', entry: 'a', renderer: 'html' as const, exports: [] };
    expect(ReactComponentRenderer.canRender({ file: file({ manifest }) })).toBe(false);
  });

  it('refuses a file with no manifest and an unrecognized extension', () => {
    expect(ReactComponentRenderer.canRender({ file: file({ name: 'data.bin' }) })).toBe(false);
  });
});
