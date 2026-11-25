// @vitest-environment jsdom
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { buildAllowWritePatch, useExternalMcpAddForm } from "../ExternalMcpSettingsPanel.hooks.js";

it("keeps explicit HTTP/auth choices and resets the draft before closing on cancel", () => {
  const reset = vi.fn();
  const setField = vi.fn();
  const buildFieldSpecs = vi.fn(({ transport, authMode }: { transport: string; authMode: string }) => [{ transport, authMode }]);
  const addSourceToList = vi.fn();
  const input = { dependencies: {}, list: { addSourceToList }, useDriftCopyHook: () => (key: string) => key, useSourceConfigAddFormHook: () => ({ values: { transport: "http", authMode: "oauth" }, setField, reset }), buildFieldSpecs, resolveTransport: (values: Record<string, string>) => values.transport || "stdio", resolveAuthMode: (values: Record<string, string>) => values.authMode || "static_env" };
  const { result } = renderHook(() => useExternalMcpAddForm(input));
  act(() => result.current.toggleForm());
  expect(result.current.formOpen).toBe(true);
  expect(setField).not.toHaveBeenCalled();
  expect(result.current.fieldSpecs).toEqual([{ transport: "http", authMode: "oauth" }]);
  act(() => result.current.cancelForm());
  expect(reset).toHaveBeenCalledTimes(1);
  expect(result.current.formOpen).toBe(false);
});

it("seeds only empty values while open and calls the installed list after add", () => {
  const addSourceToList = vi.fn();
  const input = { dependencies: {}, list: { addSourceToList }, useDriftCopyHook: () => (key: string) => key, useSourceConfigAddFormHook: ({ onAdded }: { onAdded: (source: { id: string }) => void }) => {
    const [values, setValues] = useState<Record<string, string>>({ transport: "", authMode: "" });
    return { values, setField: (name: string, value: string) => setValues(previous => ({ ...previous, [name]: value })), reset: () => setValues({ transport: "", authMode: "" }), onAdded };
  }, buildFieldSpecs: () => [], resolveTransport: (values: Record<string, string>) => values.transport || "stdio", resolveAuthMode: (values: Record<string, string>) => values.authMode || "static_env" };
  const { result } = renderHook(() => useExternalMcpAddForm(input));
  expect(result.current.addForm.values).toEqual({ transport: "", authMode: "" });
  act(() => result.current.toggleForm());
  expect(result.current.addForm.values).toEqual({ transport: "stdio", authMode: "static_env" });
  const source = { id: "installed" };
  act(() => result.current.addForm.onAdded(source));
  expect(addSourceToList).toHaveBeenCalledExactlyOnceWith(source);
  expect(result.current.formOpen).toBe(false);
});

it("patches only the matched server's write allowlist", () => {
  const sources = [{ id: "server", fields: { token: "hidden", writeAllowedToolNames: "old" } }];
  const grantWriteFieldValue = vi.fn(() => "old,new");
  expect(buildAllowWritePatch({ sources, connectionId: "unknown", remoteName: "new", grantWriteFieldValue })).toBeNull();
  expect(grantWriteFieldValue).not.toHaveBeenCalled();
  expect(buildAllowWritePatch({ sources, connectionId: "server", remoteName: "new", grantWriteFieldValue })).toEqual({ fields: { writeAllowedToolNames: "old,new" } });
  expect(grantWriteFieldValue).toHaveBeenCalledExactlyOnceWith({ currentWriteAllowedToolNames: "old", remoteName: "new" });
});
