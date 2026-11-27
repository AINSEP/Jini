import { describe, expect, it, vi } from "vitest";
import { activateAssistantDaemon, prepareAssistantPageBinding, type PageBindingBridge } from "../assistant-daemon-activation.js";

const ok = () => Promise.resolve(new Response(null, { status: 204 }));
const bridge = (token: string | null = "tok"): PageBindingBridge => ({ rebind: vi.fn(() => Promise.resolve()), bindToken: () => token });

describe("activateAssistantDaemon", () => {
  it("posts to the activation route with credentials", async () => {
    const request = vi.fn(ok) as unknown as typeof fetch;
    await activateAssistantDaemon({}, { request });
    expect(request).toHaveBeenCalledWith("/api/frontend-sessions/activate", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  });

  it("surfaces the server's public refusal reason and details", async () => {
    const request = (() => Promise.resolve(Response.json({ error: "Not ready", code: "E1", detail: "d" }, { status: 503 }))) as unknown as typeof fetch;
    await expect(activateAssistantDaemon({}, { request })).rejects.toThrow("Not ready\nDetails: HTTP 503; E1; d");
  });

  it("falls back to HTTP recovery guidance for a non-JSON refusal", async () => {
    const request = (() => Promise.resolve(new Response("<html>", { status: 502 }))) as unknown as typeof fetch;
    await expect(activateAssistantDaemon({}, { request })).rejects.toThrow("returned HTTP 502");
  });

  it("explains a transport failure with the cause attached", async () => {
    const request = (() => Promise.reject(new TypeError("down"))) as unknown as typeof fetch;
    await expect(activateAssistantDaemon({}, { request })).rejects.toThrow("could not reach its page service");
  });
});

describe("prepareAssistantPageBinding", () => {
  it("returns undefined and still reports settlement when there is no page bridge", async () => {
    const onActivationSettled = vi.fn();
    const activate = vi.fn(() => Promise.resolve());
    await expect(prepareAssistantPageBinding({}, { activate, onActivationSettled })).resolves.toBeUndefined();
    expect(onActivationSettled).toHaveBeenCalledOnce();
  });

  it("rebinds the bridge and returns its token", async () => {
    const b = bridge("abc");
    await expect(prepareAssistantPageBinding({ bridge: b }, { activate: () => Promise.resolve() })).resolves.toBe("abc");
    expect(b.rebind).toHaveBeenCalledOnce();
  });

  it("fails when no token exists after attachment", async () => {
    await expect(prepareAssistantPageBinding({ bridge: bridge(null) }, { activate: () => Promise.resolve() })).rejects.toThrow("no page binding token");
  });

  it("settles even when activation fails, then rethrows", async () => {
    const onActivationSettled = vi.fn();
    await expect(prepareAssistantPageBinding({}, { activate: () => Promise.reject(new Error("boom")), onActivationSettled })).rejects.toThrow("boom");
    expect(onActivationSettled).toHaveBeenCalledOnce();
  });
});

it("distinguishes an unreadable refusal body from a non-JSON body", async () => {
  const response = new Response("unavailable", { status: 503 });
  await response.text(); // The body is now consumed, so json() rejects with TypeError rather than SyntaxError.
  const request: typeof fetch = async () => response;
  await expect(activateAssistantDaemon({}, { request })).rejects.toMatchObject({
    message: "The assistant could not read its page service response (HTTP 503). Reload this admin page, then retry your message.",
    cause: expect.any(TypeError),
  });
});

it("keeps the attachment error and recommends reloading after an unsuccessful rebind", async () => {
  const cause = new Error("page bridge disconnected");
  const b: PageBindingBridge = { rebind: async () => { throw cause; }, bindToken: () => "stale-token" };
  await expect(prepareAssistantPageBinding({ bridge: b }, { activate: async () => {} })).rejects.toMatchObject({
    message: "The assistant could not attach to this page. Reload this admin page, then retry your message. Details: page attachment did not finish after service activation.",
    cause,
  });
});
