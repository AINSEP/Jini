import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
const calendar = manifest.extensions.tovu.exports['booking-calendar'];

test('every file the booking calendar names ships in the payload', async () => {
  for (const file of [calendar.template, calendar.styles]) assert.ok((await stat(path.join(root, file))).isFile(), file);
});

test('the calendar needs no script and only reaches the declared booking host', async () => {
  assert.equal(calendar.scripts, undefined);
  assert.deepEqual(calendar.externalHosts, { frame: ['https://calendly.com'] });
  assert.deepEqual(calendar.urlProps, ['url']);
  assert.equal(calendar.consent, 'functional');
  assert.equal(calendar.staticExport, 'full');
});

test('the page stays usable without the frame: its fallback link uses the same prop', async () => {
  const template = await readFile(path.join(root, calendar.template), 'utf8');
  assert.match(template, /<a href="\{\{props\.url\}\}">/);
});

test('the sign-in is optional and the guidance never asks for it first', async () => {
  const skill = await readFile(path.join(root, 'skills/calendly/SKILL.md'), 'utf8');
  const [card] = manifest.extensions.tovu.credentialCards;
  assert.match(card.intro, /^Optional/);
  assert.match(skill, /never needs a sign-in/);
  assert.match(skill, /"plugin":"tovu\/calendly"/);
});
