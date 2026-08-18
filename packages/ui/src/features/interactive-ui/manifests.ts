/**
 * The Node/MCP-safe entry point: only `*.manifest.ts` files, never a provider's `.tsx`. Import
 * this from a headless host (an MCP server, an agent-runtime with no browser) — never `.` or
 * `./index.js`, which pull in React through the provider implementations. See README.md.
 */
export type { InteractiveComponentManifest } from './types.js';
export { nativeDataTableManifest, nativeDataTablePropsSchema } from './providers/native/data-table.manifest.js';
export { shadcnDataTableManifest, shadcnDataTablePropsSchema } from './providers/shadcn/data-table.manifest.js';
export { shadcnButtonManifest, shadcnButtonPropsSchema } from './providers/shadcn/action-button.manifest.js';
export { shadcnCheckboxManifest, shadcnCheckboxPropsSchema } from './providers/shadcn/checkbox-field.manifest.js';
export { shadcnRadioGroupManifest, shadcnRadioGroupPropsSchema } from './providers/shadcn/radio-group-field.manifest.js';
export { shadcnTextInputManifest, shadcnTextInputPropsSchema } from './providers/shadcn/text-input-field.manifest.js';
export { shadcnSelectManifest, shadcnSelectPropsSchema } from './providers/shadcn/select-field.manifest.js';
export { shadcnCardManifest, shadcnCardPropsSchema } from './providers/shadcn/content-card.manifest.js';
export { rechartsBarChartManifest, rechartsBarChartPropsSchema } from './providers/recharts/bar-chart.manifest.js';
export { rechartsLineChartManifest, rechartsLineChartPropsSchema } from './providers/recharts/line-chart.manifest.js';
export { rechartsPieChartManifest, rechartsPieChartPropsSchema } from './providers/recharts/pie-chart.manifest.js';

import type { InteractiveComponentManifest } from './types.js';
import { nativeDataTableManifest } from './providers/native/data-table.manifest.js';
import { shadcnDataTableManifest } from './providers/shadcn/data-table.manifest.js';
import { shadcnButtonManifest } from './providers/shadcn/action-button.manifest.js';
import { shadcnCheckboxManifest } from './providers/shadcn/checkbox-field.manifest.js';
import { shadcnRadioGroupManifest } from './providers/shadcn/radio-group-field.manifest.js';
import { shadcnTextInputManifest } from './providers/shadcn/text-input-field.manifest.js';
import { shadcnSelectManifest } from './providers/shadcn/select-field.manifest.js';
import { shadcnCardManifest } from './providers/shadcn/content-card.manifest.js';
import { rechartsBarChartManifest } from './providers/recharts/bar-chart.manifest.js';
import { rechartsLineChartManifest } from './providers/recharts/line-chart.manifest.js';
import { rechartsPieChartManifest } from './providers/recharts/pie-chart.manifest.js';

/** Every registered manifest, for search/describe tooling that needs to list them all. Order is preference order — see `index.ts`'s `DEFAULT_INTERACTIVE_UI_REGISTRY` for where that's load-bearing. */
export const ALL_MANIFESTS: readonly InteractiveComponentManifest[] = [
  shadcnDataTableManifest,
  nativeDataTableManifest,
  shadcnButtonManifest,
  shadcnCheckboxManifest,
  shadcnRadioGroupManifest,
  shadcnTextInputManifest,
  shadcnSelectManifest,
  shadcnCardManifest,
  rechartsBarChartManifest,
  rechartsLineChartManifest,
  rechartsPieChartManifest,
];
