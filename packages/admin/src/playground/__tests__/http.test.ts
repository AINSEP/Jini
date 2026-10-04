import { expect, it } from 'vitest';
import { playgroundHttpSupport } from '../adapters/http.js';
it('does not invent an HTTP route for a browser-only canvas', () => {
  expect(playgroundHttpSupport.supported).toBe(false);
  expect(playgroundHttpSupport.routes).toEqual([]);
  expect(playgroundHttpSupport.reason).toContain('browser');
});
