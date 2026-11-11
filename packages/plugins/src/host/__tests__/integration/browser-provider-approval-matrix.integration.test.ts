/** L2 §8.6: approval-mismatch matrix — the review-owned pin must match the manifest field by field
 *  (array order significant), and the reviewed digest map exactly; one difference per case. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admitBrowserProviderAssets } from '../../node/index.js';
import type { PluginManifest } from '../../manifest.js';
import type { BundledBrowserProviderApproval } from '../../ports.js';

const digest = (value: string) => `sha256-${createHash('sha256').update(value).digest('hex')}`;
const files = { 'server/index.mjs': 'export default {};', 'client/provider.js': 'export function mount() {}', 'client/styles.css': '.c{}' };
const integrity = Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, digest(bytes)]));
const declaration = { id: 'plugin.recharts', kind: 'chart', contractVersion: 1, kinds: ['bar', 'line', 'pie'], javascript: 'client/provider.js', stylesheet: 'client/styles.css' } as const;
const manifest = { id: 'charts', name: 'Charts', version: '0.1.0', sdkRange: '^0.1.0', engine: 1, tier: 'tier-3', capabilities: [], hooks: [], fields: [],
  integrity, browserProviders: [declaration] } as unknown as PluginManifest;
const approval: BundledBrowserProviderApproval = { pluginId: 'charts', version: '0.1.0', browserProviders: [declaration] as never, integrity: { ...integrity } };
const record = { id: 'charts', name: 'Charts', version: '0.1.0', source: 'built-in' as const, status: 'valid' as const, errors: [] };
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'jini-bp-matrix-'));
  for (const [file, bytes] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), bytes); }
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
const admit = (approvals: readonly BundledBrowserProviderApproval[], candidate: PluginManifest = manifest) =>
  admitBrowserProviderAssets({ record, manifest: candidate, pluginRoot: root, approvals });
const pinned = (patch: Record<string, unknown>) => ({ ...approval, browserProviders: [{ ...declaration, ...patch }] as never });

describe('approval must match the declaration exactly', () => {
  it('the exact pin is admitted (allow case)', async () => {
    const result = await admit([approval]);
    expect(result.admitted).toBe(true);
  });

  it.each([
    ['id', { id: 'plugin.other' }],
    ['kind', { kind: 'map' }],
    ['contractVersion', { contractVersion: 2 }],
    ['javascript', { javascript: 'client/other.js' }],
    ['stylesheet', { stylesheet: 'client/other.css' }],
    ['stylesheet absent in pin', { stylesheet: undefined }],
    ['kinds order', { kinds: ['line', 'bar', 'pie'] }],
    ['kinds subset', { kinds: ['bar', 'line'] }],
    ['kinds superset', { kinds: ['bar', 'line', 'pie', 'area'] }],
  ])('a pin differing only in %s is BROWSER_PROVIDER_FORBIDDEN', async (_label, patch) => {
    await expect(admit([pinned(patch)])).resolves.toEqual({ admitted: false, reason: 'BROWSER_PROVIDER_FORBIDDEN' });
  });

  it.each([
    ['an extra pinned provider', { ...approval, browserProviders: [declaration, { ...declaration, id: 'plugin.two' }] as never }],
    ['no pinned providers', { ...approval, browserProviders: [] }],
    ['another plugin id', { ...approval, pluginId: 'charts-evil' }],
    ['another version', { ...approval, version: '0.1.1' }],
  ])('%s is BROWSER_PROVIDER_FORBIDDEN', async (_label, candidate) => {
    await expect(admit([candidate])).resolves.toEqual({ admitted: false, reason: 'BROWSER_PROVIDER_FORBIDDEN' });
  });

  it('picks the approval for this plugin+version among several', async () => {
    const result = await admit([{ ...approval, version: '0.0.9', browserProviders: [] }, approval]);
    expect(result.admitted).toBe(true);
  });

  it('a non-built-in source is forbidden even with an exact pin', async () => {
    await expect(admitBrowserProviderAssets({ record: { ...record, source: 'site' as never }, manifest, pluginRoot: root, approvals: [approval] }))
      .resolves.toEqual({ admitted: false, reason: 'BROWSER_PROVIDER_FORBIDDEN' });
  });
});

describe('reviewed digests must equal the manifest digests', () => {
  it.each([
    ['one digest differs', { ...integrity, 'client/styles.css': digest('other') }],
    ['the pin has an extra file', { ...integrity, 'client/extra.js': digest('x') }],
    ['the pin lacks a file', Object.fromEntries(Object.entries(integrity).filter(([file]) => file !== 'server/index.mjs'))],
  ])('%s → INTEGRITY_FAILED', async (_label, pinnedIntegrity) => {
    await expect(admit([{ ...approval, integrity: pinnedIntegrity }])).resolves.toEqual({ admitted: false, reason: 'INTEGRITY_FAILED' });
  });

  it('admitted assets carry the reviewed digest and content type', async () => {
    const result = await admit([approval]);
    if (!result.admitted) throw new Error(result.reason);
    expect(result.providers[0]!.assets.map(({ path: file, digest: d, contentType }) => [file, d, contentType])).toEqual([
      ['client/provider.js', integrity['client/provider.js'], 'text/javascript'],
      ['client/styles.css', integrity['client/styles.css'], 'text/css'],
    ]);
    expect(result.providers[0]).toMatchObject({ pluginId: 'charts', version: '0.1.0', declaration: { ...declaration, kinds: ['bar', 'line', 'pie'] } });
    expect(Object.isFrozen(result.providers[0]!.declaration.kinds)).toBe(true);
  });
});
