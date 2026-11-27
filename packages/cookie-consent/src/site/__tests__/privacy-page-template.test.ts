import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { privacyPageTemplate } from '../privacy-page-template.js';

it('renders the provided contact as text, not active markup or a missing-contact prompt', () => {
  const dom = new JSDOM(privacyPageTemplate({ siteTitle: 'North & South', email: 'team<img>@example.test' }));
  try {
    const region = dom.window.document.querySelector('section[data-agent-element="privacy-policy"]');
    expect(region?.textContent).toContain('Questions about privacy? Contact team<img>@example.test.');
    expect(region?.querySelector('img')).toBeNull();
    expect(region?.querySelector('mark')).toBeNull();
  } finally { dom.window.close(); }
});
