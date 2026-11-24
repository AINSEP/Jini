import { useEffect, useState } from 'react';
import { useByokFieldValidation } from '../hooks/use-byok-field-validation.hooks.js';
import type { ByokConfig, ProviderPreset } from '@jini-ai/core/contracts/execution';

/** Keep credential disclosure and provider-specific form state local to the selected provider. */
export function useByokProviderForm({ config, onConfigChange, preset, apiKeyStoredExternally, deferMissingFeedback }: {
  config: ByokConfig; onConfigChange: (config: ByokConfig) => void; preset: ProviderPreset | null;
  apiKeyStoredExternally: boolean; deferMissingFeedback: boolean;
}, _options = {}) {
  const [revealKey, setRevealKey] = useState(false);

  /** Whether the operator explicitly picked "Custom…" in the model picker — distinct from "the
   *  saved model simply isn't in the live list". Same UI-local toggle, for the same reason, as
   *  `LocalCliAgentCard`'s: there is nowhere in `ByokConfig` for "mid-typing a custom id" to live. */
  const [explicitCustomModel, setExplicitCustomModel] = useState(false);

  // A different provider's model list is not this one's. Without this, switching from a provider
  // whose model was custom leaves the free-text box open over the new provider's real list.
  useEffect(() => {
    setExplicitCustomModel(false);
  }, [config.providerId]);

  // Re-hide whenever the card switches to a different provider. `revealKey` is
  // local state and this component is not keyed by provider, so without this it
  // survives the switch: reveal provider A's key, pick provider B, and B's own
  // saved key renders as `type="text"` without anyone asking for it. The
  // credentials themselves ARE correctly per-provider (`nextConfigForPresetSelect`
  // snapshots them into `savedByProviderId`); only this disclosure toggle
  // escaped that isolation.
  useEffect(() => {
    setRevealKey(false);
  }, [config.providerId]);

  const validation = useByokFieldValidation(
    { config, preset, apiKeyStoredExternally }, { deferMissingFeedback },
  );
  const patch = (next: Partial<ByokConfig>) => onConfigChange({ ...config, ...next });
  return { revealKey, setRevealKey, explicitCustomModel, setExplicitCustomModel, validation, patch };
}
