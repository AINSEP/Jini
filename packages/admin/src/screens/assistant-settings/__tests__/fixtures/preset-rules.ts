import { groupPresets, isProviderConfigured, nextConfigForPresetSelect, resolveSelectedPreset } from "@jini-ai/ui/core";
import type { VisitorPresetRules } from "../../visitor-credential-form-port.js";

/**
 * The UI library's real preset rules, bound the way a host binds `presetRules` — tests only (the
 * package itself imports no UI library). `satisfies` is the same compatibility proof the host makes:
 * a drift between the screen's local shapes and the library's fails this file's typecheck.
 */
export const TEST_PRESET_RULES = {
  groupPresets,
  isProviderConfigured,
  nextConfigForPresetSelect,
  resolveSelectedPreset,
} satisfies VisitorPresetRules;
