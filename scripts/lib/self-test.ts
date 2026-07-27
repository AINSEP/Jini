/**
 * Guard self-test: proves `checkEngineBoundaries`/`checkProtocolPurity` still detect known-bad
 * fixtures before `pnpm guard` trusts their result against the real repo. This is the actual
 * "fail-closed" guarantee — not runtime introspection of whether a function "looks like a
 * stub," but a real assertion that the checks still work, run every time `pnpm guard` runs.
 * Exists because the 2026-07-19 swarm-consensus debate's single worst finding was that
 * `pnpm guard` printed "ok" unconditionally for weeks because both checks were literal
 * `return []` stubs — nobody noticed because nothing ever proved they worked in the first
 * place. If a future edit reintroduces that failure mode (or breaks the regex in a way that
 * silently stops matching), this self-test fails loudly instead.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEngineBoundaries } from '../check-engine-boundaries.js';
import { checkProtocolPurity } from '../check-protocol-purity.js';

function write(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function writePackage(
  root: string,
  directory: string,
  admission: 'locked' | 'incubating' = 'locked',
): void {
  write(
    root,
    `packages/${directory}/package.json`,
    JSON.stringify(
      {
        name: `@jini/${directory}`,
        jini: {
          domain: 'engine',
          kind: 'self-test-fixture',
          runtime: 'universal',
          admission,
        },
      },
      null,
      2,
    ),
  );
}

export interface SelfTestFailure {
  readonly expectation: string;
  readonly detail: string;
}

/**
 * Builds a throwaway fixture tree with one known-bad and one known-good case per rule, runs
 * both real checks against it, and returns every expectation that didn't hold. An empty array
 * means both checks are demonstrably still working.
 */
