import type { ComponentType } from 'react';
import type { InteractiveComponentManifest } from './types.js';

/**
 * The React-aware half — pairs a manifest with the component that actually renders it. Only
 * `providers/*\/index.ts` (never `*.manifest.ts`) may produce one of these, so a Node/MCP host
 * can read every manifest in this feature without this file (or React) ever entering its
 * module graph.
 */
export interface InteractiveComponentEntry<Props = Record<string, unknown>> extends InteractiveComponentManifest {
  readonly Component: ComponentType<Props>;
}

/**
 * Resolves an agent's capability request (`"data table"`) to registered component entries, in
 * registration order — first entry is the preferred provider, later entries are the fallback
 * chain (mirrors `@jini-ai/renderers-react`'s `RendererRegistry.resolve`, one capability search
 * instead of one manifest-match predicate).
 */
export class InteractiveUiRegistry {
  constructor(private readonly entries: readonly InteractiveComponentEntry[]) {}

  list(): readonly InteractiveComponentEntry[] {
    return this.entries;
  }

  resolveById(id: string): InteractiveComponentEntry | null {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  resolveByCapability(capability: string): readonly InteractiveComponentEntry[] {
    return this.entries.filter((entry) => entry.capabilities.includes(capability));
  }

  /** Returns a new registry with `entry` appended (or replacing an existing entry of the same id). */
  register(entry: InteractiveComponentEntry): InteractiveUiRegistry {
    const withoutExisting = this.entries.filter((item) => item.id !== entry.id);
    return new InteractiveUiRegistry([...withoutExisting, entry]);
  }
}
