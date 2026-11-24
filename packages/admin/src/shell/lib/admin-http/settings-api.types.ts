import type { AdminSettingValueDto, AdminSettingsResetDto } from "@jini-ai/core/contracts/site/cms-settings";

// SPEC-007 Settings (core-only layered ledger) — the settings response contracts. Both bodies are the
// server's wire shapes, declared once in Jini Core (`@jini-ai/core/contracts/site/cms-settings`,
// rv1123e K1): the `@jini-ai/cms` settings route specs answer exactly these, so the client no longer
// restates them.
export type SettingValueResponse = AdminSettingValueDto;

export type SettingResetResponse = AdminSettingsResetDto;
