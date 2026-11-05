import { test, expect } from 'vitest';
import { createFormCollectionRegistry, resolveFormCollectionPlan } from '../provider.js';
import { encodeFormFields, decodeFormFields } from '../fields-json.js';
import { createFormspreeProvider } from '../../../../provider-plugins/src/formspree/provider.js';

const definition = { slug: 'contact', fields: [], provider: { id: 'formspree', config: { endpoint: 'https://formspree.io/f/abc123' } } };
test('definition codec preserves provider for Builder and HTML, old arrays retain built-in default', () => {
  for (const mode of ['builder', 'html'] as const) {
    const stored = { ...definition, mode, html: '<input name="email">' };
    expect(decodeFormFields({ json: encodeFormFields({ definition: stored as never }) }).provider).toEqual(definition.provider);
  }
  expect(decodeFormFields({ json: '[]' }).provider).toBeUndefined();
});
test('provider registry isolates instances, handles absent plugin, and switches back without changing fields', () => {
  const providers = createFormCollectionRegistry({});
  expect(resolveFormCollectionPlan({ definition, providers })).toMatchObject({ kind: 'unavailable', code: 'provider_unavailable' });
  providers.contribute({ pluginId: 'jini/formspree', definition: { id: 'formspree', provider: createFormspreeProvider({}) } });
  expect(resolveFormCollectionPlan({ definition, providers })).toMatchObject({ kind: 'post', action: definition.provider.config.endpoint, external: true });
  expect(resolveFormCollectionPlan({ definition: { ...definition, provider: { id: 'builtin', config: {} } }, providers })).toMatchObject({ kind: 'post', action: '/forms/contact/submit', external: false });
  expect(resolveFormCollectionPlan({ definition, providers: createFormCollectionRegistry({}) })).toMatchObject({ kind: 'unavailable' });
});
test.each(['http://formspree.io/f/x','https://evil.test/f/x','https://formspree.io.evil.test/f/x','https://x@formspree.io/f/x','https://formspree.io/f/x?secret=x','https://formspree.io/f/x#x','https://formspree.io/f/x/../y'])('refuses unsafe endpoint %s', endpoint => {
  expect(createFormspreeProvider({}).plan({ config: { endpoint }, slug: 'contact' })).toMatchObject({ kind: 'unavailable', code: 'invalid_configuration' });
});
