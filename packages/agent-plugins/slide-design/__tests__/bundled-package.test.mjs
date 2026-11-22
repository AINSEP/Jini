import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('saves requested work and publishes only on request', async () => {
  const root = new URL('../', import.meta.url);
  const skill = (await readFile(new URL('skills/slide-design/SKILL.md', root), 'utf8')).replace(/\s+/g, ' ');
  const manifest = JSON.parse(await readFile(new URL('plugin.json', root), 'utf8'));
  assert.equal(manifest.version, '0.1.2', 'versions artifact delivery guidance');
  assert.match(skill, /Design-only requests may return in chat/, 'consultation can stay in chat');
  assert.match(skill, /Save requested page or deck work with the current host's tools/, 'deck requests produce saved work');
  assert.match(skill, /“Make an HTML deck” means produce an HTML artifact/, 'HTML deck requests require an artifact');
  assert.match(skill, /If no save tool is available, return the complete HTML artifact in chat and explain the limitation/, 'missing saving still returns HTML');
  assert.match(skill, /Publish only when requested/, 'publication needs a user request');
  assert.doesNotMatch(skill, /page or HTML tools to publish the deck/, 'does not equate creation with publication');
  assert.match(skill, /Ask before overwriting an existing page or deck/, 'retains overwrite approval');
  assert.match(skill, /Don't install packages or run shell commands to make a deck unless the host says you may/, 'retains host execution limits');
  assert.match(skill, /references\/html-deck\.md/, 'keeps the existing artifact format reference');
});
