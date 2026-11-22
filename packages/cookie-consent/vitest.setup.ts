import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Registers jest-dom's DOM matchers on vitest's `expect` (the React settings panel tests use them).
import '@testing-library/jest-dom/vitest';

// Unmounts React trees between tests; a no-op for the DOM-free suites, which render nothing.
afterEach(() => {
  cleanup();
});
