export type ModelIdentityKind = 'concrete' | 'alias' | 'routing-mode';

export type RuntimeEnv = NodeJS.ProcessEnv | Record<string, string>;

export type RuntimeModelOption = {
  id: string;
  label: string;
  identityKind?: ModelIdentityKind;
  resolvedId?: string;
  /**
   * The reasoning-effort levels THIS model supports, when the runtime's own catalog reports them
   * per model rather than per agent.
   *
   * Present only where a live source actually carries the data — Codex's `debug models` catalog
   * does (`supported_reasoning_levels`), and the levels genuinely differ between models on the same
   * CLI: verified live against codex-cli 0.153.4, where `gpt-6-astra` offers
   * low/medium/high/xhigh/max/ultra while `gpt-5.5` stops at `xhigh`. A single agent-level
   * `RuntimeAgentDef.reasoningOptions` list cannot be correct for both, which is why this is a
   * property of the model row rather than of the def.
   *
   * Consumed by `RuntimeAgentDef.deriveReasoningOptions` to compute the agent-level list a picker
   * renders. Left `undefined` by every runtime whose effort vocabulary really is uniform, and by
   * every static fallback list — an absent value means "nothing catalog-specific to say", never
   * "this model supports no effort levels".
   */
  reasoning?: readonly RuntimeReasoningOption[];
};

export type RuntimeReasoningOption = RuntimeModelOption;
