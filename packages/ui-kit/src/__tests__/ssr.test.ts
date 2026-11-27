/** Server rendering (node environment, no DOM): overlays render in place instead of portalling. */
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Menu, ToastRegion } from '../react/index.js';
import { createToastService } from '../toast.js';

describe('server rendering without a document', () => {
  it('renders a closed menu trigger without needing a browser portal target', () => {
    const html = renderToString(h(Menu, {
      label: 'Report actions', items: [{ id: 'archive', label: 'Archive report', onPress: () => {} }],
    }));
    expect(html).toContain('aria-label="Report actions"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Archive report');
  });

  it('a ToastRegion with no provider renders its messages inline', () => {
    expect(typeof document).toBe('undefined');
    const service = createToastService({}, { durationMs: 0 });
    service.push({ message: 'Rendered on the server' });
    const html = renderToString(h(ToastRegion, { service }));
    expect(html).toContain('data-jini-part="kit.toast-region"');
    expect(html).toContain('Rendered on the server');
    service.dispose({});
  });
});
