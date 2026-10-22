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
  expect(warnings).toEqual(["mcp-federation: preset 'broken' configuration is invalid, continuing without federated tools — invalid fixture"]);
  expect(resolveFederatedMcpPresets({ registry: createFederatedMcpPresetRegistry({}), env, logger })).toEqual([]);
});
