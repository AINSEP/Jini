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
import { checkAgenticDomPurity } from '../check-agentic-dom-purity.js';
import { checkEngineBoundaries } from '../check-engine-boundaries.js';
import { checkProtocolPurity } from '../check-protocol-purity.js';

function write(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function writePackage(root: string, directory: string): void {
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
        },
      },
      null,
      2,
    ),
  );
}

/** Writes a package.json exercising the optional `jini.entries` extension (R8) — see
 * `check-engine-boundaries.ts`'s module doc "Extension (2026-07-26...)". `exportsMap` and
 * `entries` are passed through verbatim (including deliberately-broken shapes) so the caller
 * controls exactly what mismatch, if any, is under test. */
function writePackageWithEntries(
  root: string,
  directory: string,
  exportsMap: Record<string, unknown>,
  entries: Record<string, unknown>,
  runtime = 'universal',
): void {
  write(
    root,
    `packages/${directory}/package.json`,
    JSON.stringify(
      {
        name: `@jini/${directory}`,
        exports: exportsMap,
        jini: {
          domain: 'agent',
          kind: 'self-test-fixture',
          runtime,
          entries,
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
    write(root, 'packages/missing-metadata/package.json', '{"name":"@jini/missing-metadata"}\n');
    write(root, 'packages/missing-metadata/src/index.ts', 'export const missingMetadata = true;\n');

    // R8 jini.entries extension: a package whose entries exactly match its exports (good), one
    // whose entries disagree with exports in BOTH directions at once (a typo'd key the exports
    // map doesn't have, and a real export subpath entries forgot to cover), and one whose
    // entries["."] disagrees with the top-level runtime field.
    writePackageWithEntries(
      root,
      'entries-ok',
      { '.': { types: './dist/index.d.ts' }, './dom': { types: './dist/dom/index.d.ts' } },
      { '.': 'universal', './dom': 'browser' },
    );
    writePackageWithEntries(
      root,
      'entries-mismatch',
      { '.': { types: './dist/index.d.ts' }, './dom': { types: './dist/dom/index.d.ts' } },
      { '.': 'universal', './missing': 'browser' },
    );
    writePackageWithEntries(
      root,
      'entries-root-disagrees',
      { '.': { types: './dist/index.d.ts' } },
      { '.': 'browser' },
      'universal',
    );

    // R1: relative import escaping into a forbidden top-level dir. `.tsx`, not `.ts` — R7's
    // fixture used to be the thing proving UI-heavy (.tsx) package sources get scanned at all;
    // that coverage moves here rather than disappearing along with R7 itself.
    write(root, 'packages/core/src/bad-r1.tsx', `import { x } from '../../../examples/reference-web/foo.js';\nexport { x };\n`);
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

    // R9: DOM-purity guard fixtures for `checkAgenticDomPurity` — one tsconfig pair per case,
    // deliberately OUTSIDE `packages/` (a top-level `dom-purity-fixtures/` dir instead) so they
    // are never swept up by `checkEngineBoundaries`'s own `packages/` walk above, which would
    // otherwise flag each as "missing package.json" noise unrelated to what this is testing.
    // `checkAgenticDomPurity`'s `agenticDir` option is independent of `packagesDir`, so this is
    // safe. Mirrors the real `packages/agentic/tsconfig{.dom}.json` shape exactly, including the
    // `extends` chain, so a regression in the extends-resolution logic itself would also be caught.
    write(root, 'tsconfig.base.json', JSON.stringify({ compilerOptions: { lib: ['ES2023'] } }, null, 2));
    const GOOD_ROOT_TSCONFIG = {
      extends: '../../tsconfig.base.json',
      include: ['src'],
      exclude: ['src/dom'],
    };
    const GOOD_DOM_TSCONFIG = {
      extends: '../../tsconfig.base.json',
      compilerOptions: { lib: ['ES2023', 'DOM', 'DOM.Iterable'] },
      include: ['src/dom'],
    };
    function writeDomPurityFixture(
      caseName: string,
      rootTsconfig: Record<string, unknown>,
      domTsconfig: Record<string, unknown>,
    ): void {
      write(root, `dom-purity-fixtures/${caseName}/tsconfig.json`, JSON.stringify(rootTsconfig, null, 2));
      write(root, `dom-purity-fixtures/${caseName}/tsconfig.dom.json`, JSON.stringify(domTsconfig, null, 2));
    }
    writeDomPurityFixture('good', GOOD_ROOT_TSCONFIG, GOOD_DOM_TSCONFIG);
    // Known-bad: root config no longer excludes src/dom.
    writeDomPurityFixture('bad-exclude-removed', { ...GOOD_ROOT_TSCONFIG, exclude: [] }, GOOD_DOM_TSCONFIG);
    // Known-bad: a DOM lib leaks into the root (DOM-free) config directly.
    writeDomPurityFixture(
      'bad-lib-leak',
      { ...GOOD_ROOT_TSCONFIG, compilerOptions: { lib: ['ES2023', 'DOM'] } },
      GOOD_DOM_TSCONFIG,
    );
    // Known-bad: the DOM config widens `include` to cover the whole package, not just src/dom.
    writeDomPurityFixture('bad-dom-widened', GOOD_ROOT_TSCONFIG, { ...GOOD_DOM_TSCONFIG, include: ['src'] });
    // Known-bad: the DOM config loses its own DOM lib (would break src/dom, not just the split).
    writeDomPurityFixture('bad-dom-lib-missing', GOOD_ROOT_TSCONFIG, {
      ...GOOD_DOM_TSCONFIG,
      compilerOptions: { lib: ['ES2023'] },
    });

    const engineViolations = await checkEngineBoundaries({ repoRoot: root });
    const protocolViolations = await checkProtocolPurity({ repoRoot: root });
    const domPurityGood = await checkAgenticDomPurity({
      repoRoot: root,
      agenticDir: join(root, 'dom-purity-fixtures', 'good'),
    });
    const domPurityBadExclude = await checkAgenticDomPurity({
      repoRoot: root,
      agenticDir: join(root, 'dom-purity-fixtures', 'bad-exclude-removed'),
    });
    const domPurityBadLibLeak = await checkAgenticDomPurity({
      repoRoot: root,
      agenticDir: join(root, 'dom-purity-fixtures', 'bad-lib-leak'),
    });
    const domPurityBadDomWidened = await checkAgenticDomPurity({
      repoRoot: root,
      agenticDir: join(root, 'dom-purity-fixtures', 'bad-dom-widened'),
    });
    const domPurityBadDomLibMissing = await checkAgenticDomPurity({
      repoRoot: root,
      agenticDir: join(root, 'dom-purity-fixtures', 'bad-dom-lib-missing'),
    });

    const has = (violations: { rule: string; file: string }[], rule: string, fileSuffix: string) =>
      violations.some((v) => v.rule === rule && v.file.endsWith(fileSuffix));

    const expectations: Array<[boolean, string]> = [
      [has(engineViolations, 'R1-boundary', 'bad-r1.tsx'), 'R1 should catch a relative import escaping into foundry/ (also proves .tsx sources are scanned)'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-relative.ts'), 'R2 should catch a relative import reaching into another package'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-deep.ts'), 'R2 should catch a deep bare @jini/<name>/<subpath> import'],
      [!has(engineViolations, 'R2-deep-path', 'ok-r2-agentic-dom.ts'), 'R2 must NOT flag the gated @jini/agentic/dom import'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-agentic-other-subpath.ts'), 'R2 should still catch a DIFFERENT @jini/agentic/<subpath> — the exemption is the exact literal, not a pattern'],
      [has(engineViolations, 'R5-neutrality', 'bad-r5-string.ts'), 'R5 should catch a product-identity string'],
      [has(engineViolations, 'R5-neutrality', 'bad-r5-prefix.ts'), 'R5 should catch an OD_ prefixed identifier'],
      [has(engineViolations, 'R6-internal-leak', 'bad-r6.ts'), 'R6 should catch a value import of getToolRegistration outside daemon'],
      [!has(engineViolations, 'R6-internal-leak', 'ok-r6-type-only.ts'), 'R6 must NOT flag a type-only import of @jini/core/internal'],
      [!has(engineViolations, 'R6-internal-leak', 'ok-r6-daemon.ts'), 'R6 must NOT flag a value import from inside @jini/daemon itself'],
      [has(engineViolations, 'R8-package-metadata', 'packages/missing-metadata/package.json'), 'R8 should catch missing package classification metadata'],
      [
        !engineViolations.some((v) => v.file.endsWith('entries-ok/package.json')),
        'R8 must NOT flag jini.entries that exactly match the exports map',
      ],
      [
        engineViolations.some(
          (v) =>
            v.file.endsWith('entries-mismatch/package.json') &&
            v.reason.includes('./missing') &&
            v.reason.includes('no matching "exports" subpath'),
        ),
        'R8 should catch a jini.entries key with no matching exports subpath',
      ],
      [
        engineViolations.some(
          (v) =>
            v.file.endsWith('entries-mismatch/package.json') &&
            v.reason.includes('./dom') &&
            v.reason.includes('no matching jini.entries key'),
        ),
        'R8 should catch an exports subpath with no matching jini.entries key',
      ],
      [
        engineViolations.some(
          (v) => v.file.endsWith('entries-root-disagrees/package.json') && v.reason.includes('disagrees with jini.runtime'),
        ),
        'R8 should catch jini.entries["."] disagreeing with the top-level jini.runtime',
      ],
      [!engineViolations.some((v) => v.file.endsWith('ok-same-package.ts')), 'R1/R2 must NOT flag an ordinary same-package relative import'],
      [!engineViolations.some((v) => v.file.endsWith('ok-bare.ts')), 'R2 must NOT flag an ordinary bare @jini/<name> import'],
      [!engineViolations.some((v) => v.file.endsWith('ok-provenance-comment.ts')), 'R1/R2/R5 must NOT flag a provenance-citing doc comment as a live import or product-identity string'],
      [has(protocolViolations, 'R3-protocol-purity', 'bad-r3-jini-import.ts'), 'R3 should catch protocol importing another @jini/* package'],
      [has(protocolViolations, 'R3-protocol-purity', 'bad-r3-boundary.ts'), 'R3 should catch protocol reaching into foundry/'],
      [!protocolViolations.some((v) => v.file.endsWith('ok-protocol.ts')), 'R3 must NOT flag ordinary protocol-local code'],
      [domPurityGood.length === 0, 'R9 must NOT flag a correctly-shaped agentic tsconfig.json/tsconfig.dom.json pair'],
      [
        domPurityBadExclude.some((v) => v.rule === 'R9-dom-purity' && v.reason.includes('no longer excludes')),
        'R9 should catch the root tsconfig no longer excluding src/dom',
      ],
      [
        domPurityBadLibLeak.some((v) => v.rule === 'R9-dom-purity' && v.reason.includes('DOM entry') && v.file.endsWith('tsconfig.json')),
        'R9 should catch a DOM lib leaking into the root (DOM-free) tsconfig',
      ],
      [
        domPurityBadDomWidened.some((v) => v.rule === 'R9-dom-purity' && v.reason.includes('covers more than')),
        'R9 should catch the DOM tsconfig widening include beyond src/dom',
      ],
      [
        domPurityBadDomLibMissing.some((v) => v.rule === 'R9-dom-purity' && v.file.endsWith('tsconfig.dom.json') && v.reason.includes('no longer includes a DOM entry')),
        'R9 should catch the DOM tsconfig losing its own DOM lib',
      ],
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
