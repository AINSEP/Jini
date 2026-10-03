import assert from 'node:assert/strict';
import { test } from 'vitest';
import { decodeSkillBase64, SkillInputError, validateSkillMarkdown } from '../index.js';
import { createSkillRefreshMiddleware } from '../live-registration.js';

test('error constructor and bounded decoding use separate required and optional objects', () => {
  const error = new SkillInputError({ message: 'Invalid bundle.' }, {});
  assert.equal(error.message, 'Invalid bundle.');
  assert.ok(error instanceof Error);
  assert.deepEqual(decodeSkillBase64({ value: 'YWJj' }, { maxBytes: 3 }), Buffer.from('abc'));
  assert.throws(() => decodeSkillBase64({ value: 'YWJj' }, { maxBytes: 2 }), /size limit/);
  assert.throws(() => decodeSkillBase64({ value: '$invalid' }, {}), /valid base64/);
});

test('markdown reader is an injected object-argument port', () => {
  let received = '';
  const result = validateSkillMarkdown({
    markdown: '---\nname: incident\ndescription: Respond.\n---\n',
    yamlReader: { read: ({ yaml }) => { received = yaml; return { name: 'incident', description: 'Respond.' }; } },
  }, {});
  assert.equal(received, 'name: incident\ndescription: Respond.');
  assert.deepEqual(result, { name: 'incident', description: 'Respond.' });
});

test('refresh continuation separates optional error from required arguments', async () => {
  const failure = new Error('invalid state');
  const middleware = createSkillRefreshMiddleware({ registry: {
    refreshInstalledSkills: async () => { throw failure; },
  } });
  const calls: unknown[] = [];
  await middleware({ next: (required, optional) => { calls.push([required, optional]); } });
  assert.deepEqual(calls, [[{}, { error: failure }]]);
});
