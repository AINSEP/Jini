import { expect, test, vi } from "vitest";
import { createInstalledSkillsComposerCapabilitySource } from "../installed-skills-composer-source.js";

type Request = Parameters<typeof createInstalledSkillsComposerCapabilitySource>[0]["request"];

test("forced refresh supersedes older work and 304 preserves the last good snapshot", async () => {
  let resolveOlder: (value: unknown) => void = () => {};
  const older = new Promise<unknown>(resolve => { resolveOlder = resolve; });
  const request = vi.fn<Parameters<typeof createInstalledSkillsComposerCapabilitySource>[0]["request"]>();
  request.mockImplementationOnce(<T,>() => older as Promise<T>);
  request.mockImplementationOnce(async <T,>(_input: unknown, options: Parameters<Parameters<typeof createInstalledSkillsComposerCapabilitySource>[0]["request"]>[1]) => {
    options.onOk({ response: new Response(null, { headers: { ETag: "new" } }) });
    return { skills: [{ toolId: "new", name: "New", description: "summary", markdown: "private" }] } as T;
  });
  const reportFailure = vi.fn();
  const source = createInstalledSkillsComposerCapabilitySource({ request: <T,>(input: Parameters<Request>[0], options: Parameters<Request>[1]) => request(input, options) as Promise<T>, path: "/skills", isNotModified: error => error === "304", reportFailure });
  const stale = source.reload();
  const fresh = await source.reload({}, { force: true });
  resolveOlder({ skills: [{ toolId: "old", name: "Old", description: "summary" }] });
  await stale;
  expect(await source.list()).toBe(fresh);
  expect(fresh[0]?.item.id).toBe("installed-skill:new");
  expect(JSON.stringify(fresh)).not.toContain("private");
  request.mockRejectedValueOnce("304");
  expect(await source.reload()).toBe(fresh);
  expect(request).toHaveBeenLastCalledWith({ path: "/skills", method: "GET" }, { headers: { "If-None-Match": "new" }, onOk: expect.any(Function) });
  request.mockResolvedValueOnce({ skills: "invalid" });
  expect(await source.reload()).toBe(fresh);
  expect(reportFailure).toHaveBeenCalledTimes(1);
  request.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
  expect(await source.reload()).toBe(fresh);
  expect(reportFailure).toHaveBeenCalledTimes(1);
});
