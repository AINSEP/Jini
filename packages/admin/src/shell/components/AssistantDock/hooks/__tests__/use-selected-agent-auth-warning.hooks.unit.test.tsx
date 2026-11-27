// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useSelectedAgentAuthWarning } from "../use-selected-agent-auth-warning.hooks.js";

type Detected = { id: string; signedIn: boolean };
const warning = ({ mode, agentId, locale, agents }: { mode: string; agentId: string | null; locale: string; agents: readonly Detected[] }) =>
  mode === "local-cli" && agents.some(agent => agent.id === agentId && !agent.signedIn) ? `${locale}: sign into ${agentId}` : null;

it("returns picker rescan results immediately and ignores a stale detection that finishes after the auth rescan", async () => {
  let resolveInitial!: (agents: Detected[]) => void;
  const initial = new Promise<Detected[]>(resolve => { resolveInitial = resolve; });
  const port = { detectLocalAgents: vi.fn(() => initial), rescanLocalAgents: vi.fn(async () => [{ id: "claude", signedIn: true }]) };
  const createPort = vi.fn(() => port);
  const rescanAgents = vi.fn(async () => [{ id: "picker-result" }]);
  const { result } = renderHook(() => useSelectedAgentAuthWarning({
    mode: "local-cli", agentId: undefined, locale: "fr", runtimeAccess: { rescanAgents }, selectWarning: warning, createPort,
  }));
  await waitFor(() => expect(port.detectLocalAgents).toHaveBeenCalledOnce());
  expect(result.current.warning).toBeNull();
  await act(async () => { await expect(result.current.runtimeAccess.rescanAgents()).resolves.toEqual([{ id: "picker-result" }]); });
  expect(port.rescanLocalAgents.mock.calls).toEqual([[]]);
  await act(async () => { resolveInitial([{ id: "claude", signedIn: false }]); });
  expect(result.current.warning).toBeNull();
});

it("uses default Claude for a missing selection and clears the warning when fallback detection fails", async () => {
  const detectLocalAgents = vi.fn<() => Promise<Detected[]>>()
    .mockResolvedValueOnce([{ id: "claude", signedIn: false }])
    .mockRejectedValueOnce(new Error("Detector unavailable"));
  const createPort = vi.fn(() => ({ detectLocalAgents }));
  const { result, rerender } = renderHook(({ mode }: { mode: string }) => useSelectedAgentAuthWarning({
    mode, agentId: null, locale: "de", runtimeAccess: { rescanAgents: async () => [] }, createPort, selectWarning: warning,
  }), { initialProps: { mode: "byok" } });
  expect(result.current.warning).toBeNull();
  expect(detectLocalAgents).not.toHaveBeenCalled();
  rerender({ mode: "local-cli" });
  await waitFor(() => expect(result.current.warning).toBe("de: sign into claude"));
  await act(async () => { await result.current.runtimeAccess.rescanAgents(); });
  expect(detectLocalAgents.mock.calls).toEqual([[], []]);
  expect(result.current.warning).toBeNull();
  expect(createPort).toHaveBeenCalledOnce();
});

it("uses an explicitly injected detector and refreshes the warning when the selected agent changes", async () => {
  const detectLocalAgents = vi.fn(async () => [{ id: "first", signedIn: false }, { id: "second", signedIn: true }]);
  const createPort = vi.fn(() => { throw new Error("Host factory should not run with an injected detector"); });
  const runtimeAccess = { rescanAgents: async () => [] };
  const { result, rerender } = renderHook(({ agentId }) => useSelectedAgentAuthWarning({
    agentId, mode: "local-cli", locale: "es", runtimeAccess, createPort, selectWarning: warning,
  }, { port: { detectLocalAgents } }), { initialProps: { agentId: "first" } });
  await waitFor(() => expect(result.current.warning).toBe("es: sign into first"));
  rerender({ agentId: "second" });
  await waitFor(() => expect(detectLocalAgents).toHaveBeenCalledTimes(2));
  expect(result.current.warning).toBeNull();
  expect(createPort).not.toHaveBeenCalled();
});
