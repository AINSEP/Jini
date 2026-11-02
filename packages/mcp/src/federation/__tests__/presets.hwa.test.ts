import { expect, test } from "vitest";
import { createFederatedMcpPresetRegistry } from "../presets.js";
import { resolveFederatedMcpPresets } from "../bootstrap.js";
import type { ResolvedFederatedConnection } from "../config.js";

const connection: ResolvedFederatedConnection = {
  config: { connectionId: "working", label: "Working", allowedToolNames: [], writeAllowedToolNames: [], connectTimeoutMs: 1000, callTimeoutMs: 1000, maxResultBytes: 1024, maxTools: 1 },
  launch: { command: "fixture", args: [], env: {} },
};

test("host registries isolate presets, replace in order and retain independent snapshots", () => {
  const a = createFederatedMcpPresetRegistry({}), b = createFederatedMcpPresetRegistry({});
  a.register({ preset: { presetId: "one", resolve: () => null } });
  a.register({ preset: { presetId: "two", resolve: () => connection } });
  const snapshot = a.list({});
  a.register({ preset: { presetId: "one", resolve: () => connection } });
  expect(a.list({}).map(preset => preset.presetId)).toEqual(["one", "two"]);
  expect(snapshot[0]!.resolve({ env: {} })).toBeNull();
  expect(a.list({})[0]!.resolve({ env: {} })).toBe(connection);
  expect(b.list({})).toEqual([]);
  a.reset({});
  expect(snapshot).toHaveLength(2);
});

test("resolution uses the supplied host only and a broken preset cannot suppress its sibling", () => {
  const registry = createFederatedMcpPresetRegistry({});
  const env = { HOST: "selected" }, warnings: string[] = [];
  registry.register({ preset: { presetId: "broken", resolve: () => { throw new Error("invalid fixture"); } } });
  registry.register({ preset: { presetId: "working", resolve: input => { expect(input.env).toBe(env); return connection; } } });
  const logger = { warn: ({ message }: { message: string }) => { warnings.push(message); } };
  expect(resolveFederatedMcpPresets({ registry, env, logger })).toEqual([connection]);
  expect(warnings).toEqual([expect.stringContaining("mcp-federation: preset 'broken' configuration is invalid, continuing without federated tools — Error: invalid fixture")]);
  expect(resolveFederatedMcpPresets({ registry: createFederatedMcpPresetRegistry({}), env, logger })).toEqual([]);
});

test('redacts failed preset credentials while preserving sibling federation', () => {
  const secret = 'ghp_' + 's'.repeat(36);
  const registry = createFederatedMcpPresetRegistry({});
  registry.register({ preset: { presetId: 'broken', resolve: () => { throw new Error(`invalid configuration ${secret}`); } } });
  registry.register({ preset: { presetId: 'working', resolve: () => connection } });
  const warnings: string[] = [];
  expect(resolveFederatedMcpPresets({ registry, env: {}, logger: { warn: ({ message }) => { warnings.push(message); } } })).toEqual([connection]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('Error: invalid configuration [REDACTED:github_token]');
  expect(warnings[0]).not.toContain(secret);
});
