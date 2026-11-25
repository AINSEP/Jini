// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { useByokModels } from "../byok-runtime.hooks.js";

it("discards a discovery that settles after its endpoint changed", async () => {
  const config: ExecutionConfig = { mode: "byok", byok: { protocol: "openai", providerId: null, apiKey: "saved", baseUrl: "first", model: "" }, localCli: { agentId: null } };
  let resolve!: (value: readonly string[]) => void;
  const pending = new Promise<readonly string[]>(done => { resolve = done; });
  const listModels = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(["current"]);
  const createPort = () => ({ listModels });
  const { result, rerender } = renderHook(({ executionConfig }) => useByokModels({ executionConfig, createPort }), { initialProps: { executionConfig: config } });
  await act(async () => { rerender({ executionConfig: { ...config, byok: { ...config.byok, baseUrl: "second" } } }); });
  expect(result.current).toEqual([{ id: "current", label: "current" }]);
  await act(async () => { resolve(["obsolete"]); await pending; });
  expect(result.current).toEqual([{ id: "current", label: "current" }]);
});
