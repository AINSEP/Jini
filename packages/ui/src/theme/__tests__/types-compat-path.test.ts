import { expect, it } from 'vitest';

// `theme/types` is a compatibility path for imports that predate the move into `core/theme`.
// It must stay a pure re-export: same runtime surface as the core module, nothing of its own.
it('re-exports exactly the core theme types module', async () => {
  const compat = await import('../types.js');
  const core = await import('../../core/theme/types.js');
  expect(Object.keys(compat).sort()).toEqual(Object.keys(core).sort());
  for (const key of Object.keys(core)) expect((compat as Record<string, unknown>)[key]).toBe((core as Record<string, unknown>)[key]);
});
