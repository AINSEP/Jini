import { expect, it } from 'vitest';
import { createPluginInstallSourceSchema } from '../plugin-install-source.js';

it('requires exactly one source and restricts attachments to ZIP', () => {
  const schema = createPluginInstallSourceSchema({ pathDescription: 'Absolute path on this machine. Exactly one of path/attachmentRef.' });
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required).toEqual(['kind']);
  expect(schema.oneOf).toEqual([
    { required: ['path'], not: { required: ['attachmentRef'] } },
    { required: ['attachmentRef'], not: { required: ['path'] }, properties: { kind: { const: 'zip' } } },
  ]);
  expect(schema.properties.attachmentRef.pattern).toBe('^attachment:[A-Za-z0-9-]{8,80}$');
});
