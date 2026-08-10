import { describe, expect, it } from 'vitest';
import { HtmlRenderer } from '../html.js';
import type { ArtifactFile } from '../../types.js';

function file(overrides: Partial<ArtifactFile> = {}): ArtifactFile {
  return { name: 'index.html', kind: 'html', content: '<p>hi</p>', ...overrides };
}

describe('HtmlRenderer', () => {
  it('no longer matches a plain html file with no manifest (inference removed)', () => {
    expect(HtmlRenderer.canRender({ file: file() })).toBe(false);
  });

  it('matches an explicit html manifest renderer', () => {
    const manifest = { version: 1 as const, kind: 'html' as const, title: 't', entry: 'a', renderer: 'html' as const, exports: [] };
    expect(HtmlRenderer.canRender({ file: file({ manifest }) })).toBe(true);
  });

  it('refuses a deck manifest', () => {
    const manifest = { version: 1 as const, kind: 'deck' as const, title: 't', entry: 'a', renderer: 'deck-html' as const, exports: [] };
    expect(HtmlRenderer.canRender({ file: file({ manifest }) })).toBe(false);
  });

  it('falls back to the isDeckHint hint when the manifest is neither html nor deck', () => {
    const manifest = { version: 1 as const, kind: 'mini-app' as const, title: 't', entry: 'a', renderer: 'mini-app' as const, exports: [] };
    expect(HtmlRenderer.canRender({ file: file({ manifest }), hints: { isDeckHint: true } })).toBe(false);
    expect(HtmlRenderer.canRender({ file: file({ manifest }) })).toBe(true);
  });

  it('refuses a non-html file kind', () => {
    expect(HtmlRenderer.canRender({ file: file({ kind: 'text', name: 'notes.txt' }) })).toBe(false);
  });
});
