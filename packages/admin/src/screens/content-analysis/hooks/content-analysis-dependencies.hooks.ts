import { CONTENT_ANALYZER_PLUGIN_ID, type PluginPreviewRequest } from "../rules.js";
import type { ContentAnalysisPort, PluginPreviewResponse } from "./content-analysis-port.hooks.js";

/**
 * @file The in-memory {@link ContentAnalysisPort} every test composes `use-content-analysis.hooks.ts`
 * with. The live port (the host's authenticated plugin-preview transport) is bound by the host,
 * which passes its wired hook to `ContentAnalysisCard` — see `content-analysis-port.hooks.ts` for
 * why the split exists.
 */

/** Seed state for {@link createFakeContentAnalysisPort}. */
export interface FakeContentAnalysisPortOptions {
  /** Whether the `content-analyzer` plugin reports as enabled. Defaults to `true`. */
  enabled?: boolean;
  /** When set, `previewStatus()` rejects with this. */
  statusError?: Error;
  /** The `fields` a preview returns. Defaults to `{}`. */
  previewFields?: PluginPreviewResponse["fields"];
  /** When set, `previewPlugin()` rejects with this (changeable later via `setPreviewError`). */
  previewError?: Error;
  /** When set, `previewPlugin()` waits for it before answering — for in-flight and race tests. */
  previewGate?: Promise<void>;
}

/**
 * An in-memory {@link ContentAnalysisPort} for tests — "every port gets a fake". Records each
 * preview call so a test can assert exactly which draft was sent.
 */
export function createFakeContentAnalysisPort(options: FakeContentAnalysisPortOptions = {}): ContentAnalysisPort & {
  readonly statusCalls: number;
  readonly previewCalls: Array<{ pluginId: string; body: PluginPreviewRequest }>;
  setPreviewError(required: { error: Error | null }, optional?: Record<string, never>): void;
} {
  let statusCalls = 0;
  let previewError = options.previewError ?? null;
  const previewCalls: Array<{ pluginId: string; body: PluginPreviewRequest }> = [];
  return {
    get statusCalls() {
      return statusCalls;
    },
    previewCalls,
    setPreviewError({ error }, _optional = {}) {
      previewError = error;
    },
    async previewStatus({ pluginId }) {
      statusCalls += 1;
      if (options.statusError) throw options.statusError;
      return { pluginId, enabled: pluginId === CONTENT_ANALYZER_PLUGIN_ID && (options.enabled ?? true) };
    },
    async previewPlugin({ target: { pluginId }, body }, _optional = {}) {
      previewCalls.push({ pluginId, body });
      await options.previewGate;
      if (previewError) throw previewError;
      return { pluginId, fields: options.previewFields ?? {} };
    },
  };
}
