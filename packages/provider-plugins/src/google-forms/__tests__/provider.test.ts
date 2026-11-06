import { test, expect } from 'vitest';
import { createGoogleFormsProvider } from '../provider.js';

const publicUrl = 'https://docs.google.com/forms/d/e/FAKE_public-form_123/viewform';
const provider = createGoogleFormsProvider({});

test.each([publicUrl, `${publicUrl}?embedded=true`, `${publicUrl}?usp=sf_link`, `${publicUrl}?usp=sharing`, `${publicUrl}?usp=dialog`, `${publicUrl}?usp=header`])('canonical public URL becomes a functional-consent embed: %s', url => {
  expect(provider.plan({ slug: 'feedback', config: { url } })).toEqual({
    kind: 'embed', url: `${publicUrl}?embedded=true`, publicUrl,
    title: 'Google Forms', consent: ['functional'],
    fallbackMessage: 'If this form does not open, open it on Google or contact the site owner.',
    capabilities: {
      answers: 'Questions and answers are managed in Google Forms; new answers are not copied into the built-in inbox.',
      validation: 'Google Forms validates its own questions; local form fields do not change the embedded form.',
      spamProtection: 'Google Forms provides its own submission controls according to the form owner’s settings.',
    },
  });
});

test.each([
  'http://docs.google.com/forms/d/e/id/viewform',
  'https://forms.gle/fake',
  'https://docs.google.com.evil.test/forms/d/e/id/viewform',
  'https://evil.test/forms/d/e/id/viewform',
  'https://docs.google.com@evil.test/forms/d/e/id/viewform',
  'https://person@docs.google.com/forms/d/e/id/viewform',
  'https://docs.google.com:443/forms/d/e/id/viewform',
  'https://docs.google.com/forms/d/e/id/edit',
  'https://docs.google.com/forms/d/id/viewform',
  'https://docs.google.com/forms/d/e//viewform',
  `${publicUrl}/`, `${publicUrl}#fragment`, `${publicUrl}?entry.1=x`,
  `${publicUrl}?embedded=false`, `${publicUrl}?embedded=true&other=x`,
  `${publicUrl}?embedded=true&embedded=true`,
  'https://docs.google.com/forms/d/e/%69d/viewform',
  'https://docs.google.com/forms/d/e/id/../other/viewform',
  'https://docs.google.com/forms/d/e/id\\viewform',
  `${publicUrl}\n`, `${publicUrl}\r\n`, `${publicUrl}\u0000`, ` ${publicUrl}`,
  `${publicUrl} `, 'https://docs.google.com/forms/d/e/іd/viewform',
])('rejects non-public or non-allowlisted URL %j', url => {
  expect(provider.plan({ slug: 'feedback', config: { url } })).toMatchObject({ kind: 'unavailable', code: 'invalid_configuration', message: expect.stringContaining('public Google Forms link') });
});

test('accepts only the public URL configuration without changing it', () => {
  const config = { url: publicUrl };
  const snapshot = { ...config };
  expect(provider.plan({ slug: 'feedback', config }).kind).toBe('embed');
  expect(config).toEqual(snapshot);
  for (const config of [{}, { url: '' }, { url: publicUrl, extra: 'value' }, { endpoint: publicUrl }]) {
    expect(provider.plan({ slug: 'feedback', config: config as Record<string, string> })).toMatchObject({ kind: 'unavailable', code: 'invalid_configuration' });
  }
});

test('public settings explain remote ownership, publication, anonymous access and frame origin', () => {
  expect(provider.describe?.()).toMatchObject({
    label: 'Google Forms',
    fields: [{ key: 'url', label: 'Public form link', type: 'url' }],
    helpText: expect.stringContaining('anonymous browser'),
    answers: expect.stringContaining('Google Forms'),
    validation: expect.stringContaining('Google Forms'),
    frameOrigins: ['https://docs.google.com'],
  });
});
