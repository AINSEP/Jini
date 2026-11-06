import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const release = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('../check-plugin-packages.js', () => ({ checkPluginReleaseConsistency: release.check }));
vi.mock('../lib/pack-jini-packages.js', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/pack-jini-packages.js')>(),
  discoverJiniPackages: () => new Map(),
}));
import { main } from '../publish-pending.js';

let scratch: string; let summary: string;
const argv = process.argv;
const previousSummary = process.env.GITHUB_STEP_SUMMARY;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'jini-publish-summary-'));
  summary = join(scratch, 'summary.md');
  process.env.GITHUB_STEP_SUMMARY = summary;
  process.argv = ['node', 'publish-pending.ts'];
  release.check.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  process.argv = argv;
  if (previousSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = previousSummary;
  rmSync(scratch, { recursive: true, force: true });
});

it('writes the step summary for a read-only publication plan', async () => {
  process.argv.push('--plan');
  await main();
  expect(existsSync(summary)).toBe(true);
  expect(readFileSync(summary, 'utf8')).toContain('npm publish');
  expect(release.check).not.toHaveBeenCalled();
});

it('writes a stopped result when release consistency fails before any upload', async () => {
  release.check.mockRejectedValue(new Error('Catalog fixture mismatch'));
  await expect(main()).rejects.toThrow('Catalog fixture mismatch');
  expect(existsSync(summary)).toBe(true);
  expect(readFileSync(summary, 'utf8')).toContain('stopped');
});
