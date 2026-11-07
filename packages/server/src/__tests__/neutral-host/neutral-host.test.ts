/**
 * The neutral host: each moved class must work in a product that is not the one it came from, with
 * memory stores and public `@jini-ai/*` entries only. One `.todo` per class; the batch that moves a
 * class turns its `.todo` into a check here, through the test dispatcher, with the moved tool itself
 * (never a stand-in fixture). The cost counters are read across complete calls, before and after.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COST_COUNTER_NAMES, createNeutralHost, NEUTRAL_PRODUCT_NAME, scansPerToolCall, type NeutralHost } from './support/index.ts';

let root: string;
let host: NeutralHost;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'neutral-host-'));
  host = createNeutralHost({ root });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('neutral host harness', () => {
  it('boots as "Another Studio" from public entries, with nothing installed and nothing counted', async () => {
    expect(host.productName).toBe(NEUTRAL_PRODUCT_NAME);
    expect(NEUTRAL_PRODUCT_NAME).toBe('Another Studio');
    expect(await host.lifecycle.listInstalledPlugins({ workspaceRoot: host.workspaceRoot })).toEqual([]);
    expect(Object.values(host.counters.snapshot()).every(count => count === 0)).toBe(true);
    expect(host.provisioning).toEqual([]);
  });

  it('counts one trusted-package scan per scan, and none for a tool call', async () => {
    const before = host.counters.snapshot();
    await host.lifecycle.findTrustedPluginPackages({ workspaceId: host.workspaceId, filename: 'studio-agent-tools.json', contribution: 'agent tools', requireActive: true });
    await expect(host.dispatcher.dispatch({ toolId: 'not_registered', input: {} })).rejects.toThrow();
    const delta = host.counters.since({ before });
    expect(delta.trustedPackageScans).toBe(1);
    expect(delta.toolCalls).toBe(1);
    expect(scansPerToolCall({ counts: { ...delta, trustedPackageScans: 0 } })).toBe(0);
  });

  it('counts vault listings and envelope opens through the memory ports', () => {
    host.vault.put({ workspaceId: host.workspaceId, key: 'a', value: 'one' });
    host.vault.put({ workspaceId: host.workspaceId, key: 'b', value: 'two' });
    host.vault.put({ workspaceId: 'elsewhere', key: 'c', value: 'three' });
    const envelope = host.sealer.seal({ plaintext: 'secret value' });
    expect(host.vault.list({ workspaceId: host.workspaceId })).toHaveLength(2);
    expect(host.sealer.open({ envelope })).toBe('secret value');
    const counts = host.counters.snapshot();
    expect(counts.vaultListCalls).toBe(1);
    expect(counts.vaultListRows).toBe(2);
    expect(counts.vaultListBytes).toBeGreaterThan(0);
    expect(counts.sealerOpens).toBe(1);
    expect(counts.sealerOpenBytes).toBe('secret value'.length);
  });

  it('names every §10 operation as a counter', () => {
    expect(COST_COUNTER_NAMES).toEqual(expect.arrayContaining([
      'sealerOpens', 'vaultListCalls', 'contributionLoads', 'credentialOpens', 'fileReads', 'toolCatalogBytes',
      'trustedPackageScans', 'mailSettingsReads', 'mailCredentialListCalls', 'mailLedgerCalls', 'mailCatalogLoads',
    ]));
  });
});

describe('test dispatcher, with moved tools as they arrive', () => {
  it.todo('denies a call before any I/O (no file read, vault listing or envelope open)');
  it.todo('refuses malformed input before the handler runs');
  it.todo('raises exactly one human card for a call that needs a person');
  it.todo('asks for ordinary write approval for a write tool, and runs it once approved');
  it.todo('cancels a call waiting on a person, with no effect left behind');
});

describe('moved classes in a neutral host', () => {
  // @jini-ai/agent-plugins/lifecycle/host-tools
  it.todo('skill tool: returns a plugin skill by reading one bounded file');
  it.todo('plugin search: finds installed plugins by the host\'s own names');
  it.todo('plugin memory tools: read and write a plugin\'s own memory');
  it.todo('write-note: saves a note under the plugin\'s own state');
  it.todo('provider status: reports configured providers with no product names');
  // @jini-ai/agent-plugins/lifecycle/mail
  it.todo('mail: loads adapters, selects a provider and sends through the host mailer');
  // @jini-ai/server/agent-plugin-host
  it.todo('credential save: saves a key through the host card, never echoing it');
  it.todo('connect: connects a plugin through one card');
  it.todo('access token: issues a token for a connected plugin, with one credential open per lookup');
  it.todo('provisioning: provisions what a plugin declares, through the host ports');
  it.todo('API connection host: calls a declared API connection with the saved credential');
  it.todo('connect orchestration: completes an exchange started by a card');
  it.todo('executable-tool host: runs p_<plugin>__<tool> with the plugin\'s own disclosure and approval');
  // @jini-ai/server/hosted-mcp
  it.todo('MCP store: lists servers, opening each envelope as counted');
  it.todo('MCP sign-in: completes an OAuth exchange for a hosted MCP server');
  it.todo('revocation: revokes a hosted MCP grant and forgets its credential');
  it.todo('vault: plugin-state writes list the workspace vault as counted');
});
