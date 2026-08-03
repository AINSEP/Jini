/**
 * Proves the hard invariant this package's `/core` subpath exists to hold: `src/core/**` must
 * stay completely React-free and `runtime: "universal"` (see this package's `package.json`
 * `jini.entries["."]`/`["./core"]`). Tovu imports chat state server-side in Node
 * (`src/assistant/persistence/tenant-scope.ts`, `src/server/modules/assistant-chats.ts`) — a
 * React dependency anywhere in this subtree, direct or transitive, would break that.
 *
 * `@jini-ai/admin`'s own `/core` boundary is enforced by `vitest.config.ts` alone (no jsdom by
 * default — see this package's own `vitest.config.ts`, which mirrors it). That guard is real but
 * indirect: it only fails if a *test* under `src/core/**` actually touches `window`/`document`
 * (e.g. by rendering a component with `@testing-library/react`). A bare `import { useState } from
 * 'react'` in a *source* file does not touch the DOM at module-load time, so it would pass a
 * no-jsdom environment silently. This test closes that gap directly: it scans every import
 * specifier in every `.ts`/`.tsx` file anywhere under `src/core` (this file's own directory
 * included) and fails if any of them is `react`/`react-dom` (or a subpath of either), or a
 * relative import that resolves outside `src/core`.
 *
 * The second test proves the check itself isn't a no-op — this repo's own convention (see
 * `scripts/lib/self-test.ts`'s module doc: a check that silently regresses to `return []` is
 * exactly the failure mode worth guarding against) — by running the same scanning logic against
 * an in-memory fixture that DOES import `react` and asserting it gets flagged.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CORE_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * This file's own path, relative to `CORE_SRC` — excluded from the real scan below because its
 * second test necessarily writes import-shaped string literals as fixture DATA (`"import ...
 * from 'react'"` inside a `writeFileSync` call), which a plain text/regex scan cannot distinguish
 * from a live import. The real repo's `scripts/lib/self-test.ts` sidesteps this by writing its
 * fixtures to a separate `mkdtempSync` tree outside the scanned source, not inside a checked-in
 * file — this test does the same for its fixtures (see the second `it` below), but excludes its
 * own file here as well since the fixture *strings* still live in this file's text.
 */
const SELF_PATH = relative(CORE_SRC, fileURLToPath(import.meta.url));

const FROM_IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /\bimport\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]/g;

interface Offense {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function specifiersIn(absFile: string): string[] {
  const content = readFileSync(absFile, 'utf8');
  const specs: string[] = [];
  for (const re of [FROM_IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    for (const m of content.matchAll(re)) specs.push(m[1]!);
  }
  return specs;
}

/** Flags a bare `react`/`react-dom` import (or subpath), or a relative import that escapes `srcRoot`. */
function scanForReactLeaks(srcRoot: string): Offense[] {
  const offenses: Offense[] = [];
  for (const absFile of listTsFiles(srcRoot)) {
    const file = relative(srcRoot, absFile);
    for (const spec of specifiersIn(absFile)) {
      if (spec === 'react' || spec.startsWith('react/') || spec === 'react-dom' || spec.startsWith('react-dom/')) {
        offenses.push({ file, specifier: spec, reason: 'imports react/react-dom directly' });
        continue;
      }
      if (spec.startsWith('.')) {
        const resolvedAbs = resolve(dirname(absFile), spec);
        const resolvedRel = relative(srcRoot, resolvedAbs);
        if (resolvedRel.startsWith('..')) {
          offenses.push({ file, specifier: spec, reason: 'relative import escapes src/core (likely reaches into src/react)' });
        }
      }
    }
  }
  return offenses;
}

describe('src/core stays React-free', () => {
  it('has zero react/react-dom imports and zero relative imports escaping src/core', () => {
    const offenses = scanForReactLeaks(CORE_SRC).filter((o) => o.file !== SELF_PATH);
    expect(offenses).toEqual([]);
  });

  it('the check itself is not a no-op — proven against a fixture tree that imports react', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'chat-core-react-free-fixture-'));
    try {
      writeFileSync(join(fixtureRoot, 'bad-direct.ts'), "import { useState } from 'react';\nexport { useState };\n");
      writeFileSync(join(fixtureRoot, 'bad-subpath.ts'), "import { createRoot } from 'react-dom/client';\nexport { createRoot };\n");
      mkdirSync(join(fixtureRoot, 'nested'));
      writeFileSync(
        join(fixtureRoot, 'nested', 'bad-escape.ts'),
        "import { Composer } from '../../react/components/Composer.js';\nexport { Composer };\n",
      );
      writeFileSync(join(fixtureRoot, 'ok.ts'), "export const clean = true;\n");

      const offenses = scanForReactLeaks(fixtureRoot);
      const has = (file: string, reasonSubstring: string) =>
        offenses.some((o) => o.file === file && o.reason.includes(reasonSubstring));

      expect(has('bad-direct.ts', 'react/react-dom')).toBe(true);
      expect(has('bad-subpath.ts', 'react/react-dom')).toBe(true);
      expect(has(join('nested', 'bad-escape.ts'), 'escapes')).toBe(true);
      expect(offenses.some((o) => o.file === 'ok.ts')).toBe(false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
