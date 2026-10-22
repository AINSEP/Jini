import { adminPort } from '../core/module/token.js';
/** Opaque headlessly; browser hosts publish an actual portal container, never an id or flag. */
export interface PlaygroundTargetSnapshot { readonly target: object | null }
export interface PlaygroundRenderTargetPort {
  getSnapshot(required?: Record<string, never>, optional?: Record<string, never>): PlaygroundTargetSnapshot;
  subscribe(required: { listener: () => void }, optional?: Record<string, never>): () => void;
  /** A lease belongs to its publisher; releasing a stale lease cannot erase the current node. */
  register(required: { target: object }, optional?: Record<string, never>): { release(required?: Record<string, never>, optional?: Record<string, never>): void };
}
export const playgroundRenderTargetToken = adminPort<PlaygroundRenderTargetPort, 'admin.playground.render-target'>({ id: 'admin.playground.render-target' });
