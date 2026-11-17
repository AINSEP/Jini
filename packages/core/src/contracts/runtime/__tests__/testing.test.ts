import { describe, expect, it } from "vitest";
import { fakeAtomicWriter, fakeFileLock, fakeGuardedHttp, fakeHttpFetch, fakeProcessControl } from "../testing.js";

describe("fakeFileLock", () => {
  it("records each lock path and the options it was given, in call order", async () => {
    const lock = fakeFileLock();
    await lock.withFileLock({ lockPath: "/a.lock", run: () => 1 }, { timeoutMs: 5 });
    await lock.withFileLock({ lockPath: "/b.lock", run: () => 2 });
    expect(lock.calls).toEqual([{ lockPath: "/a.lock", options: { timeoutMs: 5 } }, { lockPath: "/b.lock", options: undefined }]);
  });

  it("holds the path only while the critical section runs, also when it throws", async () => {
    const lock = fakeFileLock();
    let heldInside: boolean | undefined;
    await expect(lock.withFileLock({ lockPath: "/a.lock", run: async (held) => { heldInside = lock.held.has("/a.lock"); await held.assertHeld({}); throw new Error("boom"); } })).rejects.toThrow("boom");
    expect(heldInside).toBe(true);
    expect(lock.held.has("/a.lock")).toBe(false);
  });

  it("returns what the critical section returns", async () => {
    await expect(fakeFileLock().withFileLock({ lockPath: "/a.lock", run: async () => "value" })).resolves.toBe("value");
  });
});

describe("fakeAtomicWriter", () => {
  it("stores text and bytes by path and records the options without acting on them", async () => {
    const writer = fakeAtomicWriter();
    await writer.writeText({ filePath: "/a.txt", content: "hi" }, { createParent: true, mode: 0o600 });
    await writer.writeText({ filePath: "/b.bin", content: new Uint8Array([1]) });
    expect(writer.files.get("/a.txt")).toBe("hi");
    expect(writer.files.get("/b.bin")).toEqual(new Uint8Array([1]));
    expect(writer.writes).toEqual([
      { method: "writeText", filePath: "/a.txt", options: { createParent: true, mode: 0o600 } },
      { method: "writeText", filePath: "/b.bin", options: undefined },
    ]);
  });

  it("serializes JSON as the platform writer does and adds the newline only when asked", async () => {
    const writer = fakeAtomicWriter();
    await writer.writeJson({ filePath: "/a.json", data: { a: 1 } });
    await writer.writeJson({ filePath: "/b.json", data: [1] }, { trailingNewline: true });
    expect(writer.files.get("/a.json")).toBe('{\n  "a": 1\n}');
    expect(writer.files.get("/b.json")).toBe("[\n  1\n]\n");
  });

  it("refuses data JSON cannot represent, as the platform writer does", async () => {
    await expect(fakeAtomicWriter().writeJson({ filePath: "/a.json", data: undefined })).rejects.toThrow(TypeError);
  });

  it("records backups in call order", async () => {
    const writer = fakeAtomicWriter();
    await writer.backupOriginalOnce({ filePath: "/x" });
    await writer.backupOriginalOnce({ filePath: "/y" });
    expect(writer.backups).toEqual(["/x", "/y"]);
  });
});

describe("fakeProcessControl", () => {
  const processes = [{ pid: 1, ppid: 0, command: "init" }, { pid: 10, ppid: 1, command: "parent" }, { pid: 11, ppid: 10, command: "child" }];

  it("lists copies of the table", async () => {
    const control = fakeProcessControl({}, { processes });
    const listed = await control.listProcessSnapshots();
    expect(listed).toEqual(processes);
    expect(listed[0]).not.toBe(processes[0]);
  });

  it("stops the requested pids with their descendants and records the request", async () => {
    const control = fakeProcessControl({}, { processes });
    const result = await control.stopProcesses({ pids: [10, null] });
    expect(result).toEqual({ alreadyStopped: false, forcedPids: [], matchedPids: [11, 10], remainingPids: [], stoppedPids: [11, 10] });
    expect(control.stopRequests).toEqual([[10, null]]);
    expect((await control.listProcessSnapshots()).map((p) => p.pid)).toEqual([1]);
  });

  it("reports alreadyStopped for a pid that is not in the table", async () => {
    const result = await fakeProcessControl().stopProcesses({ pids: [99] });
    expect(result.alreadyStopped).toBe(true);
    expect(result.matchedPids).toEqual([]);
  });

  it("answers waitForProcessExit from the table and records the pid", async () => {
    const control = fakeProcessControl({}, { processes });
    expect(await control.waitForProcessExit({ pid: 10 })).toBe(false);
    await control.stopProcesses({ pids: [10] });
    expect(await control.waitForProcessExit({ pid: 10 })).toBe(true);
    expect(await control.waitForProcessExit({ pid: null })).toBe(true);
    expect(control.waited).toEqual([10, 10, null]);
  });
});

