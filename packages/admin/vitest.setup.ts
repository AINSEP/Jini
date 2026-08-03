import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Registers jest-dom's DOM matchers (toBeInTheDocument, toHaveAttribute, …) on vitest's `expect`.
import '@testing-library/jest-dom/vitest';

// Unmounts every React tree rendered by @testing-library/react between tests so DOM assertions
// never see leftover markup from a previous test's render().
//
// This file is loaded for EVERY test in the package, including the `src/core/**` and
// `src/server/**` suites that deliberately run without a DOM (see `vitest.config.ts`). That is
// safe and intentional: both imports above only register matchers and a hook — neither touches
// `document` at module load — and `cleanup()` is a no-op when nothing has been rendered. The
// no-jsdom guard on the other layers is unaffected; a `window` reference in `src/core/**` still
// fails exactly as loudly as before.
afterEach(() => {
  cleanup();
});
