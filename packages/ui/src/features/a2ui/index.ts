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
} from './protocol.js';
export {
  buildA2uiCatalogFromRegistry,
  type BuildA2uiCatalogFromRegistryOptions,
} from './catalog-from-registry.js';
export { useA2uiSurfaceRoot } from './use-a2ui-surface.js';
export { A2uiSurfaceRenderer, type A2uiSurfaceRendererProps } from './renderer.js';
