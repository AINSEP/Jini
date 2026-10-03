/**
 * @module react
 *
 * The chat + preview surface: a `VibecodingSession` (a subscribable wrapper over `../core`'s
 * `EditTarget`/`EditHistory`), the `@jini-ai/core`-registrable tool set that drives it from chat,
 * and the presentational React pieces — `PartsViewer` (file viewer), `DocumentPreview` (renderer),
 * and `VibecodingWorkbench` (both, composed). See this package's README for the three-piece shape
 * this entry point exists to fill in, and each exported module's own doc for its design rationale.
 *
 * React (and `react-dom`, transitively via these components) is an **optional peer dependency** —
 * see this package's `package.json` — so importing `../core` or `../html` alone never pulls React
 * in. Only a consumer of this `./react` subpath needs it installed.
 */
export type { VibecodingSession, VibecodingSessionOptions, VibecodingSessionSnapshot, ApplyEditsResult } from './session.js';
export { createVibecodingSession } from './session.js';
export type { VibecodingSessionArgs } from './session.js';

export type { UseVibecodingSessionResult } from './use-vibecoding-session.js';
export { useVibecodingSession } from './use-vibecoding-session.js';
export type { UseVibecodingSessionArgs } from './use-vibecoding-session.js';

export type {
  CreateVibecodingToolRegistrationsOptions,
  VibecodingToolRunner,
} from './tools.js';
export type { VibecodingToolArgs } from './tools.js';
export {
  VIBECODING_TOOL_IDS,
  createVibecodingToolRegistrations,
  createVibecodingToolRunner,
} from './tools.js';

export type { PartsViewerProps } from './components/PartsViewer.js';
export { PartsViewer } from './components/PartsViewer.js';

export type { DocumentPreviewProps } from './components/DocumentPreview.js';
export { DocumentPreview } from './components/DocumentPreview.js';

export type { VibecodingWorkbenchProps } from './components/VibecodingWorkbench.js';
export { VibecodingWorkbench } from './components/VibecodingWorkbench.js';
