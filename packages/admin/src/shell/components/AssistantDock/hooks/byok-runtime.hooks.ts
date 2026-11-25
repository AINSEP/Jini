import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orFallback } from "@jini-ai/core/errors/idioms";
import type { ExecutionConfig, ExecutionPort, ProviderPreset } from "@jini-ai/core/contracts/execution";

import type { useExecutionConfig } from "./execution-config.hooks.js";

/**
 * Models the saved BYOK credential can actually run — the same list `features/ai-assistant/AiAssistant.tsx`'s
 * and `features/settings/SettingsUi.tsx`'s Model fields show, discovered through the same
 * `createExecutionPort().listModels` call.
 *
 * Discovered here rather than passed down because the dock outlives any settings screen: a
 * picker whose options only existed while the settings tab was open would be empty in the case
 * that matters. Empty on failure, which downgrades the picker's model row to read-only text
 * rather than offering an empty dropdown.
 *
 * SAFE with respect to the keystroke-leak finding
 * (`ADS-memory/reports/findings/2026-08-04-byok-discovery-keystroke-key-leak.md`): the endpoint
 * here comes from SAVED config, which an operator committed with an explicit Save, never from a
 * field being typed into. There is no partial-hostname state for this effect to walk.
 */
export function useByokModels(
  { executionConfig, createPort }: { executionConfig: ExecutionConfig; createPort: () => Pick<ExecutionPort, "listModels"> },
  _options: Record<string, never> = {},
) {
  const executionPort = useRef(createPort());
  const [byokModels, setByokModels] = useState<readonly { id: string; label: string }[]>([]);
  const { apiKey: byokApiKey, baseUrl: byokBaseUrl, protocol: byokProtocol } = executionConfig.byok;
  const byokConfig = useRef(executionConfig.byok);
  byokConfig.current = executionConfig.byok;

  // Keyed on the credential and endpoint only — editing `model` must not re-ask the provider
  // which models exist, and would loop against the write-back below if it did.
  useEffect(() => {
    if (executionConfig.mode !== "byok" || !byokApiKey.trim()) {
      setByokModels([]);
      return undefined;
    }
    let cancelled = false;
    const discovery = executionPort.current
      .listModels?.({ ...byokConfig.current, apiKey: byokApiKey, baseUrl: byokBaseUrl, protocol: byokProtocol });
    // Silent: a failed discovery must not put an error in a chat composer. The visible
    // consequence is only that the model row stays a plain value instead of a picker.
    if (discovery) void orFallback({ work: () => discovery, fallback: [], step: "Discover BYOK models" }).then((models) => {
      if (!cancelled) setByokModels(models.map((id) => ({ id, label: id })));
    });
    return () => {
      cancelled = true;
    };
  }, [executionConfig.mode, byokApiKey, byokBaseUrl, byokProtocol]);
  return byokModels;
}

export interface UseByokRuntime {
  byokRuntime: {
    providerLabel?: string;
    iconId?: string;
    model: string;
    models: readonly { id: string; label: string }[];
  };
  handleByokModelChange: (model: string) => void;
}

/**
 * Owns the BYOK model-discovery state and the composer's write-back for a model chosen there. Split
 * out of `AssistantDock` so the discovery-failure path (models stay empty rather than throwing into
 * the composer) is directly assertable via `renderHook`.
 *
 * @param input.executionConfig - The live execution config; only `executionConfig.byok` and
 *   `executionConfig.mode` are read.
 * @param input.setExecutionConfig - The setter {@link useExecutionConfig} returns, so a model
 *   picked here writes back through the same state.
 * @param options.createPort - Model-discovery IO factory; defaults to the existing execution adapter.
 * @param options.persistWrite - Write seam for component tests; defaults to the shared dock writer.
 * @returns `byokRuntime` (provider identity, model, and discovered options for the picker) and
 *   `handleByokModelChange`.
 * @example
 * const { byokRuntime, handleByokModelChange } = useByokRuntime({ executionConfig, setExecutionConfig });
 */
export function useByokRuntime(
  {
    executionConfig,
    setExecutionConfig,
    createPort, useModelsHook, presets, resolvePreset, presetIconIds, applyChange, persistWrite,
  }: {
    executionConfig: ExecutionConfig;
    setExecutionConfig: React.Dispatch<React.SetStateAction<ExecutionConfig>>;
    createPort: () => Pick<ExecutionPort, "listModels">;
    useModelsHook: typeof useByokModels;
    presets: readonly ProviderPreset[];
    resolvePreset: (required: { presets: readonly ProviderPreset[]; config: ExecutionConfig["byok"] }) => ProviderPreset | undefined;
    presetIconIds: Readonly<Record<string, string>>;
    applyChange: Parameters<typeof useExecutionConfig>[0]["applyChange"];
    persistWrite: Parameters<typeof useExecutionConfig>[0]["persistWrite"];
  },
  _optional: Record<string, never> = {},
): UseByokRuntime {
  const byokModels = useModelsHook({ executionConfig, createPort });

  /**
   * The provider identity, model, and option list the runtime picker shows while BYOK is active.
   *
   * `resolveSelectedPreset` rather than a protocol-to-name map: the same protocol backs several
   * presets (OpenRouter and Ollama are both `openai`-protocol gateways), so keying off `protocol`
   * alone would label a gateway with the wrong vendor's name. A hand-typed custom endpoint matches
   * no preset and correctly yields no label and no icon, which the picker renders as a generic mode
   * name and glyph rather than inventing a vendor.
   */
  const byokRuntime = useMemo(
    () => {
      const preset = resolvePreset({ presets, config: executionConfig.byok });
      const iconId = preset ? presetIconIds[preset.id] : undefined;
      return {
        ...(preset ? { providerLabel: preset.title } : {}),
        ...(iconId ? { iconId } : {}),
        model: executionConfig.byok.model,
        models: byokModels,
      };
    },
    [executionConfig.byok, byokModels, presets, resolvePreset, presetIconIds],
  );

  /**
   * Write-back for a model chosen in the composer's picker — the "stay in sync" half.
   *
   * Goes through `saveExecutionConfig`, the same ADR-028 chokepoint the settings screens and
   * {@link useExecutionConfig}'s `handleExecutionModeChange` use, so the composer and both settings
   * surfaces are three views of one stored value rather than three copies of it. `publishSettingsRefresh`
   * then tells an already-open settings tab to re-read, which is what stops it from sitting on the
   * model the operator just changed. Namespace-scoped so unrelated slices do not refetch.
   */
  const handleByokModelChange = useCallback(
    (model: string) => {
      const write = applyChange({ setExecutionConfig, change: (previous) =>
        previous.byok.model === model ? previous : { ...previous, byok: { ...previous.byok, model } } });
      if (write) persistWrite({ write });
    },
    [setExecutionConfig, applyChange, persistWrite],
  );

  return { byokRuntime, handleByokModelChange };
}

