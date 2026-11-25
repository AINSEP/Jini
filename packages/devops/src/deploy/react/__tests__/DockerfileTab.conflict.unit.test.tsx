// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { DockerfileTab } from "../DockerfileTab.js";
import { useDockerfileSource, type DockerfileSourceController } from "../hooks/use-dockerfile-source.hooks.js";

test("412 retains the draft and reload changes only the captured ETag for the next save", async () => {
  const node = document.createElement("div");
  const root = createRoot(node);
  const conflict = new Error("conflict");
  const getDockerfileSource = vi.fn().mockResolvedValueOnce({ exists: true, contents: "FROM old", etag: '"old"' }).mockResolvedValueOnce({ exists: true, contents: "FROM remote", etag: '"remote"' });
  const setDockerfileSource = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ exists: true, contents: "FROM local", etag: '"saved"' });
  const reset = vi.fn();
  const useFetchQueryHook: FetchQueryAdapter["useFetchQuery"] = <T,>({ fetch }: { key: readonly (string | number)[]; fetch: () => Promise<T> }) => {
    const [data, setData] = useState<T>();
    useEffect(() => { void fetch().then(setData); }, []);
    return { data, error: null, status: data ? "success" : "loading", isFetching: false, refetch: () => {} };
  };
  const useFetchMutationHook: FetchQueryAdapter["useFetchMutation"] = ({ run }) => ({ mutate: run, status: "idle", error: null, reset });
  let current: DockerfileSourceController | undefined;
  function useController() {
    current = useDockerfileSource({ port: { getDockerfileSource, setDockerfileSource }, locale: "en", t: key => key, useFetchQueryHook, useFetchMutationHook, useDirtyGuardHook: ({ current: draft, original }) => ({ isDirty: draft !== original }), readSaveConflict: ({ error }) => error === conflict ? { exists: true, contents: "FROM remote" } : null, describeFailure: () => "failure", writeClipboard: async () => {} });
    return current;
  }
  await act(async () => { root.render(<DockerfileTab useDockerfileSourceHook={useController} download={() => {}} dockerfileLineCountLabel={({ count }) => String(count)} agentHandle={agentHandle} lineIcon={{ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }} />); });
  const controller = () => { if (!current) throw new Error("not mounted"); return current; };
  await act(async () => { controller().setDraft("FROM local"); });
  await act(async () => { await controller().save(); });
  expect(setDockerfileSource).toHaveBeenNthCalledWith(1, { contents: "FROM local", ifMatch: '"old"' });
  expect(controller().draft).toBe("FROM local");
  expect(node.textContent).toContain("FROM remote");
  expect(reset).toHaveBeenCalledTimes(1);
  await act(async () => { await controller().reloadAfterConflict(); });
  expect(controller().draft).toBe("FROM local");
  expect(controller().saveConflict).toBeNull();
  await act(async () => { await controller().save(); });
  expect(setDockerfileSource).toHaveBeenNthCalledWith(2, { contents: "FROM local", ifMatch: '"remote"' });
  await act(async () => { root.unmount(); });
});
