/** Known-bad and known-good fixtures for R14 (`check-runtime-cycles.ts`).
 * They run inside guard before its real-tree scan, so a config change that stops the check from
 * seeing a cycle (a type filter, a missing tsconfig) cannot print a false OK.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkRuntimeCycles } from '../check-runtime-cycles.js';

/** The compiler settings every package inherits; the fixtures must be judged under the same ones. */
const FIXTURE_TSCONFIG = { compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', verbatimModuleSyntax: true, isolatedModules: true } };

const FIXTURES: Readonly<Record<string, string>> = {
  // Two files that use each other's values: the plain case.
  'packages/value-cycle/src/a.ts': "import { b } from './b.js';\nexport const a = (): unknown => b;\n",
  'packages/value-cycle/src/b.ts': "import { a } from './a.js';\nexport const b = (): unknown => a;\n",
  // `import { type B }` is emitted as `import {} from './b.js'` under verbatimModuleSyntax: a real load.
  'packages/kept-import-cycle/src/a.ts': "import { type B } from './b.js';\nexport const a: B | 1 = 1;\n",
  'packages/kept-import-cycle/src/b.ts': "import { a } from './a.js';\nexport type B = 2;\nexport const b = a;\n",
  // `import type { B }` is dropped by the compiler: no runtime edge back, so no cycle.
  'packages/type-only-loop/src/a.ts': "import type { B } from './b.js';\nexport const a: B | 1 = 1;\n",
  'packages/type-only-loop/src/b.ts': "import { a } from './a.js';\nexport type B = 2;\nexport const b = a;\n",
  // A test may import anything, including a module that imports it back.
  'packages/test-loop/src/a.ts': 'export const a = 1;\n',
  'packages/test-loop/src/__tests__/a.test.ts': "import { a } from '../a.js';\nimport { helper } from './helper.js';\nexport const t = [a, helper];\n",
  'packages/test-loop/src/__tests__/helper.ts': "import { t } from './a.test.js';\nexport const helper = (): unknown => t;\n",
};
const VALUE_CYCLE = ['packages/value-cycle/src/a.ts', 'packages/value-cycle/src/b.ts'];
const KEPT_IMPORT_CYCLE = ['packages/kept-import-cycle/src/a.ts', 'packages/kept-import-cycle/src/b.ts'];

function writeFixtures(required: { root: string }, _optional: Record<string, never> = {}): void {
  const files = { ...FIXTURES, 'tsconfig.base.json': JSON.stringify(FIXTURE_TSCONFIG) };
  for (const [file, content] of Object.entries(files)) {
    const path = join(required.root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

/** @returns One sentence per expectation that did not hold; empty when the check still works. */
export function runRuntimeCycleSelfTest(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): string[] {
  const root = mkdtempSync(join(tmpdir(), 'jini-runtime-cycles-'));
  const failures: string[] = [];
  const expect = (holds: boolean, description: string): void => { if (!holds) failures.push(description); };
  try {
    writeFixtures({ root });
    const flagged = (debtFiles: readonly string[]) => checkRuntimeCycles({ repoRoot: root }, { debtFiles });
    const filesOf = (debtFiles: readonly string[]) => flagged(debtFiles).map((violation) => violation.file).sort();

    const noDebt = flagged([]);
    expect(noDebt.some((v) => VALUE_CYCLE.includes(v.file) && VALUE_CYCLE.every((file) => v.reason.includes(file))),
      'R14 must flag two files that import each other\'s values, and name both files in the reason');
    expect(noDebt.some((v) => KEPT_IMPORT_CYCLE.includes(v.file)),
      'R14 must flag a cycle closed by `import { type X }`: under verbatimModuleSyntax it is emitted as `import {}` and still loads the module');
    expect(!noDebt.some((v) => v.file.includes('type-only-loop/')),
      'R14 must NOT flag a loop closed only by a statement-level `import type` (the compiler drops it)');
    expect(!noDebt.some((v) => v.file.includes('test-loop/')), 'R14 must NOT flag a cycle between test files');
    expect(noDebt.length === 2, `R14 must report each cycle once (expected 2 rows for the fixtures, got ${noDebt.length})`);

    expect(JSON.stringify(filesOf([...VALUE_CYCLE, ...KEPT_IMPORT_CYCLE])) === '[]',
      'R14 must accept a cycle whose every member is in the debt list');
    expect(filesOf([VALUE_CYCLE[0]!, ...KEPT_IMPORT_CYCLE]).includes(VALUE_CYCLE[1]!),
      'R14 must flag a cycle when only some of its members are in the debt list, naming a member that is not');
    const stale = flagged([...VALUE_CYCLE, ...KEPT_IMPORT_CYCLE, 'packages/test-loop/src/a.ts']);
    expect(stale.length === 1 && stale[0]!.file === 'packages/test-loop/src/a.ts' && stale[0]!.reason.includes('delete the entry'),
      'R14 must flag a debt entry whose file is no longer in a cycle, so the list only shrinks');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return failures;
}
