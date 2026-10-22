import { describe, expect, it, vi } from "vitest";
import { createA2uiActionPoster, createChatAttachmentValidator } from "../entry.js";
import type { ChatAttachment } from "../../messages.js";

/** A fetch that never answers on its own and rejects the way browsers do once its signal aborts. */
function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as typeof fetch;
}

function poster(fetchImpl: typeof fetch, options: { timeoutMs?: number; headers?: Record<string, string> } = {}) {
  const reportFailure = vi.fn();
  const post = createA2uiActionPoster({ baseUrl: "https://host.test/", path: "/api/a2ui/actions", fetch: fetchImpl, reportFailure }, options);
  return { post, reportFailure };
}

const action = (surfaceId: unknown) => ({ action: { name: "continue", surfaceId } });

describe("createA2uiActionPoster", () => {
  it("POSTs the exchange id and message as JSON with forced content-type and resolves ok", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const { post, reportFailure } = poster(fetchImpl as unknown as typeof fetch, { headers: { "content-type": "text/plain", "x-trace": "t1" } });
    await expect(post("run-1", action("ex-1"))).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://host.test/api/a2ui/actions");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toEqual({ "x-trace": "t1", "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ exchangeId: "ex-1", message: action("ex-1") });
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("addresses an error message by its surfaceId when the action has none", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const { post } = poster(fetchImpl as unknown as typeof fetch);
    await expect(post(undefined, { action: { surfaceId: 7 }, error: { surfaceId: "ex-err" } })).resolves.toEqual({ ok: true });
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).exchangeId).toBe("ex-err");
  });

  it.each([
    [null, "run-2", "(run run-2)"],
    ["not an object", undefined, "(run unknown)"],
    [action(""), "run-3", "(run run-3)"],
    [{ functionResponse: { functionCallId: "f1" } }, "run-4", "(run run-4)"],
  ])("refuses to send a message with no usable surfaceId (%j) and reports it", async (message, runId, runLabel) => {
    const fetchImpl = vi.fn();
    const { post, reportFailure } = poster(fetchImpl as unknown as typeof fetch);
    await expect(post(runId, message)).resolves.toEqual({ ok: false, reason: "This action doesn't say which surface it answers, so there's nowhere to send it." });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(String(reportFailure.mock.calls[0]![0].args[0])).toContain(runLabel);
  });

  it.each([
    [409, "This surface is no longer waiting for a response — the agent has already moved on."],
    [400, "The agent didn't recognize this action. Reloading the conversation may fix it."],
    [401, "Your session couldn't be verified. Try reloading the page."],
    [503, "The action couldn't be delivered (server returned 503)."],
  ])("turns a %i into plain wording and reports the server's detail", async (status, reason) => {
    const { post, reportFailure } = poster((async () => new Response("closed exchange", { status })) as unknown as typeof fetch);
    await expect(post("run-1", action("ex-1"))).resolves.toEqual({ ok: false, reason });
    expect(reportFailure).toHaveBeenCalledWith({ args: [`[a2ui] action delivery failed (${status}) for surface ex-1`, "closed exchange"] }, {});
  });

  it("still reports a failed status when its body cannot be read", async () => {
    const unreadable = { ok: false, status: 500, text: () => Promise.reject(new Error("stream broken")) } as unknown as Response;
    const { post, reportFailure } = poster((async () => unreadable) as unknown as typeof fetch);
    await expect(post("run-1", action("ex-1"))).resolves.toEqual({ ok: false, reason: "The action couldn't be delivered (server returned 500)." });
    expect(reportFailure.mock.calls[0]![0].args[1]).toBe("");
  });

  it("gives up after the timeout and says so", async () => {
    const { post, reportFailure } = poster(hangingFetch(), { timeoutMs: 5 });
    await expect(post("run-1", action("ex-1"))).resolves.toEqual({ ok: false, reason: "This took too long to deliver and was given up on." });
    expect(reportFailure.mock.calls[0]![0].args[1]).toBe("timed out after 5ms");
  });

  it("reports a network failure with the underlying error", async () => {
    const failure = new TypeError("Failed to fetch");
    const { post, reportFailure } = poster((async () => { throw failure; }) as unknown as typeof fetch);
    await expect(post("run-1", action("ex-1"))).resolves.toEqual({ ok: false, reason: "Couldn't reach the server to deliver this action." });
    expect(reportFailure.mock.calls[0]![0].args).toEqual(["[a2ui] action delivery failed for surface ex-1", failure]);
  });

  it("uses a 30s default timeout that a fast response never hits", async () => {
    vi.useFakeTimers();
    try {
      const reportFailure = vi.fn();
      const post = createA2uiActionPoster({ baseUrl: "", path: "/a", fetch: hangingFetch(), reportFailure });
      const pending = post("run-1", action("ex-1"));
      await vi.advanceTimersByTimeAsync(29_999);
      expect(reportFailure).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ ok: false, reason: "This took too long to deliver and was given up on." });
    } finally {
      vi.useRealTimers();
    }
  });
});

const attachment = (path: string): ChatAttachment => ({ path, name: `${path}.png`, kind: "image" });

describe("createChatAttachmentValidator", () => {
  const endpoint = ({ ref }: { ref: string }) => `/api/attachments/${encodeURIComponent(ref)}`;
  const isSupportedRef = ({ ref }: { ref: string }) => ref.startsWith("attachment:");

  it("keeps only references the server still serves, in order, probing each with HEAD", async () => {
    const live = new Set(["/api/attachments/attachment%3Aa", "/api/attachments/attachment%3Ac"]);
    const fetchImpl = vi.fn(async (url: string) => new Response(null, { status: live.has(url) ? 200 : 404 }));
    const validate = createChatAttachmentValidator({ fetch: fetchImpl as unknown as typeof fetch, endpoint, isSupportedRef, maxProbedAttachments: 10 });
    const result = await validate([attachment("attachment:a"), attachment("attachment:b"), attachment("attachment:c")]);
    expect(result.map(item => item.path)).toEqual(["attachment:a", "attachment:c"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ method: "HEAD", credentials: "same-origin" });
  });

  it("never probes malformed references or more than the cap, and probes nothing when none qualify", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const validate = createChatAttachmentValidator({ fetch: fetchImpl as unknown as typeof fetch, endpoint, isSupportedRef, maxProbedAttachments: 2 });
    expect(await validate([attachment("https://evil.test/x"), attachment("attachment:a"), attachment("attachment:b")])).toEqual([attachment("attachment:a")]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await validate([attachment("../etc/passwd")])).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("drops a reference whose probe fails or times out, without rejecting", async () => {
    let call = 0;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) return Promise.reject(new TypeError("offline"));
      return hangingFetch()(url, init);
    }) as typeof fetch;
    const validate = createChatAttachmentValidator({ fetch: fetchImpl, endpoint, isSupportedRef, maxProbedAttachments: 5 }, { timeoutMs: 5, concurrency: 0 });
    await expect(validate([attachment("attachment:a"), attachment("attachment:b")])).resolves.toEqual([]);
    expect(call).toBe(2);
  });

  it("caps probes in flight at the default of two", async () => {
    let inFlight = 0, peak = 0;
    const fetchImpl = (async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 2));
      inFlight -= 1;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const validate = createChatAttachmentValidator({ fetch: fetchImpl, endpoint, isSupportedRef, maxProbedAttachments: 10 });
    const refs = ["a", "b", "c", "d", "e"].map(id => attachment(`attachment:${id}`));
    expect(await validate(refs)).toEqual(refs);
    expect(peak).toBe(2);
  });
});
