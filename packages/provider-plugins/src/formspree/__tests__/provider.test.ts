import { test, expect } from 'vitest';
import { createFormspreeProvider } from '../provider.js';
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
