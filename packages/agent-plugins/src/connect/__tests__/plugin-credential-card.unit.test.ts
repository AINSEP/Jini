import { expect, test, vi } from 'vitest';
import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import { createPluginCredentialCardOperations, findPluginCredentialCard, loadPluginCredentialCardsSafely } from '../plugin-credential-card.js';

const fixed: PluginCredentialCard = {
  providerId: 'reporting', category: 'analytics', label: 'Reporting API', title: 'Connect Reporting', baseUrl: 'https://reports.example/v2',
};
const dynamic: PluginCredentialCard = {
  ...fixed, baseUrl: '', fields: [
    { name: 'baseUrl', label: 'Server', required: true },
    { name: 'username', label: 'Username' },
  ],
};
const validation = (message: string) => new TypeError(message);
const makeOperations = (assertFreeField = vi.fn((_field: { value: string; field: string }) => {})) => ({
  ...createPluginCredentialCardOperations({ cardErrors: { validation }, assertFreeField }), assertFreeField,
});

test('fixed cards ignore user destinations and retain allowed additional hosts', () => {
  const ops = makeOperations();
  expect(ops.readPluginCredentialValues({
    card: { ...fixed, additionalHosts: ['auth.reports.example'] },
    values: { baseUrl: 'http://other.example', username: 'unlisted field', token: 'demo-key' },
  })).toStrictEqual({
    label: 'Reporting API', category: 'analytics', baseUrl: 'https://reports.example/v2',
    username: undefined, token: 'demo-key', additionalHosts: ['auth.reports.example'],
  });
  expect(ops.assertFreeField.mock.calls).toEqual([]);
});

test('passes declared public fields to the host policy and defaults an absent token to empty', () => {
  const ops = makeOperations();
  const values = { baseUrl: 'https://customer.example/api', username: 'report-reader', token: 42 };
  expect(ops.readPluginCredentialValues({ card: dynamic, values })).toStrictEqual({
    label: 'Reporting API', category: 'analytics', baseUrl: 'https://customer.example/api', username: 'report-reader', token: '',
  });
  expect(ops.assertFreeField.mock.calls).toEqual([
    [{ field: 'baseUrl', value: 'https://customer.example/api' }],
    [{ field: 'username', value: 'report-reader' }],
  ]);
  expect(ops.readPluginCredentialValues({ card: dynamic, values: { baseUrl: values.baseUrl } }).username).toBeUndefined();
});

test.each([
  [{ baseUrl: '  ' }, 'baseUrl is required'],
  [{ baseUrl: 4 }, 'baseUrl is required'],
  [{ baseUrl: 'https://customer.example', username: false }, 'username must be text'],
  [{ baseUrl: 'malformed' }, 'Server URL must use HTTPS'],
  [{ baseUrl: 'http://customer.example' }, 'Server URL must use HTTPS without credentials'],
  [{ baseUrl: 'https://user@customer.example' }, 'Server URL must use HTTPS without credentials'],
  [{ baseUrl: 'https://:password@customer.example' }, 'Server URL must use HTTPS without credentials'],
] as const)('rejects invalid submitted values %j with the host validation error', (values, message) => {
  const ops = makeOperations();
  expect(() => ops.readPluginCredentialValues({ card: dynamic, values })).toThrow(new TypeError(message));
});

test('uses exact API label or domain target and never takes another kind of card', async () => {
  const publish = { ...fixed, saveKind: 'publish-host', saveTarget: 'hosting-primary' } as const;
  const oauth = { ...fixed, saveKind: 'oauth' } as const;
  const loadCards = vi.fn(async (workspaceId: string) => {
    if (workspaceId !== 'tenant-b') throw new Error('wrong workspace');
    return [publish, oauth, fixed];
  });
  const find = (saveKind: PluginCredentialCard['saveKind'], target: string) =>
    findPluginCredentialCard({ loadCards, workspaceId: 'tenant-b', saveKind, target });
  await expect(find('api', 'Reporting API')).resolves.toBe(fixed);
  await expect(find('api', 'reporting')).resolves.toBeUndefined();
  await expect(find('publish-host', 'hosting-primary')).resolves.toBe(publish);
  await expect(find('publish-host', 'reporting')).resolves.toBeUndefined();
  await expect(find('oauth', 'reporting')).resolves.toBe(oauth);
  expect(loadCards.mock.calls).toEqual(Array.from({ length: 5 }, () => ['tenant-b']));
});

test('an absent or broken optional card catalog leaves no cards and reports only safe copy', async () => {
  const warn = vi.fn();
  await expect(loadPluginCredentialCardsSafely({ workspaceId: 'tenant-b' }, { warn })).resolves.toEqual([]);
  expect(warn.mock.calls).toEqual([]);
  const loadCards = async () => { throw new Error('/private/credential-card/path'); };
  await expect(loadPluginCredentialCardsSafely({ loadCards, workspaceId: 'tenant-b' }, { warn })).resolves.toEqual([]);
  expect(warn.mock.calls).toEqual([
    ['[plugin-credential-cards] Optional card lookup failed; using the default credential form.'],
  ]);
});

test('a host public-field rejection reaches the caller unchanged', () => {
  const refusal = new Error('No account secret in Username');
  const assertFreeField = vi.fn(({ field }: { value: string; field: string }) => {
    if (field === 'username') throw refusal;
  });
  const operations = makeOperations(assertFreeField);
  let caught: unknown;
  try { operations.readPluginCredentialValues({ card: dynamic, values: { baseUrl: 'https://customer.example', username: 'not-public' } }); }
  catch (error) { caught = error; }
  expect(caught).toBe(refusal);
  expect(assertFreeField.mock.calls).toEqual([
    [{ field: 'baseUrl', value: 'https://customer.example' }], [{ field: 'username', value: 'not-public' }],
  ]);
});
