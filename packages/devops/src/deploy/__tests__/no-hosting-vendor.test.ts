import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as deploy from '../index.js';

/**
 * Guard for the 0.4.0 boundary: `@jini-ai/devops` ships the generic deploy seam
 * (`DeployTarget`, `DeployTargetToken`, `deploy.publish`, the host-kit types) and no
 * hosting vendor. Vendor targets live in host-owned deployment plugins and
 * reach this package only through `DeployTargetModule`/`DeployHostKit`.
 *
 * Scans every file under `packages/devops/src` (code, comments and tests alike) for a
 * hosting-vendor name or host. This file is the one exemption, since it has to spell
 * the names it bans. Source-control names (plain "GitHub") are deliberately not banned:
 * `./source-control` is an independent sibling capability.
 */
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = fileURLToPath(import.meta.url);

const HOSTING_VENDOR = new RegExp(
  [
    'vercel',
    'netlify',
    'cloudflare',
    'github[\\s_-]*pages',
    'github\\.io',
    'api\\.github\\.com',
    'fly\\.io',
    'flyio',
    'railway',
    'render\\.com',
    'onrender',
    'surge\\.sh',
    'heroku',
    'firebase',
  ].join('|'),
  'i',
);

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

describe('@jini-ai/devops names no hosting vendor', () => {
  it('scans a non-empty source tree (the guard cannot pass vacuously)', () => {
    const files = listFiles(SRC_ROOT);
    expect(files.some((file) => file.endsWith(join('deploy', 'tool.ts')))).toBe(true);
    expect(files).toContain(SELF);
  });

  it('has no hosting-vendor name or host in any file under src', () => {
    const hits = listFiles(SRC_ROOT)
      .filter((file) => file !== SELF)
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, index) =>
            HOSTING_VENDOR.test(line) ? [`${relative(SRC_ROOT, file)}:${index + 1}: ${line.trim()}`] : [],
          ),
      );
    expect(hits).toEqual([]);
  });

  it('the pattern catches a vendor name, so an empty hit list means something', () => {
    expect(HOSTING_VENDOR.test('new VercelDeployTarget(config)')).toBe(true);
    expect(HOSTING_VENDOR.test("targetId: 'github-pages'")).toBe(true);
    expect(HOSTING_VENDOR.test('https://site.example.app')).toBe(false);
  });

  it('exports no vendor symbol from the deploy barrel', () => {
    expect(Object.keys(deploy).filter((name) => HOSTING_VENDOR.test(name))).toEqual([]);
  });
});
