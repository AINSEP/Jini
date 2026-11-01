import { antigravityToolPresentation } from './antigravity/tool-presentation.js';

type Call = { name: string; input: unknown };

/** Display-only call and, when present, the transport's inner call to correlate with the bridge. */
export type ToolPresentation = Call & { wrapper?: Call };

/** Resolve CLI argument dialects at one boundary. Raw/persisted events remain untouched.
 * Pure; O(k) only when an adapter copies k argument keys, otherwise O(1).
 */
export function toolPresentation(call: Call, _options: Record<string, never> = {}): ToolPresentation {
  return antigravityToolPresentation(call) ?? call;
}
