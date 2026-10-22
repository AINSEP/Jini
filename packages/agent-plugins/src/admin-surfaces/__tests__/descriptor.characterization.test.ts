/**
 * @file Characterization pins for `../descriptor.ts`, written green on the unmodified parser before
 * the executable-handler fields were added: a surface without them must keep parsing to exactly the
 * same descriptor (no new keys, not even undefined ones), unknown keys stay ignored, and an action
 * without `result` keeps carrying no `result` key.
 */
import { expect, test } from 'vitest';
import { parseAdminSurfacesFile } from '../descriptor.js';

// MOVE: Omitted action effects now normalize to write; optional surface fields still stay absent.
const input = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
const raw = (surface: Record<string, unknown>) => JSON.stringify({ schemaVersion: 1, surfaces: [surface] });
const base = { id: 'settings', title: 'Settings', entry: 'surface/index.html', files: ['surface/app.mjs'], actions: [{ name: 'save', input }] };

test('a surface without handler fields parses to exactly id, title, entry, files, actions and csp', () => {
  expect(parseAdminSurfacesFile({ raw: raw(base) })).toStrictEqual({
    ok: true,
    descriptors: [{ id: 'settings', title: 'Settings', entry: 'surface/index.html', files: ['surface/app.mjs'], actions: [{ name: 'save', effect: 'write', input }], csp: {} }],
  });
});

test('unknown surface keys are ignored, not refused and not copied', () => {
  expect(parseAdminSurfacesFile({ raw: raw({ ...base, colour: 'blue' }) })).toStrictEqual(parseAdminSurfacesFile({ raw: raw(base) }));
});

test('omitted files, actions and csp default to empty', () => {
  const parsed = parseAdminSurfacesFile({ raw: raw({ id: 'settings', title: 'Settings', entry: 'index.html' }) });
  expect(parsed).toStrictEqual({ ok: true, descriptors: [{ id: 'settings', title: 'Settings', entry: 'index.html', files: [], actions: [], csp: {} }] });
});

// Pinned green before the capability declarations (`connections`, `publicConfig`) were added:
// a handled surface that declares neither keeps parsing to exactly its handler fields.
test('a surface with a handler module but no capability declarations parses to exactly its handler fields', () => {
  const handled = { ...base, actions: [{ name: 'save', input, result: input }], handlerModule: 'server/handlers.mjs' };
  expect(parseAdminSurfacesFile({ raw: raw(handled) })).toStrictEqual({
    ok: true,
    descriptors: [{ id: 'settings', title: 'Settings', entry: 'surface/index.html', files: ['surface/app.mjs'], actions: [{ name: 'save', effect: 'write', input, result: input }], csp: {}, handlerModule: 'server/handlers.mjs' }],
  });
});

// Pinned green before `deliveryAdapters` was added: a handled surface that declares connections and
// public config keeps parsing to exactly those keys, so existing descriptors gain no new key.
test('a handled surface with connections and publicConfig parses to exactly its declared fields', () => {
  const handled = { ...base, actions: [{ name: 'save', input, result: input }], handlerModule: 'server/handlers.mjs', connections: [{ id: 'account' }], publicConfig: ['ACME_APP_ID'] };
  expect(parseAdminSurfacesFile({ raw: raw(handled) })).toStrictEqual({
    ok: true,
    descriptors: [{
      id: 'settings', title: 'Settings', entry: 'surface/index.html', files: ['surface/app.mjs'], actions: [{ name: 'save', effect: 'write', input, result: input }], csp: {},
      handlerModule: 'server/handlers.mjs', connections: [{ id: 'account', startParams: [], callbackFields: [] }], publicConfig: ['ACME_APP_ID'],
    }],
  });
});
