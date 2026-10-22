import { afterEach } from 'vitest';

/**
 * Loaded for every test file in this package, including `src/core/**` and `src/html/**`, which
 * deliberately run in a plain Node environment (no jsdom — see `vitest.config.ts`). This guard is
 * load-bearing, not defensive boilerplate: `@testing-library/jest-dom/vitest`'s `expect.extend(...)`
 * call was verified empirically (not assumed) to change how vitest's OWN built-in `toThrow(regex)`
 * reports a rejected promise's message — with jest-dom's matchers registered, `src/html/regions.ts`'s
 * pre-existing `readPart`/`replacePart` tests (`rejects.toThrow(/no region is tagged/)` and similar)
 * started failing with an empty actual message, in a package that never touched React or a DOM.
 * Gating registration on `document` actually existing (true only in the jsdom projects this
 * package's `environmentMatchGlobs` routes `src/react/**` to) keeps that regression from reaching
 * every other suite in this package, while still giving `src/react/**` component tests jest-dom's
 * matchers (`toBeInTheDocument`, `toHaveAttribute`, ...) and post-test DOM cleanup.
 */
if (typeof document !== 'undefined') {
  const [{ cleanup }] = await Promise.all([
    import('@testing-library/react'),
    // Registers jest-dom's DOM matchers on vitest's `expect` — see the guard's own doc above for
    // why this must not run outside a DOM environment.
    import('@testing-library/jest-dom/vitest'),
  ]);

  // Unmounts every React tree rendered by @testing-library/react between tests so DOM assertions
  // never see leftover markup from a previous test's render().
  afterEach(() => {
    cleanup();
  });
}
