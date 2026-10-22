// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorIcon } from './EditorIcon.js';

describe('EditorIcon', () => {
  it('renders the vscode glyph with the default size', () => {
    const { container } = render(<EditorIcon editorId="vscode" />);
    const span = container.querySelector('span.editor-icon');
    expect(span).not.toBeNull();
    expect((span as HTMLElement).style.width).toBe('16px');
    expect((span as HTMLElement).style.background).toBe('var(--jini-primary)');
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe(String(16 * 0.76));
  });

  it('renders a simplePath-based glyph (cursor) at a custom size', () => {
    const { container } = render(<EditorIcon editorId="cursor" size={32} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe(String(32 * 0.76));
    expect(svg?.querySelector('path')).not.toBeNull();
  });

  it.each(['finder', 'terminal', 'qoder', 'antigravity', 'explorer', 'file-manager'])(
    'renders a known multi-shape glyph for %s without throwing',
    (editorId) => {
      const { container } = render(<EditorIcon editorId={editorId} />);
      expect(container.querySelector('svg')).not.toBeNull();
    }
  );

  it('falls back to a neutral folder tile for an unregistered id', () => {
    const { container } = render(<EditorIcon editorId="some-unknown-editor" size={24} />);
    const span = container.querySelector('span.editor-icon');
    expect((span as HTMLElement).style.background).toBe('var(--jini-muted)');
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe(String(24 * 0.6));
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
  });
});
