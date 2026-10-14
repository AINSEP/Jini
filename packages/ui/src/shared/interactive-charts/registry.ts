import type { ComponentType } from 'react';
import type { InteractiveComponentManifest } from './types.js';

/**
 * The React entry — pairs a manifest with the component that actually renders it. React provider
 * barrels and chart host adapters (never headless manifests) produce these, so a Node/MCP host
 * can read every manifest in this feature without this file (or React) ever entering its
 * module graph.
 */
export interface InteractiveComponentEntry<Props = Record<string, unknown>> extends InteractiveComponentManifest {
  readonly Component: ComponentType<Props>;
  /** Host-wired action callback prop for custom providers; never part of the agent's wire schema.
   * Built-in providers use their documented callback; other entries retain the legacy `onRowClick` default. */
  readonly actionProp?: string;
}

/**
 * Generic immutable storage also accepts vanilla-provider metadata; the default entry retains
 * existing React callers. No React runtime is imported by this registry.
 * Resolves an agent's capability request (`"data table"`) to registered component entries, in
 * registration order — first entry is the preferred provider, later entries are the fallback
 * chain (mirrors `@jini-ai/renderers-react`'s `RendererRegistry.resolve`, one capability search
 * instead of one manifest-match predicate).
 */
export class InteractiveUiRegistry<Entry extends InteractiveComponentManifest = InteractiveComponentEntry> {
  private readonly entries: readonly Entry[];

  constructor({ entries }: { entries: readonly NoInfer<Entry>[] }, _options: Record<string, never> = {}) {
    this.entries = Object.freeze([...entries]);
  }

  list(_input: Record<string, never> = {}, _options: Record<string, never> = {}): readonly Entry[] {
    return this.entries;
  }

  resolveById({ id }: { id: string }, _options: Record<string, never> = {}): Entry | null {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  resolveByCapability({ capability }: { capability: string }, _options: Record<string, never> = {}): readonly Entry[] {
    return this.entries.filter((entry) => entry.capabilities.includes(capability));
  }

  /** Returns a new registry with `entry` appended (or replacing an existing entry of the same id). */
  register({ entry }: { entry: Entry }, _options: Record<string, never> = {}): InteractiveUiRegistry<Entry> {
    const withoutExisting = this.entries.filter((item) => item.id !== entry.id);
    return new InteractiveUiRegistry<Entry>({ entries: [...withoutExisting, entry] });
  }
}
