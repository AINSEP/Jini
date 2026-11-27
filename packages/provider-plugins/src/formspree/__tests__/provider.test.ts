import { test, expect } from 'vitest';
import { createFormspreeProvider } from '../provider.js';
test('describes the one editable public endpoint without requesting frame access', () => {
  expect(createFormspreeProvider({}).describe?.()).toEqual({
    label: 'Formspree',
    fields: [{ key: 'endpoint', label: 'Public form endpoint', type: 'url', helpText: 'Use https://formspree.io/f/form-id from your Formspree form.' }],
    helpText: 'Send answers directly to your hosted Formspree form.',
    answers: 'Answers are managed in your Formspree account; they are not copied into the built-in inbox.',
    validation: 'Browser field checks and Formspree validation apply.',
    frameOrigins: [],
  });
});
test.each([{ config: {} }, { config: { endpoint: 'https://formspree.io/f/abc123', extra: 'unexpected' } }])(
  'rejects missing or extra settings instead of producing a native POST for $config',
  ({ config }) => {
    expect(createFormspreeProvider({}).plan({ config: config as Record<string, string>, slug: 'contact' })).toEqual({
      kind: 'unavailable', code: 'invalid_configuration',
      message: 'This form needs a valid public Formspree endpoint (https://formspree.io/f/form-id) before it can send answers.',
    });
  },
);
test('preserves exact native POST URL without sending or storing answers', () => {
  expect(createFormspreeProvider({}).plan({ config: { endpoint: 'https://formspree.io/f/abc123' }, slug: 'contact' })).toMatchObject({ kind: 'post', action: 'https://formspree.io/f/abc123', external: true });
});
test.each(['http://formspree.io/f/x','https://evil.test/f/x','https://formspree.io.evil.test/f/x','https://x@formspree.io/f/x','https://formspree.io/f/x?secret=x','https://formspree.io/f/x#x','https://formspree.io/f/x/../y','https://formspree.io/f/x\n'])('refuses unsafe endpoint %s', endpoint => {
  expect(createFormspreeProvider({}).plan({ config: { endpoint }, slug: 'contact' })).toMatchObject({ kind: 'unavailable', code: 'invalid_configuration' });
});
test('rejects a real trailing line feed rather than HTML-normalizing its destination', () => {
  const endpoint = 'https://formspree.io/f/abc123' + String.fromCharCode(10);
  expect(createFormspreeProvider({}).plan({ config: { endpoint }, slug: 'contact' })).toMatchObject({ kind: 'unavailable', code: 'invalid_configuration' });
});
