/**
 * The A2UI wire vocabulary, re-exported from `@jini-ai/agentic`'s `./a2ui` — not a second copy of
 * it. `agentic/core` owns the catalog/interpreter/protocol types (framework-free); this feature
 * folder is the React-facing wiring on top.
 */
export {
  createA2uiInterpreter,
  createLabCatalog,
  type A2uiInterpreter,
  type ApplyMessageResult,
  type BuildActionResult,
  type ComponentInstance,
  type SurfaceSnapshot,
  type Catalog,
  type ComponentSpec,
  type ComponentKind,
} from '@jini-ai/agentic/a2ui';
