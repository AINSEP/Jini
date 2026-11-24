import { describe, expect, it } from "vitest";
import type { JsonRouteSpec } from "@jini-ai/core/contracts/server";
import type {
  AdminSettingClearedDto, AdminSettingScopeDto, AdminSettingsListDto, AdminSettingsRegisterDefinitionsDto, AdminSettingsResetDto, AdminSettingValueDto,
} from "@jini-ai/core/contracts/site/cms-settings";
import type { EffectiveSettingRow, SettingScope } from "@jini-ai/core/settings";

import type { settingsClearRoute } from "../clear.js";
import type { settingsGetEffectiveRoute } from "../get-effective.js";
import type { SettingsDefinitionSummary, settingsListDefinitionsRoute } from "../list-definitions.js";
import type { settingsRegisterDefinitionsRoute } from "../register-definitions.js";
import type { settingsResetRoute } from "../reset.js";
import type { settingsSetRoute } from "../set.js";

/**
 * @file rv1123e K1 migration: the settings wire DTOs are declared once in neutral Core (the admin
 * client consumes the same declarations); each spec answers exactly them. Core restates the scope
 * union structurally, so a drift on either side fails `tsc` here.
 */
/** Mutual assignability, checked by the compiler: `true` only when each side accepts the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** The body type a spec's `handle` resolves to (its `Output` parameter). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- only the Output slot is inferred
type OutputOf<S> = S extends JsonRouteSpec<any, infer O, any, any> ? O : never;

describe("settings wire DTOs", () => {
  it("keeps Core's restated scope union identical to the settings domain's SettingScope", () => {
    const parity: [Same<SettingScope, AdminSettingScopeDto>] = [true];
    expect(parity).toEqual([true]);
  });

  it("types every settings spec's answer as the Core DTO", () => {
    const parity: [
      Same<OutputOf<typeof settingsSetRoute>, AdminSettingValueDto>,
      Same<OutputOf<typeof settingsClearRoute>, AdminSettingClearedDto>,
      Same<OutputOf<typeof settingsResetRoute>, AdminSettingsResetDto>,
      Same<OutputOf<typeof settingsRegisterDefinitionsRoute>, AdminSettingsRegisterDefinitionsDto>,
      Same<OutputOf<typeof settingsGetEffectiveRoute>, AdminSettingsListDto<EffectiveSettingRow>>,
      Same<OutputOf<typeof settingsListDefinitionsRoute>, AdminSettingsListDto<SettingsDefinitionSummary>>,
    ] = [true, true, true, true, true, true];
    expect(parity).toEqual([true, true, true, true, true, true]);
  });
});
