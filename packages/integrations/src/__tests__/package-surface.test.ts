import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import * as webhookTools from '../webhooks/tools/index.js';
import * as webhookSql from '../webhooks/sql/index.js';
import { getWebhooksAgentToolCatalog } from '../webhooks/tools/agent-tools.js';
import { buildWebhooksToolRegistrations, webhooksDerivedRisk } from '../webhooks/tools/tool-registrations.js';
import { toWebhookDeliveryView } from '../webhooks/tools/tool-views.js';
import { SqlWebhookDeliveryRepo, SqlWebhookSubscriptionRepo } from '../webhooks/sql/webhook-repo.js';

it('declares each independent subpath with a runtime, source entry and legacy type resolution', () => {
  const root = new URL('../../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const entries = {
    './media-providers': 'node',
    './media-providers/catalog': 'universal',
    './credentialed-http': 'node',
    './webhooks': 'node',
    './api-connections': 'node',
    './webhooks/tools': 'node',
    './webhooks/sql': 'node',
    './secrets': 'node',
  };
  for (const [subpath, runtime] of Object.entries(entries)) {
    const entry = manifest.exports[subpath];
    expect(manifest.jini.entries[subpath]).toBe(runtime);
    expect(entry.default).toBe(entry.import);
    expect(entry.types).toBe(entry.import.replace(/\.js$/, '.d.ts'));
    expect(manifest.typesVersions['*'][subpath.slice(2)]).toEqual([entry.types]);
    const source = entry.import.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
    expect(existsSync(fileURLToPath(new URL(source, root))), source).toBe(true);
  }
  expect(manifest.exports['.']).toBeUndefined();
  expect(manifest.exports['./http-ports']).toBeUndefined();
});

it('the webhook tools and sql entries publish exactly their runtime API, bound to the implementing modules', () => {
  // Internal view helpers (mostRecentDelivery, toSubscriptionToolView) stay off the public tools entry.
  expect(Object.keys(webhookTools).sort()).toEqual(['buildWebhooksToolRegistrations', 'getWebhooksAgentToolCatalog', 'toWebhookDeliveryView', 'webhooksDerivedRisk']);
  expect(webhookTools.getWebhooksAgentToolCatalog).toBe(getWebhooksAgentToolCatalog);
  expect(webhookTools.buildWebhooksToolRegistrations).toBe(buildWebhooksToolRegistrations);
  expect(webhookTools.webhooksDerivedRisk).toBe(webhooksDerivedRisk);
  expect(webhookTools.toWebhookDeliveryView).toBe(toWebhookDeliveryView);
  expect(Object.keys(webhookSql).sort()).toEqual(['SqlWebhookDeliveryRepo', 'SqlWebhookSubscriptionRepo']);
  expect(webhookSql.SqlWebhookDeliveryRepo).toBe(SqlWebhookDeliveryRepo);
  expect(webhookSql.SqlWebhookSubscriptionRepo).toBe(SqlWebhookSubscriptionRepo);
});
