// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Asserts the `@jini-ai/ui/remixicon.css` subpath export actually resolves to a usable stylesheet
 * in built output.
 *
 * This is the one claim in `RemixIcon.tsx`'s stylesheet story that `dist/` can settle, and it is
 * load-bearing for all of it: `installRemixIconStylesheet` is only a real escape hatch if the
 * thing every warning message tells a host to import is really there. The chain it depends on has
 * two independently breakable links that no source-level test touches --
 *
 *  1. the `exports` map entry, and
 *  2. a `cp` buried in the middle of `package.json`'s single `&&`-chained `build` script,
 *
 * -- and if either breaks, the export silently 404s while every unit test in this package still
 * passes and the component's own advice becomes wrong. Same reasoning as
 * `agent-icon-data-uris.build-output.test.ts`, which exists because a source-level assertion
 * cannot tell a working asset reference from a broken one.
 *
 * Deliberately derived from the `exports` map rather than a hardcoded path, so a typo *in the
 * export map* fails here rather than only at a host's import.
 */
const PACKAGE_ROOT = process.cwd();
const SUBPATH = './remixicon.css';

interface PackageManifest {
  exports: Record<string, unknown>;
}

const manifest = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
) as PackageManifest;

describe('the ./remixicon.css subpath export reaches built output', () => {
  it('is declared in the exports map as a plain relative file target', () => {
    const target = manifest.exports[SUBPATH];
    expect(typeof target, `exports["${SUBPATH}"] should be a string path`).toBe('string');
    // A conditional-exports object here would still resolve for a bundler but would break the
    // path derivation every other case in this file depends on, so pin the shape too.
    expect(target as string).toMatch(/^\.\//);
    expect(isAbsolute(target as string)).toBe(false);
  });

  it('has been built at least once for this suite to check', () => {
    const cssPath = resolve(PACKAGE_ROOT, manifest.exports[SUBPATH] as string);
    expect(
      existsSync(cssPath),
      `${cssPath} is missing — the exports map points at it but the build's copy step did not ` +
        'produce it. Run `pnpm --filter @jini-ai/ui build` before this test.',
    ).toBe(true);
  });

  it('is the real RemixIcon stylesheet, not an empty or placeholder file', () => {
    const cssPath = resolve(PACKAGE_ROOT, manifest.exports[SUBPATH] as string);
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain('@font-face');
    expect(css).toContain("font-family: \"remixicon\"");
    // The component renders `ri-<name>` class names; a stylesheet without those glyph rules
    // would load fine and still paint nothing.
    expect(css).toMatch(/^\.ri-[a-z0-9-]+:before\s*\{\s*content:/m);
  });

  it('ships the woff2 beside it, because the @font-face src is relative', () => {
    const cssPath = resolve(PACKAGE_ROOT, manifest.exports[SUBPATH] as string);
    const css = readFileSync(cssPath, 'utf8');

    // Pinning the relative form on purpose. It is *why* the sibling file below has to exist, and
    // it is the exact property that made the `data:`-URL bundling failure fatal rather than
    // merely inefficient: a relative `src` has nothing to resolve against inside a `data:` URL.
    // If a RemixIcon upgrade ever changes this to an absolute or inlined src, this assertion
    // fails and `RemixIcon.tsx`'s doc comment needs revisiting rather than silently going stale.
    const fontFile = /src:\s*url\(["']?\.\/([^"')]+\.woff2)["']?\)/.exec(css)?.[1];
    // Narrowed with a plain guard rather than `!`: under `noUncheckedIndexedAccess` a capture
    // group is `string | undefined`, and no match here does not mean "assertion failed", it means
    // the stylesheet's `@font-face` shape changed out from under this test — which is the finding
    // itself and deserves to say so, rather than being cast away.
    if (fontFile === undefined) {
      throw new Error(`no relative ./*.woff2 src found in @font-face — ${cssPath} shape changed`);
    }

    const fontPath = join(dirname(cssPath), fontFile);
    expect(existsSync(fontPath), `${fontPath} is missing — the CSS ships without its font`).toBe(
      true,
    );
  });

  it('is inside a directory the package actually publishes', () => {
    // `files` is `["dist", ...negations]`; a target that escaped `dist/` would resolve locally in
    // this monorepo (where a host symlinks the checkout) and 404 for anyone installing the tarball.
    expect(manifest.exports[SUBPATH] as string).toMatch(/^\.\/dist\//);
  });
});
