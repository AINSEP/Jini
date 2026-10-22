import assert from "node:assert/strict";
import type { ToolExecutionContext } from "@jini-ai/core";
import { InMemorySettingsPrincipalLookup } from "./principal.fixture.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { buildSettingsRegistrations, type SettingsToolDeps } from "../tool-registrations.js";
import type { SettingDefinitionRecord } from "../types.js";

export function definition(overrides: Partial<SettingDefinitionRecord> = {}): SettingDefinitionRecord {
  return {
    settingId: "setting-1", version: 1, workspaceId: null, namespace: "core.presentation", key: "timezone",
    ownerKind: "core", ownerId: null, schema: { type: "string" }, defaultValue: "UTC", scopes: 7,
    secret: false, status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null,
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...overrides,
  };
}

export function fixture(defs = [definition()], overrides: Partial<SettingsToolDeps> = {}) {
  const settingsRepo = new InMemorySettingsRepo({ definitions: defs });
  const authorizeCalls: unknown[] = [];
  const deps: SettingsToolDeps = {
    workspaceId: "ws-1", settingsRepo, principalRepo: new InMemorySettingsPrincipalLookup([]),
    clock: { nowMs: () => Date.parse("2026-10-01T00:00:00.000Z")}, idGen: { newId: () => "unused" },
    settingsReady: Promise.resolve(), settingsUiTabsReady: Promise.resolve(),
    authorize: async (input) => { authorizeCalls.push(input); return { allowed: true, reason: "matched" }; },
    ...overrides,
  };
  const registrations = buildSettingsRegistrations(deps);
  const call = (id: string, input: Record<string, unknown>, extras: Partial<ToolExecutionContext> = {}) => {
    const registration = registrations.find((r) => r.descriptor.id === id);
    assert.ok(registration, `expected '${id}' to be wired`);
    return registration.handler({ executionId: "exec-1", principal: { id: "caller" }, run: { id: "run-1" }, input, signal: new AbortController().signal, ...extras } as ToolExecutionContext);
  };
  return { deps, settingsRepo, authorizeCalls, registrations, call };
}

export const target = { namespace: "core.presentation", key: "timezone" };
