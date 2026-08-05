// Milestone 1 red-spec ("Harnesses + sync-ownership manifest") — gate N:
// "`examples/minimal-host` installs only packed `@jini-ai/*` tarballs, OD-noun/
// import ban" and "health-boot from tarballs" (ADS-memory/reports/jini-port/extraction-plan.md
// §7, §8 task 1).
//
// Nothing under test here exists yet — this file PINS the target behavior for
// `m1-impl` and must go green without editing these assertions:
//
//   `scripts/health-boot.ts`, run as `tsx scripts/health-boot.ts` from the repo
//   root, must: pack every `@jini-ai/*` dependency of examples/minimal-host into
//   tarballs, install those tarballs (never a workspace link) into a scratch
//   copy of examples/minimal-host, boot/run its entry point from there, and
//   print one JSON line to stdout: `{ ok: true, marker: 'HEALTH_BOOT_OK',
//   packedTarballs: string[] }` where `packedTarballs` is non-empty and every
//   entry ends in `.tgz`.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const harnessScript = path.join(repoRoot, 'scripts/health-boot.ts');

describe('milestone 1 gate N — health-boot from packed @jini-ai/* tarballs', () => {
  it('ships a health-boot harness script', () => {
    expect(existsSync(harnessScript)).toBe(true);
  });

  it('boots examples/minimal-host from packed tarballs, not workspace links', () => {
    if (!existsSync(harnessScript)) {
      throw new Error(
        'scripts/health-boot.ts does not exist yet — milestone 1 impl must add the ' +
          'pack+install+boot harness. See ADS-memory/reports/jini-port/extraction-plan.md §7 + §8 task 1.',
      );
    }

    const raw = execFileSync('tsx', [harnessScript], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const lastLine = raw.split('\n').filter(Boolean).pop();
    if (!lastLine) throw new Error('health-boot harness produced no stdout');

    const report = JSON.parse(lastLine);
    expect(report.ok).toBe(true);
    expect(report.marker).toBe('HEALTH_BOOT_OK');
    expect(Array.isArray(report.packedTarballs)).toBe(true);
    expect(report.packedTarballs.length).toBeGreaterThan(0);
    for (const tarball of report.packedTarballs) {
      expect(tarball).toMatch(/\.tgz$/);
    }
  });
});
