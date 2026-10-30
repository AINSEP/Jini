import { describe, expect, it, vi } from "vitest";
import { openCheckout } from "../../client.js";
import type { NextAction } from "../../contract/evidence.js";

describe("openCheckout", () => {
  it.each([
    [null, "pending"], [{ kind: "none" }, "none"], [{ kind: "out_of_band", instructions: "Pay offline" }, "out_of_band"],
  ] as const)("reports %j without navigating", async (next, state) => {
    const navigate = vi.fn();
    expect(await openCheckout({ next, navigate })).toEqual({ kind: "nothing_to_open", next: state });
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(["https://checkout.example/session", "http://localhost:3000/pay", "http://127.0.0.1:8080/pay"])("opens %s", async (url) => {
    const navigate = vi.fn();
    expect(await openCheckout({ next: { kind: "redirect", url }, navigate })).toEqual({ kind: "navigated", url });
    expect(navigate.mock.calls).toEqual([[{ url }]]);
  });

  it.each([
    "http://evil.example/pay", "javascript:alert(1)", "data:text/html,pay", "not a URL", "/checkout", "//checkout.example/pay",
    "ftp://localhost/pay", "http://localhost.evil.example/pay", "http://localhost@evil.example/pay", "http://[::1]/pay",
  ])("refuses %s without navigating", async (url) => {
    const navigate = vi.fn();
    expect(await openCheckout({ next: { kind: "redirect", url }, navigate })).toEqual({ kind: "refused", reason: "unsafe_url" });
    expect(navigate).not.toHaveBeenCalled();
  });

  const next: NextAction = { kind: "client_action", payload: { token: "opaque", step: 2 } };
  it("refuses a client action without a handler", async () => {
    const navigate = vi.fn();
    expect(await openCheckout({ next, navigate })).toEqual({ kind: "refused", reason: "no_client_action_handler" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("waits for the client action and forwards its payload without navigating", async () => {
    let finish!: () => void;
    const clientAction = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const navigate = vi.fn();
    let completed = false;
    const result = openCheckout({ next, navigate }, { clientAction }).then(value => { completed = true; return value; });
    expect(clientAction.mock.calls).toEqual([[{ payload: next.payload }]]);
    await Promise.resolve();
    expect(completed).toBe(false);
    finish();
    expect(await result).toEqual({ kind: "client_action_handled" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("propagates handler rejection", async () => {
    const error = new Error("client action failed");
    const navigate = vi.fn();
    await expect(openCheckout({ next, navigate }, { clientAction: async () => { throw error; } })).rejects.toBe(error);
    expect(navigate).not.toHaveBeenCalled();
  });
});
