import { expect, test } from 'vitest';
import * as core from '../core/index.js';
import * as root from '../index.js';

// The package root is a compatibility entry: existing `@jini-ai/agentic` imports must keep
// resolving to exactly the core exports, with no extra or missing names and the same bindings.
test('the compatibility root re-exports exactly the core surface, binding for binding', () => {
  expect(Object.keys(root).sort()).toEqual(Object.keys(core).sort());
  for (const name of Object.keys(core)) expect(Reflect.get(root, name), name).toBe(Reflect.get(core, name));
});
