/**
 * @file Characterization pins for the existing `tovu-admin-surfaces.json` before the G13b panels
 * extend it: the `connection` surface keeps its id, title and entry (the admin page's tab and any
 * saved link name it), the file still passes Jini's descriptor parser, and every served file stays
 * static and secret-free (the files route is public and the CSP forbids inline script and style).
 * Green on the placeholder file.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseAdminSurfacesFile } from '@jini-ai/agent-plugins/admin-surfaces';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

async function descriptors() {
  const parsed = parseAdminSurfacesFile({ raw: await read('tovu-admin-surfaces.json') });
  assert.equal(parsed.ok, true, parsed.reason);
  return parsed.descriptors;
}

test('tovu-admin-surfaces.json: the connection surface keeps its id, title and entry', async () => {
  const connection = (await descriptors()).find((surface) => surface.id === 'connection');
  assert.deepEqual({ id: connection.id, title: connection.title, entry: connection.entry }, { id: 'connection', title: 'Google Workspace', entry: 'ui/connection-panel.html' });
});

test('only the form-destinations surface declares read-only form discovery', async () => {
  const surfaces = await descriptors();
  assert.deepEqual(surfaces.map((surface) => [surface.id, surface.forms]), [
    ['connection', undefined], ['picker', undefined], ['form-destinations', ['list']],
  ]);
});

test('surface files: every served file is static (no inline script or style) and holds nothing secret-shaped', async () => {
  const secretShaped = /ya29\.|1\/\/[0-9A-Za-z_-]{20,}|GOCSPX-|AIza[0-9A-Za-z_-]{20,}|-----BEGIN|sk-[A-Za-z0-9]{20,}/;
  for (const surface of await descriptors()) {
    for (const path of [surface.entry, ...surface.files]) {
      const text = await read(path);
      assert.equal(secretShaped.test(text), false, `${path} holds a secret-shaped string`);
      if (!path.endsWith('.html')) continue;
      assert.equal(/<script(?![^>]*\ssrc=)[^>]*>/i.test(text), false, `${path} has an inline script`);
      assert.equal(/\sstyle=|<style/i.test(text), false, `${path} has an inline style`);
    }
  }
});
