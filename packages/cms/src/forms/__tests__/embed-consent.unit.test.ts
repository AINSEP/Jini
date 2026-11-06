import { expect, test } from 'vitest';
import { renderFormCollection } from '../html-render.js';

const hooks = { field: 'data-field', form: 'data-form', success: 'data-success', error: 'data-error' };
const plan = { kind: 'embed' as const, url: 'https://docs.google.com/forms/d/e/public-id/viewform?embedded=true',
  publicUrl: 'https://docs.google.com/forms/d/e/public-id/viewform', title: 'Google Form', consent: ['functional'] as const,
  fallbackMessage: 'If this form does not open, open it on Google or contact the site owner.',
  capabilities: { answers: 'Google', validation: 'Google', spamProtection: 'Google' } };

test('embed delivery defaults to inert without consent infrastructure and keeps a visible public alternative', () => {
  const html = renderFormCollection({ slug: 'contact', fields: [], hooks, plan });
  expect(html).toContain('data-src="' + plan.url + '"');
  expect(html).toContain('data-jini-consent="[&quot;functional&quot;]"');
  expect(html).not.toMatch(/<iframe[^>]*\ssrc=/);
  expect(html).toContain(plan.fallbackMessage);
  expect(html).toContain('href="' + plan.publicUrl + '"');
  expect(html).not.toContain('<noscript');
});

test('explicit consent-off delivery uses an ordinary frame with the same public alternative', () => {
  const html = renderFormCollection({ slug: 'contact', fields: [], hooks, plan }, { consentOff: true });
  expect(html).toContain('<iframe src="' + plan.url + '"');
  expect(html).not.toContain('data-src=');
  expect(html).toContain(plan.fallbackMessage);
});


test('embeds have responsive dimensions and a consent message instead of an empty frame', () => {
  const html = renderFormCollection({ slug: 'contact', fields: [], hooks, plan });
  expect(html).toContain('width="100%" height="800"');
  expect(html).toContain('width:100%;height:min(80vh,800px);min-height:480px;border:0');
  expect(html).toContain('iframe[data-src]:not([src]){display:none}');
  expect(html).toContain('iframe[src]+.jini-form-embed-consent{display:none}');
  expect(html).toContain('Allow functional cookies to load this form.');
  const off = renderFormCollection({ slug: 'contact', fields: [], hooks, plan }, { consentOff: true });
  expect(off).not.toContain('Allow functional cookies');
});
