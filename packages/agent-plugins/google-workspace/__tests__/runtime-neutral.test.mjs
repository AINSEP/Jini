/**
 * @file Host-neutral runtime pins for the move from Tovu's bundled `content/agent-plugins/google-workspace`
 * into Jini (plan v2 §5.1): the code any host runs (lib, tools, ui, form-destinations) never names a
 * host product in what a person reads or in its comments, while the identifiers already stored outside
 * the plugin keep their old spelling (renaming them would orphan columns and unconfigure sites).
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { FIELD_MARKER_KEY, SUBMISSION_ID_HEADER, SUBMITTED_AT_HEADER } from '../form-destinations/mapping.mjs';
import { PICKER_CONFIG_NAMES } from '../lib/picker-flow.mjs';
import { GoogleWorkspaceError } from '../lib/request-policy.mjs';

const root = path.resolve(import.meta.dirname, '..');
const RUNTIME_DIRS = ['lib', 'tools', 'ui', 'form-destinations'];
const RUNTIME_FILE = /\.(?:mjs|html|css)$/;

/** Every runtime file as a forward-slash path relative to the plugin root. @complexity O(files). */
async function runtimeFiles() {
  const files = [];
  for (const dir of RUNTIME_DIRS) {
    const entries = await readdir(path.join(root, dir), { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && RUNTIME_FILE.test(entry.name)) files.push(path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

test('no runtime file names the Tovu product, in user-visible text or comments', async () => {
  const files = await runtimeFiles();
  assert.ok(files.length > 40, `runtime files found: ${files.length}`);
  for (const file of files) assert.doesNotMatch(await readFile(path.join(root, file), 'utf8'), /\bTovu\b/, file);
});

test('safe errors speak as "this site", never as a named host', () => {
  for (const code of ['file-not-granted', 'admin-policy', 'quota-delay', 'network-error', 'unexpected-response', 'invalid-selection']) {
    const { message } = new GoogleWorkspaceError({ code });
    assert.match(message, /this site|This site/, code);
    assert.doesNotMatch(message, /Tovu/, code);
  }
});

test('identifiers already stored in spreadsheets and site config keep their spelling', () => {
  assert.deepEqual([SUBMISSION_ID_HEADER, SUBMITTED_AT_HEADER, FIELD_MARKER_KEY], ['_tovu_submission_id', '_tovu_submitted_at', 'tovu_form_field']);
  assert.deepEqual({ ...PICKER_CONFIG_NAMES }, { developerKey: 'TOVU_GOOGLE_PICKER_BROWSER_KEY', appId: 'TOVU_GOOGLE_PICKER_APP_ID' });
});
