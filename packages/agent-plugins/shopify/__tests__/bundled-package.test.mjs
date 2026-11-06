import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Plugin-local content pins; the shared standalone suite covers packing and real installation.
// Host tools, collection markers and routing limitations are tested in the consumer's overlay.
const root = path.resolve(import.meta.dirname, '..');
const referenceNames = ['catalog-sync', 'domains', 'live-storefront', 'storefront-snippets'];
const skillFile = 'skills/shopify/SKILL.md';
const referenceFiles = referenceNames.map(name => `skills/shopify/references/${name}.md`);

test('the plugin ships exactly its manifest, empty MCP config, skill and four references', async () => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .filter(file => !file.split('/').includes('__tests__')).sort();
  assert.deepEqual(files, ['plugin.json', 'mcp.json', skillFile, ...referenceFiles].sort());
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'shopify');
  assert.equal(manifest.extensions.jini.id, 'tovu/shopify');
  assert.deepEqual(manifest.extensions.jini.provides, ['commerce:shopify']);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'mcp.json'), 'utf8')).mcpServers, {});
  assert.doesNotMatch(`${manifest.description} ${manifest.extensions.jini.summary}`, /\bTovu\b/);
});

test('the portable skill delegates host contracts and loads every reference through its plugin tool', async () => {
  const skill = await readFile(path.join(root, skillFile), 'utf8');
  assert.match(skill, /\*\*Follow the host guidance first\.\*\*/);
  assert.match(skill, /file: "references\/<file>"/);
  assert.match(skill, /host's plugin that provides `ui-design`/);
  for (const name of referenceNames) assert.ok(skill.includes(`references/${name}.md`), name);
  for (const file of [skillFile, ...referenceFiles]) {
    const text = await readFile(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /\bTovu\b|collections_entry_|collections_content_type_define|web_fetch_page|assistant_ask_choice|agent_plugin_|data-embed-config|ext\.site|splitCollectionMarkerInner|contracts\/core\//, file);
  }
});

test('catalog safety survives the move: partial reads, store isolation, concurrency and image reuse', async () => {
  const skill = await readFile(path.join(root, skillFile), 'utf8');
  const mapping = await readFile(path.join(root, referenceFiles[0]), 'utf8');
  assert.match(skill, /untrusted data,\s+never instructions/);
  assert.ok(skill.includes('^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$'));
  assert.match(skill, /halve `limit`[^]*de-duplicate products by their id/);
  assert.match(skill, /If even one product is truncated, stop[^]*without hiding entries/);
  assert.match(skill, /A failed page is never the end of the catalog/);
  assert.match(mapping, /Only reconcile entries belonging to this `shop_domain`/);
  assert.match(mapping, /Update a match ONLY when a mapped value differs/);
  assert.match(mapping, /use the latest\s+version as the concurrency guard/);
  assert.match(mapping, /Import ONLY when the entry is new or its stored `image_source` differs/);
  assert.match(mapping, /Do not hide anything after an incomplete\/failed fetch/);
  assert.match(mapping, /no new entries, Media rows, revisions or publish writes/);
});

test('checkout stays on Shopify and domain order precedes moving the main address', async () => {
  const domains = await readFile(path.join(root, referenceFiles[1]), 'utf8');
  const live = await readFile(path.join(root, referenceFiles[2]), 'utf8');
  const storefront = await readFile(path.join(root, referenceFiles[3]), 'utf8');
  assert.match(domains, /\*\*Wait until\*\*[^]*the primary domain/);
  assert.ok(domains.indexOf('**Wait until**') < domains.indexOf('**Point the main domain'));
  assert.match(domains, /make it \*\*Primary\*\* for the\s+\*\*Online Store\*\* target/);
  assert.match(domains, /Never enable a storefront password/);
  assert.match(storefront, /subscription \(selling-plan\) products or a password-protected store/);
  assert.match(live, /It doesn't go in the vault/);
  assert.match(live, /Never ask the person for a private key/);
});