export async function runGuardSelfTest(): Promise<SelfTestFailure[]> {
  const root = mkdtempSync(join(tmpdir(), 'jini-guard-self-test-'));
  const failures: SelfTestFailure[] = [];

  try {
    for (const packageName of ['core', 'http', 'node-host', 'daemon', 'protocol']) {
      writePackage(root, packageName);
    }
    writePackage(root, 'metatool', 'incubating');
    write(root, 'packages/missing-metadata/package.json', '{"name":"@jini/missing-metadata"}\n');
    write(root, 'packages/missing-metadata/src/index.ts', 'export const missingMetadata = true;\n');

    // R1: relative import escaping into a forbidden top-level dir.
    write(root, 'packages/core/src/bad-r1.ts', `import { x } from '../../../examples/reference-web/foo.js';\nexport { x };\n`);
    // R2: deep cross-package relative reach, and a deep bare @jini/<name>/<subpath> import.
    write(root, 'packages/core/src/bad-r2-relative.ts', `import { x } from '../../daemon/src/foo.js';\nexport { x };\n`);
    write(root, 'packages/http/src/bad-r2-deep.ts', `import { x } from '@jini/daemon/dist/foo.js';\nexport { x };\n`);
    // R2 exemption: @jini/agentic/dom is the one other named-literal exception, alongside
    // @jini/core/internal — must NOT be flagged. A *different* subpath of the same package
    // (bad-r2-agentic-other-subpath.ts) proves the exemption is the exact literal, not a pattern
    // that swallows every @jini/agentic/* import.
    write(root, 'packages/http/src/ok-r2-agentic-dom.ts', `import { x } from '@jini/agentic/dom';\nexport { x };\n`);
    write(
      root,
      'packages/http/src/bad-r2-agentic-other-subpath.ts',
      `import { x } from '@jini/agentic/other';\nexport { x };\n`,
    );
    // R5: product-identity string + OD_ prefix.
    write(root, 'packages/core/src/bad-r5-string.ts', `export const NAME = 'Open Design';\n`);
    write(root, 'packages/core/src/bad-r5-prefix.ts', `export const OD_STAMP = 'x';\n`);
    // R6: value import of getToolRegistration from a non-daemon package.
    write(
      root,
      'packages/http/src/bad-r6.ts',
      `import { getToolRegistration } from '@jini/core/internal';\nexport { getToolRegistration };\n`,
    );
    // R6 exemption: same import, but type-only, from a non-daemon package — must NOT be flagged.
    write(
      root,
      'packages/node-host/src/ok-r6-type-only.ts',
      `import type { AnyPack } from '@jini/core/internal';\nexport type { AnyPack };\n`,
    );
    // R6 exemption: value import, but from daemon itself — must NOT be flagged.
    write(
      root,
      'packages/daemon/src/ok-r6-daemon.ts',
      `import { getToolRegistration } from '@jini/core/internal';\nexport { getToolRegistration };\n`,
    );
    // R7: locked package importing an unadmitted (incubating) package.
    // Mirror the production manifest's canonical scoped keys. The guard must
    // not rely on an unscoped fixture shape that real UNLOCKED.md never uses.
    write(root, 'UNLOCKED.md', '```json\n{"@jini/metatool": {"status": "incubating"}}\n```\n');
    // Use TSX specifically so the self-test also proves UI-heavy package sources are scanned.
    write(root, 'packages/core/src/bad-r7.tsx', `import { x } from '@jini/metatool';\nexport { x };\n`);
    // Known-good: ordinary same-package relative import and bare package import — must NOT be flagged.
    write(root, 'packages/core/src/ok-relative.ts', `export const x = 1;\n`);
    write(
      root,
      'packages/core/src/ok-same-package.ts',
      `import { x } from './ok-relative.js';\nexport { x };\n`,
    );
    write(root, 'packages/http/src/ok-bare.ts', `import { createDaemon } from '@jini/core';\nexport { createDaemon };\n`);
    // Known-good: a provenance-citing doc comment (this codebase's real convention) must NOT
    // be parsed as a live import or a live product-identity string — regression test for the
    // false-positive `pnpm guard` actually produced on its first real run against this repo.
    write(
      root,
      'packages/core/src/ok-provenance-comment.ts',
      [
        '/**',
        " * Ported from Open Design's `apps/daemon/src/foo.ts`. The origin imported",
        " * `import { x } from '../../../apps/legacy.js'` and read an `OD_LEGACY_FLAG` env var;",
        ' * both were removed during de-branding.',
        ' */',
        'export const clean = true;',
        '',
      ].join('\n'),
    );

    // R3: protocol importing another @jini/* package, and protocol reaching into foundry/.
    write(root, 'packages/protocol/src/bad-r3-jini-import.ts', `import { x } from '@jini/core';\nexport { x };\n`);
    write(
      root,
      'packages/protocol/src/bad-r3-boundary.ts',
      `import { x } from '../../../foundry/integrations/foo.js';\nexport { x };\n`,
    );
    write(root, 'packages/protocol/src/ok-protocol.ts', `export const wireType = 1;\n`);

    const engineViolations = await checkEngineBoundaries({ repoRoot: root });
    const protocolViolations = await checkProtocolPurity({ repoRoot: root });

    const has = (violations: { rule: string; file: string }[], rule: string, fileSuffix: string) =>
      violations.some((v) => v.rule === rule && v.file.endsWith(fileSuffix));

    const expectations: Array<[boolean, string]> = [
      [has(engineViolations, 'R1-boundary', 'bad-r1.ts'), 'R1 should catch a relative import escaping into foundry/'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-relative.ts'), 'R2 should catch a relative import reaching into another package'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-deep.ts'), 'R2 should catch a deep bare @jini/<name>/<subpath> import'],
      [!has(engineViolations, 'R2-deep-path', 'ok-r2-agentic-dom.ts'), 'R2 must NOT flag the gated @jini/agentic/dom import'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-agentic-other-subpath.ts'), 'R2 should still catch a DIFFERENT @jini/agentic/<subpath> — the exemption is the exact literal, not a pattern'],
      [has(engineViolations, 'R5-neutrality', 'bad-r5-string.ts'), 'R5 should catch a product-identity string'],
      [has(engineViolations, 'R5-neutrality', 'bad-r5-prefix.ts'), 'R5 should catch an OD_ prefixed identifier'],
      [has(engineViolations, 'R6-internal-leak', 'bad-r6.ts'), 'R6 should catch a value import of getToolRegistration outside daemon'],
      [!has(engineViolations, 'R6-internal-leak', 'ok-r6-type-only.ts'), 'R6 must NOT flag a type-only import of @jini/core/internal'],
      [!has(engineViolations, 'R6-internal-leak', 'ok-r6-daemon.ts'), 'R6 must NOT flag a value import from inside @jini/daemon itself'],
      [has(engineViolations, 'R7-sprawl', 'bad-r7.tsx'), 'R7 should catch a locked package importing an unadmitted package from TSX'],
      [has(engineViolations, 'R8-package-metadata', 'packages/missing-metadata/package.json'), 'R8 should catch missing package classification metadata'],
      [!engineViolations.some((v) => v.file.endsWith('ok-same-package.ts')), 'R1/R2 must NOT flag an ordinary same-package relative import'],
      [!engineViolations.some((v) => v.file.endsWith('ok-bare.ts')), 'R2 must NOT flag an ordinary bare @jini/<name> import'],
      [!engineViolations.some((v) => v.file.endsWith('ok-provenance-comment.ts')), 'R1/R2/R5 must NOT flag a provenance-citing doc comment as a live import or product-identity string'],
      [has(protocolViolations, 'R3-protocol-purity', 'bad-r3-jini-import.ts'), 'R3 should catch protocol importing another @jini/* package'],
      [has(protocolViolations, 'R3-protocol-purity', 'bad-r3-boundary.ts'), 'R3 should catch protocol reaching into foundry/'],
      [!protocolViolations.some((v) => v.file.endsWith('ok-protocol.ts')), 'R3 must NOT flag ordinary protocol-local code'],
    ];

    for (const [holds, expectation] of expectations) {
      if (!holds) {
        failures.push({ expectation, detail: 'fixture-based assertion failed — see scripts/lib/self-test.ts' });
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  return failures;
}
