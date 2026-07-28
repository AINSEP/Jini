// @injini/ui/browser — small, generic browser-interaction hooks shared across
// feature extractions (popovers/dialogs dismissing on outside-click/Escape,
// global keydown shortcuts scoped to a component's active lifetime). See
// packages/ui/source-map.md for the extractions that motivated this and
// AGENTS.md's `packages/ui` entry for how this directory relates to
// `utils/`, `hooks/`, and `components/`.

export * from './useDismissOnOutsideOrEscape.js';
export * from './useGlobalKeydown.js';
export * from './useFileDropTarget.js';
