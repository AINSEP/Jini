// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PooledIframe } from './PooledIframe.js';

describe('PooledIframe (server render)', () => {
  it('renders a plain iframe directly, with no pool host wrapper, when server-rendered', () => {
    const html = renderToStaticMarkup(<PooledIframe cacheKey="a" src="about:blank" title="x" />);
    expect(html).toContain('<iframe');
    expect(html).toContain('src="about:blank"');
    expect(html).not.toContain('jini-pooled-iframe-host');
  });
});
