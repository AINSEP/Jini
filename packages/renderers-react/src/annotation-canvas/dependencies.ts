/**
 * Composition root for the annotation-canvas slice's *default* binding.
 * There is no real "transport" this package can bind to a port for — the
 * actual submit semantics are entirely host-specific (see `ports.ts`) — so
 * this file supplies a test/demo-only fake, mirroring the shape of every
 * other slice's `dependencies.ts` (`@jini-ai/ui`'s `features/connectors/
 * dependencies.ts` binds a real fetch; a host embedding this package
 * supplies its own `AnnotationCanvasPort` instead of importing this file).
 */
import type { AnnotationCanvasPort } from './ports.js';

/** A no-op binding: submits resolve `{ ok: true }` and no snapshot is ever captured. Useful for tests, storybook-style demos, and as a documented shape for a real host binding. */
export function createFakeAnnotationCanvasPort(
  overrides: Partial<AnnotationCanvasPort> = {},
): AnnotationCanvasPort {
  return {
    onSubmit: async () => ({ ok: true }),
    ...overrides,
  };
}
