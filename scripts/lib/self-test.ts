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
import { checkChatPanePublicSurface } from '../check-chatpane-public-surface.js';
import { checkEngineBoundaries } from '../check-engine-boundaries.js';
import { checkExtensionlessImports } from '../check-extensionless-imports.js';
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
        name: `@jini-ai/${directory}`,
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
        name: `@jini-ai/${directory}`,
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
    for (const packageName of ['core', 'http-kit', 'server', 'daemon', 'protocol', 'ui', 'agent-runtime']) {
      writePackage(root, packageName);
    }
    write(root, 'packages/missing-metadata/package.json', '{"name":"@jini-ai/missing-metadata"}\n');
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
    // R2: deep cross-package relative reach, and a deep bare @jini-ai/<name>/<subpath> import.
    write(root, 'packages/core/src/bad-r2-relative.ts', `import { x } from '../../daemon/src/foo.js';\nexport { x };\n`);
    write(root, 'packages/http-kit/src/bad-r2-deep.ts', `import { x } from '@jini-ai/daemon/dist/foo.js';\nexport { x };\n`);
    // R2 exemption: @jini-ai/agentic/dom and @jini-ai/agentic/a2ui are the other named-literal
    // exceptions, alongside @jini-ai/core/internal — must NOT be flagged. A *different* subpath of
    // the same package (bad-r2-agentic-other-subpath.ts) proves the exemption is the exact literal,
    // not a pattern that swallows every @jini-ai/agentic/* import.
    write(root, 'packages/http-kit/src/ok-r2-agentic-dom.ts', `import { x } from '@jini-ai/agentic/dom';\nexport { x };\n`);
    write(root, 'packages/http-kit/src/ok-r2-agentic-a2ui.ts', `import { x } from '@jini-ai/agentic/a2ui';\nexport { x };\n`);
    write(
      root,
      'packages/http-kit/src/bad-r2-agentic-other-subpath.ts',
      `import { x } from '@jini-ai/agentic/other';\nexport { x };\n`,
    );
    // R2 exception #4 (@jini-ai/ui/mcp-ui) — same shape: must NOT be flagged, but a DIFFERENT
    // subpath of the same package must still be caught, proving the exact-literal, not-a-pattern
    // property one more time.
    write(root, 'packages/http-kit/src/ok-r2-ui-mcp-ui.ts', `import { x } from '@jini-ai/ui/mcp-ui';\nexport { x };\n`);
    write(
      root,
      'packages/http-kit/src/bad-r2-ui-other-subpath.ts',
      `import { x } from '@jini-ai/ui/other';\nexport { x };\n`,
    );
    // R2 exception #5 (endpoint-policy.parity.test.ts's relative reach into agent-runtime/src) —
    // named on BOTH the exact file and the exact resolved target, not either alone. Three cases,
    // two of them from THIS SAME real fixture file (can't duplicate the literal path, so the
    // "different target" case is a second import statement in the one file that holds the exempt
    // import): the real file+target combo (must NOT be flagged); the same file reaching a
    // DIFFERENT target in the same other package (must still be flagged — the target is part of
    // the gate, not just the file); and a DIFFERENT file making the identical reach (must still be
    // flagged — the file is part of the gate, not just the target).
    write(
      root,
      'packages/ui/src/__tests__/utils/endpoint-policy.parity.test.ts',
      [
        "import { x } from '../../../../agent-runtime/src/providers/connection-guard.js';",
        "import { y } from '../../../../agent-runtime/src/some-other-file.js';",
        'export { x, y };',
      ].join('\n') + '\n',
    );
    write(
      root,
      'packages/ui/src/__tests__/utils/bad-r2-different-file-same-target.test.ts',
      `import { x } from '../../../../agent-runtime/src/providers/connection-guard.js';\nexport { x };\n`,
    );
    // R5: product-identity string + OD_ prefix.
    write(root, 'packages/core/src/bad-r5-string.ts', `export const NAME = 'Open Design';\n`);
    write(root, 'packages/core/src/bad-r5-prefix.ts', `export const OD_STAMP = 'x';\n`);
    // R6: value import of authorizeToolInvocation from a non-daemon package.
    write(
      root,
      'packages/http-kit/src/bad-r6.ts',
      `import { authorizeToolInvocation } from '@jini-ai/core/internal';\nexport { authorizeToolInvocation };\n`,
    );
    // R6 exemption: same import, but type-only, from a non-daemon package — must NOT be flagged.
    write(
      root,
      'packages/server/src/ok-r6-type-only.ts',
      `import type { AnyPack } from '@jini-ai/core/internal';\nexport type { AnyPack };\n`,
    );
    // R6 exemption: value import, but from daemon itself — must NOT be flagged.
    write(
      root,
      'packages/daemon/src/ok-r6-daemon.ts',
      `import { authorizeToolInvocation } from '@jini-ai/core/internal';\nexport { authorizeToolInvocation };\n`,
    );
    // Known-good: ordinary same-package relative import and bare package import — must NOT be flagged.
    write(root, 'packages/core/src/ok-relative.ts', `export const x = 1;\n`);
    write(
      root,
      'packages/core/src/ok-same-package.ts',
      `import { x } from './ok-relative.js';\nexport { x };\n`,
    );
    write(root, 'packages/http-kit/src/ok-bare.ts', `import { createDaemon } from '@jini-ai/core';\nexport { createDaemon };\n`);
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

    // R3: protocol importing another @jini-ai/* package, and protocol reaching into foundry/.
    write(root, 'packages/protocol/src/bad-r3-jini-import.ts', `import { x } from '@jini-ai/core';\nexport { x };\n`);
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

    // R10 (REF-001 Step D, disabled/reporting-only): synthetic barrel + synthetic privileged
    // composition, deliberately OUTSIDE packages/ (like the R9 tsconfig fixtures above) so
    // checkEngineBoundaries's own packages/ walk doesn't sweep these up as unrelated noise, and
    // deliberately NOT the real (concurrently-edited) features/chat-pane/** tree — see
    // check-chatpane-public-surface.ts's own module doc.
    write(
      root,
      'r10-fixtures/public-barrel.ts',
      [
        "export { PublicThing } from './module.js';",
        "export { Bar } from './aliased.js';",
        "export type { PublicType } from './types.js';",
      ].join('\n') + '\n',
    );
    write(
      root,
      'r10-fixtures/chat-pane/components/ChatPane.tsx',
      [
        // Escapes chat-pane/, both names public and non-public — proves per-name granularity
        // within a single clause, not just per-import.
        "import { PublicThing, PrivateThing } from '../../public/module.js';",
        // Escapes chat-pane/, type-only clause.
        "import type { PublicType, PrivateType } from '../../public/types.js';",
        // Escapes chat-pane/, aliased import — the consumer-facing name (Bar) is public.
        "import { Foo as Bar } from '../../public/aliased.js';",
        // Escapes chat-pane/, aliased import — the consumer-facing name (Baz) is NOT public.
        "import { Foo as Baz } from '../../public/aliased2.js';",
        // Does NOT escape chat-pane/ — a same-subtree relative import, must never be flagged
        // regardless of whether LocalHelper is in the barrel (it deliberately is not).
        "import { LocalHelper } from '../local-helper.js';",
        'export const ChatPane = { PublicThing, PrivateThing, PublicType, PrivateType, Bar, Baz, LocalHelper };',
      ].join('\n') + '\n',
    );
    // A __tests__/ file reaching for a non-public name via an escaping import must NOT be
    // flagged — a package's own test suite reaching for a shared test double (e.g. a fake
    // transport) answers a different question than "does ChatPane's production code do
    // something a consumer can't." See check-chatpane-public-surface.ts's own module doc.
    write(
      root,
      'r10-fixtures/chat-pane/__tests__/ChatPane.test.tsx',
      "import { PrivateTestOnlyThing } from '../../public/test-only.js';\nexport { PrivateTestOnlyThing };\n",
    );

    // R11: extensionless relative ESM import detection. Deliberately OUTSIDE packages/ (like the
    // R9/R10 fixtures above), in its own `r11-fixtures/` dir standing in for a `packages/` root —
    // checkExtensionlessImports takes packagesDir as an option for exactly this reason.
    write(
      root,
      'r11-fixtures/pkg-a/src/sibling.ts',
      'export const sibling = 1;\n',
    );
    write(root, 'r11-fixtures/pkg-a/src/subdir/index.ts', 'export const fromDir = 1;\n');
    // Known-bad: extensionless import of a real sibling FILE — must be flagged, and the hint must
    // suggest ".js" (not "/index.js"), since `sibling.ts` exists but `sibling/index.ts` doesn't.
    write(
      root,
      'r11-fixtures/pkg-a/src/bad-no-ext-file.ts',
      "import { sibling } from './sibling';\nexport { sibling };\n",
    );
    // Known-bad: extensionless import that actually names a DIRECTORY (subdir/index.ts exists,
    // subdir.ts/subdir.tsx don't) — must be flagged, and the hint must suggest "/index.js".
    write(
      root,
      'r11-fixtures/pkg-a/src/bad-no-ext-dir.ts',
      "import { fromDir } from './subdir';\nexport { fromDir };\n",
    );
    // Known-good: same shape, but already has the extension — must NOT be flagged.
    write(
      root,
      'r11-fixtures/pkg-a/src/ok-with-ext.ts',
      "import { sibling } from './sibling.js';\nexport { sibling };\n",
    );
    // Known-good: a bare package specifier is never in scope for this rule, extension or not.
    write(
      root,
      'r11-fixtures/pkg-a/src/ok-bare.ts',
      "import { createDaemon } from '@jini-ai/core';\nexport { createDaemon };\n",
    );
    // Regression fixture for the false-positive this check was explicitly built to avoid (see its
    // own module doc): import-shaped syntax living inside a STRING LITERAL, not a real import —
    // mirrors the real `packages/mcp/src/client/__tests__/client.test.ts` case this investigation
    // found. Must NOT be flagged; proves the line-start anchor, not just documents the intent.
    write(
      root,
      'r11-fixtures/pkg-a/src/__tests__/ok-string-literal-lookalike.test.ts',
      [
        "import { describe, expect, it } from 'vitest';",
        "describe('parseThing', () => {",
        "  it('recognizes an import-shaped string as data, not code', () => {",
        "    expect(parseThing(\"import x from './not-real'\", 'a.ts')).toEqual(['not-real']);",
        '  });',
        '});',
      ].join('\n') + '\n',
    );
    // R11 tsconfig-exclude respect: pkg-b's own tsconfig.json excludes src/vendor/** (mirroring
    // the real packages/agent-runtime's exclusion of its vendored, separately-built Remotion
    // template — see this check's own module doc). An extensionless import under the excluded
    // subtree must NOT be flagged; the same shape just outside it must still be flagged, proving
    // the exclusion is scoped to that directory, not silently swallowing the whole package.
    write(
      root,
      'r11-fixtures/pkg-b/tsconfig.json',
      JSON.stringify({ include: ['src'], exclude: ['src/vendor/**'] }, null, 2),
    );
    write(
      root,
      'r11-fixtures/pkg-b/src/vendor/template/bad-but-excluded.ts',
      "import { x } from './other';\nexport { x };\n",
    );
    write(
      root,
      'r11-fixtures/pkg-b/src/normal-bad-no-ext.ts',
      "import { x } from './other';\nexport { x };\n",
    );

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
    const chatPaneViolations = await checkChatPanePublicSurface({
      repoRoot: root,
      chatPaneDir: join(root, 'r10-fixtures', 'chat-pane'),
      barrelPath: join(root, 'r10-fixtures', 'public-barrel.ts'),
    });
    const extensionlessViolations = await checkExtensionlessImports({
      repoRoot: root,
      packagesDir: join(root, 'r11-fixtures'),
    });

    const has = (violations: { rule: string; file: string }[], rule: string, fileSuffix: string) =>
      violations.some((v) => v.rule === rule && v.file.endsWith(fileSuffix));

    const expectations: Array<[boolean, string]> = [
      [has(engineViolations, 'R1-boundary', 'bad-r1.tsx'), 'R1 should catch a relative import escaping into foundry/ (also proves .tsx sources are scanned)'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-relative.ts'), 'R2 should catch a relative import reaching into another package'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-deep.ts'), 'R2 should catch a deep bare @jini-ai/<name>/<subpath> import'],
      [!has(engineViolations, 'R2-deep-path', 'ok-r2-agentic-dom.ts'), 'R2 must NOT flag the gated @jini-ai/agentic/dom import'],
      [!has(engineViolations, 'R2-deep-path', 'ok-r2-agentic-a2ui.ts'), 'R2 must NOT flag the gated @jini-ai/agentic/a2ui import'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-agentic-other-subpath.ts'), 'R2 should still catch a DIFFERENT @jini-ai/agentic/<subpath> — the exemption is the exact literal, not a pattern'],
      [!has(engineViolations, 'R2-deep-path', 'ok-r2-ui-mcp-ui.ts'), 'R2 must NOT flag the gated @jini-ai/ui/mcp-ui import'],
      [has(engineViolations, 'R2-deep-path', 'bad-r2-ui-other-subpath.ts'), 'R2 should still catch a DIFFERENT @jini-ai/ui/<subpath> — the exemption is the exact literal, not a pattern'],
      [
        !engineViolations.some((v) => v.file.endsWith('endpoint-policy.parity.test.ts') && v.reason.includes('connection-guard.js')),
        'R2 must NOT flag endpoint-policy.parity.test.ts\'s documented relative reach into agent-runtime/src/providers/connection-guard.js',
      ],
      [
        engineViolations.some((v) => v.file.endsWith('endpoint-policy.parity.test.ts') && v.reason.includes('some-other-file.js')),
        'R2 should still catch the SAME file reaching a DIFFERENT target in agent-runtime — the exact resolved target is part of the gate, not just the file',
      ],
      [
        has(engineViolations, 'R2-deep-path', 'bad-r2-different-file-same-target.test.ts'),
        'R2 should still catch a DIFFERENT file making the identical reach into connection-guard.js — the exact file is part of the gate, not just the target',
      ],
      [has(engineViolations, 'R5-neutrality', 'bad-r5-string.ts'), 'R5 should catch a product-identity string'],
      [has(engineViolations, 'R5-neutrality', 'bad-r5-prefix.ts'), 'R5 should catch an OD_ prefixed identifier'],
      [has(engineViolations, 'R6-internal-leak', 'bad-r6.ts'), 'R6 should catch a value import of authorizeToolInvocation outside daemon'],
      [!has(engineViolations, 'R6-internal-leak', 'ok-r6-type-only.ts'), 'R6 must NOT flag a type-only import of @jini-ai/core/internal'],
      [!has(engineViolations, 'R6-internal-leak', 'ok-r6-daemon.ts'), 'R6 must NOT flag a value import from inside @jini-ai/daemon itself'],
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
      [!engineViolations.some((v) => v.file.endsWith('ok-bare.ts')), 'R2 must NOT flag an ordinary bare @jini-ai/<name> import'],
      [!engineViolations.some((v) => v.file.endsWith('ok-provenance-comment.ts')), 'R1/R2/R5 must NOT flag a provenance-citing doc comment as a live import or product-identity string'],
      [has(protocolViolations, 'R3-protocol-purity', 'bad-r3-jini-import.ts'), 'R3 should catch protocol importing another @jini-ai/* package'],
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
      [
        has(chatPaneViolations, 'R10-chatpane-public-surface', 'ChatPane.tsx') &&
          chatPaneViolations.filter((v) => v.file.endsWith('ChatPane.tsx') && v.reason.includes('"PrivateThing"')).length === 1,
        'R10 should catch a non-public name reached from an escaping import, alongside a public name in the same clause',
      ],
      [
        !chatPaneViolations.some((v) => v.reason.includes('"PublicThing"')),
        'R10 must NOT flag a name that IS in the public barrel',
      ],
      [
        chatPaneViolations.some((v) => v.reason.includes('"PrivateType"')),
        'R10 should catch a non-public name in a type-only import clause',
      ],
      [
        !chatPaneViolations.some((v) => v.reason.includes('"PublicType"')),
        'R10 must NOT flag a public name in a type-only import clause',
      ],
      [
        !chatPaneViolations.some((v) => v.reason.includes('"Bar"')),
        'R10 must NOT flag an aliased import whose consumer-facing name IS in the public barrel',
      ],
      [
        chatPaneViolations.some((v) => v.reason.includes('"Baz"')),
        'R10 should catch an aliased import whose consumer-facing name is NOT in the public barrel',
      ],
      [
        !chatPaneViolations.some((v) => v.reason.includes('"LocalHelper"')),
        'R10 must NOT flag a relative import that stays inside the privileged subtree, even when the name is not in the barrel',
      ],
      [
        !chatPaneViolations.some((v) => v.file.endsWith('__tests__/ChatPane.test.tsx')),
        'R10 must NOT flag an escaping import from a __tests__/ file, even when the name is not in the barrel',
      ],
      [
        has(extensionlessViolations, 'R11-extensionless-import', 'bad-no-ext-file.ts') &&
          extensionlessViolations.some((v) => v.file.endsWith('bad-no-ext-file.ts') && v.reason.includes('"./sibling.js"') && !v.reason.includes('/index.js')),
        'R11 should catch an extensionless import of a real sibling file, hinting ".js" not "/index.js"',
      ],
      [
        has(extensionlessViolations, 'R11-extensionless-import', 'bad-no-ext-dir.ts') &&
          extensionlessViolations.some((v) => v.file.endsWith('bad-no-ext-dir.ts') && v.reason.includes('"./subdir/index.js"')),
        'R11 should catch an extensionless import that actually names a directory, hinting "/index.js"',
      ],
      [!extensionlessViolations.some((v) => v.file.endsWith('ok-with-ext.ts')), 'R11 must NOT flag a relative import that already has ".js"'],
      [!extensionlessViolations.some((v) => v.file.endsWith('ok-bare.ts')), 'R11 must NOT flag a bare @jini-ai/<name> import'],
      [
        !extensionlessViolations.some((v) => v.file.endsWith('ok-string-literal-lookalike.test.ts')),
        'R11 must NOT flag import-shaped syntax inside a string literal (the real packages/mcp false-positive this check was built to avoid)',
      ],
      [
        !extensionlessViolations.some((v) => v.file.includes('src/vendor/')),
        'R11 must NOT flag files under a package-declared tsconfig.json exclude (mirrors the real vendored Remotion template)',
      ],
      [
        has(extensionlessViolations, 'R11-extensionless-import', 'normal-bad-no-ext.ts'),
        'R11 should still catch an extensionless import just outside the excluded subtree — the exclude must be scoped, not swallow the whole package',
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
