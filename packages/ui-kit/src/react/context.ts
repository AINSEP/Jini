import { createContext, type Context } from 'react';
import type { KitContextValue } from './types.js';
const CONTEXT_KEY = Symbol.for('@jini-ai/ui-kit/react/context@1');
interface SharedContext { context: Context<KitContextValue | null>; versions: Set<string> }
export function isDevelopment(_required: Record<string, never>, _optional: Record<string, never> = {}) {
  // Keep the standard expression intact for bundlers to replace. A typeof-process shortcut would
  // force development mode in browsers even after a production NODE_ENV substitution.
  try { return process.env.NODE_ENV !== 'production'; } catch { return true; }
}
/** Sharing the context object (not just a token) makes independently bundled copies interoperable. */
export function getSharedKitContext(required: { version: string }, _optional: Record<string, never> = {}) {
  const shared = globalThis as typeof globalThis & { [CONTEXT_KEY]?: SharedContext };
  const slot = shared[CONTEXT_KEY] ??= { context: createContext<KitContextValue | null>(null), versions: new Set() };
  if (isDevelopment({}) && slot.versions.size && !slot.versions.has(required.version)) {
    console.warn(`@jini-ai/ui-kit version skew: ${[...slot.versions, required.version].join(', ')}; shared contract-major 1 context`);
  }
  slot.versions.add(required.version);
  return slot.context;
}
export const KitContext = getSharedKitContext({ version: '0.1.0' });
