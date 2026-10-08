/**
 * @module telemetry-sink
 * The engine emits generic lifecycle events; hosts map them to their own analytics schema.
 * data is opaque Record<string, unknown>: metrics supplied by ArtifactTaxonomy/PromptAugmenter
 * must not install a product's analytics identity or event schema in the engine.
 */
export interface RunLifecycleEvent {
  type: 'run_started' | 'run_finished' | 'run_failed' | 'tool_use' | 'artifact_written';
  runId: string;
  agentId: string;
  at: number;
  data?: Record<string, unknown>;
}

export interface TelemetrySink {
  emit(event: RunLifecycleEvent): void;
  reportFinalizedMessage?(input: { runId: string; text: string; meta: Record<string, unknown> }): void;
}

/** Discards every event. Safe default until a host supplies a real sink. */
export const noopTelemetrySink: TelemetrySink = {
  emit: () => {},
};
