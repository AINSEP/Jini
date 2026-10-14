import type { z } from 'zod';

/**
 * The Node/MCP-safe half of an interactive-ui provider: enough to search and describe a
 * component without ever importing the React implementation that renders it. A
 * `search_components` MCP tool reads only files that produce these — never a `.tsx`.
 *
 * `propsSchema` validates the *wire* shape an agent sends (plain data), not a component's full
 * React prop surface — callbacks like `onRowClick` are host-wired separately, the same way A2UI
 * keeps `action` bindings out of a component's data props.
 */
export interface InteractiveComponentManifest {
  readonly id: string;
  readonly provider: string;
  readonly capabilities: readonly string[];
  readonly propsSchema: z.ZodTypeAny;
  readonly description?: string;
}
