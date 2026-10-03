import { expect, it } from 'vitest';
import type { AgentToolDefinition } from '@jini-ai/core';
import { defaultDbMessages, databaseTransferAgentToolCatalog, getDatabaseTransferAgentToolCatalog } from '../../tools/index.js';

// REGRESSION: fails if transfer-catalog uses the former fixed source-schema examples.
it('renders host schema naming and keeps tool identities, risk, permissions and inputs unchanged', () => {
  const baseline = getDatabaseTransferAgentToolCatalog({});
  const custom = getDatabaseTransferAgentToolCatalog({}, { naming: { defaultSchema: 'tenant_data', schemaPrefix: 'tenant_' } });
  expect(baseline[0]?.description).toContain("'app'");
  expect(custom[0]?.description).toContain("'tenant_data'");
  expect(custom[0]?.description).toContain("'tenant_<source name>'");
  expect(custom[0]?.description).not.toEqual(baseline[0]?.description);
  const contracts = (entries: readonly AgentToolDefinition[]) => entries.map(({ description, ...contract }) => contract);
  expect(contracts(custom)).toEqual(contracts(baseline));
  expect(databaseTransferAgentToolCatalog).toEqual(baseline);
});
// REGRESSION: fails if getDatabaseTransferAgentToolCatalog ignores optional.messages.
it('uses a complete replacement messages object without losing private-address guidance', () => {
  const baseline = getDatabaseTransferAgentToolCatalog({});
  const translated = getDatabaseTransferAgentToolCatalog({}, { messages: {
    plan: ({ naming }) => `Copy preview for ${naming.defaultSchema}`,
    setDestination: 'Private destination form', status: 'Copy status', run: 'Copy the preview', planIdDescription: 'Preview identifier',
  } });
  expect(translated.map(entry => entry.description)).toEqual(['Copy preview for app', 'Private destination form', 'Copy status', 'Copy the preview']);
  expect(baseline[1]?.description).toContain('must never ask for it in chat');
  expect(defaultDbMessages.setDestination).toContain('do not repeat it');
  expect(translated[3]?.inputSchema).toMatchObject({ properties: { planId: { description: 'Preview identifier' } } });
});
// REGRESSION: fails if getDatabaseTransferAgentToolCatalog is removed in favor of the original static catalog.
it('returns fresh catalog records while preserving default schemas and classifications', () => {
  const first = getDatabaseTransferAgentToolCatalog({});
  first[0]!.description = 'caller mutation';
  expect(getDatabaseTransferAgentToolCatalog({})[0]?.description).not.toBe('caller mutation');
  expect(getDatabaseTransferAgentToolCatalog({}).map(entry => [entry.name, entry.sideEffects, entry.authorization.permission])).toEqual([
    ['database_transfer_plan', 'none', 'database-transfer.run'],
    ['database_transfer_set_destination', 'mutates-durable-state', 'database-transfer.run'],
    ['database_transfer_status', 'none', 'database-transfer.run'],
    ['database_transfer_run', 'mutates-durable-state', 'database-transfer.run'],
  ]);
});
