/**
 * The Node/MCP-safe entry point: only `*.manifest.ts` files, never a provider's `.tsx`. Import
 * this from a headless host (an MCP server, an agent-runtime with no browser) — never `.` or
 * `./index.js`, which pull in React through the provider implementations. See README.md.
 */
export type { InteractiveComponentManifest } from './types.js';
export { nativeDataTableManifest, nativeDataTablePropsSchema } from './providers/native/data-table.manifest.js';
export { shadcnDataTableManifest, shadcnDataTablePropsSchema } from './providers/shadcn/data-table.manifest.js';

import type { InteractiveComponentManifest } from './types.js';
import { nativeDataTableManifest } from './providers/native/data-table.manifest.js';
import { shadcnDataTableManifest } from './providers/shadcn/data-table.manifest.js';

/** Every registered manifest, for search/describe tooling that needs to list them all. Order is preference order — see `index.ts`'s `DEFAULT_INTERACTIVE_UI_REGISTRY` for where that's load-bearing. */
export const ALL_MANIFESTS: readonly InteractiveComponentManifest[] = [shadcnDataTableManifest, nativeDataTableManifest];