describe("fakeHttpFetch", () => {
  it("answers 200 with an empty body by default and records url, timeout and init in order", async () => {
    const fetcher = fakeHttpFetch();
    const response = await fetcher.fetchWithTimeout({ url: new URL("https://a.test/x"), timeoutMs: 7 }, { init: { method: "POST" } });
    await fetcher.fetchWithTimeout({ url: "https://a.test/y", timeoutMs: 8 });
    expect(response.status).toBe(200);
    expect(await fetcher.readResponseText({ response })).toBe("");
    expect(fetcher.calls).toEqual([
      { url: "https://a.test/x", timeoutMs: 7, init: { method: "POST" } },
      { url: "https://a.test/y", timeoutMs: 8, init: undefined },
    ]);
  });

  it("answers from the supplied responder with the url and init it was asked for", async () => {
    const fetcher = fakeHttpFetch({}, { respond: ({ url, init }) => new Response(`${url}|${init?.method}`, { status: 201 }) });
    const response = await fetcher.fetchWithTimeout({ url: "https://a.test/z", timeoutMs: 1 }, { init: { method: "PUT" } });
    expect(response.status).toBe(201);
    expect(await fetcher.readResponseText({ response })).toBe("https://a.test/z|PUT");
  });
});

describe("fakeGuardedHttp", () => {
  const required = { transport: {} as never, policy: {} as never, dns: {} as never, clock: {} as never, userAgent: "ua" };

  it("serves the route for METHOD url, records the request and the client it came from", async () => {
    const guarded = fakeGuardedHttp({ routes: { "GET https://a.test/x": { status: 200, bodyText: "ok", headers: { a: "b" } } } });
    const client = guarded.createClient(required);
    const request = { method: "GET", url: "https://a.test/x", headers: {}, idleTimeoutMs: 1 } as const;
    expect(await client.send({ request })).toEqual({ status: 200, headers: { a: "b" }, bodyText: "ok", finalUrl: "https://a.test/x" });
    expect(guarded.requests).toEqual([request]);
    expect(guarded.clients).toEqual([required]);
  });

  it("lets a route function see the request", async () => {
    const guarded = fakeGuardedHttp({ routes: { "POST https://a.test/p": (request) => ({ status: 202, bodyText: String(request.body) }) } });
    const response = await guarded.createClient(required).send({ request: { method: "POST", url: "https://a.test/p", headers: {}, body: "payload", idleTimeoutMs: 1 } });
    expect(response).toMatchObject({ status: 202, bodyText: "payload" });
  });

  it("answers 404 for a request no route matches", async () => {
    const response = await fakeGuardedHttp({ routes: {} }).createClient(required).send({ request: { method: "GET", url: "https://a.test/none", headers: {}, idleTimeoutMs: 1 } });
    expect(response.status).toBe(404);
  });

  it("projects the guarded answer into a Response, forwarding method, headers and a string body", async () => {
    const guarded = fakeGuardedHttp({ routes: { "POST https://a.test/p": (request) => ({ status: 201, bodyText: `${request.method}|${request.headers.k}|${request.body}`, headers: { x: "1" } }) } });
    const client = guarded.createClient(required);
    const response = await guarded.fetch({ client, url: "https://a.test/p", timeoutMs: 1 }, { method: "POST", headers: { k: "v" }, body: "b" });
    expect(response.status).toBe(201);
    expect(response.headers.get("x")).toBe("1");
    expect(await response.text()).toBe("POST|v|b");
    const defaulted = await guarded.fetch({ client, url: "https://a.test/none", timeoutMs: 1 });
    expect(defaulted.status).toBe(404);
    expect(guarded.requests.map((r) => r.method)).toEqual(["POST", "GET"]);
  });
});
