import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconFrame } from '../../components/IconFrame.js';

describe('IconFrame', () => {
  it('draws its children in the shared decorative 20-unit line frame', () => {
    const markup = renderToStaticMarkup(<IconFrame><path d="M3 3h14" /></IconFrame>);
    expect(markup).toBe(
      '<svg class="jini-icon-frame" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h14"></path></svg>',
    );
  });

  it('adds a host class beside its own, so host CSS that sizes icons still applies', () => {
    const markup = renderToStaticMarkup(<IconFrame className="icon"><circle cx="10" cy="10" r="4" /></IconFrame>);
    expect(markup.startsWith('<svg class="jini-icon-frame icon" viewBox="0 0 20 20"')).toBe(true);
  });
});
