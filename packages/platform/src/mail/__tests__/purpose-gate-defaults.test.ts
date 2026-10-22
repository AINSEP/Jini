import { describe, expect, it, vi } from "vitest";
import { wrapMailerWithPurposeGate, type WrapMailerWithPurposeGateOptions } from "../purpose-scoped-mailer.js";
import type { MailerPort } from "../ports.js";

/** Runtime mode validation must happen before any delivery, even for interactive lanes. */
describe("purpose gate security defaults", () => {
  const success = { ok: true, providerMessageId: "id", acceptedAt: "2026-10-02T00:00:00Z" } as const;
  function fixture() {
    const send = vi.fn(async () => success);
    const sendBatch = vi.fn(async () => [success, success]);
    const inner: MailerPort = { capabilities: vi.fn(), send, sendBatch };
    const readiness = { isReady: vi.fn(() => false) };
    return { inner, readiness, send, sendBatch };
  }
  const message = { workspaceId: "ws", to: { email: "to@example.com" }, from: { email: "from@example.com" }, subject: "test" };
  const required = { message, workspaceId: "ws", idempotencyKey: "one", sourceContext: { module: "notification" } };
  it.each(["prod", "staging", "", undefined, null, 0, false])("rejects unknown mode %s at wrap time", mode => {
    const f = fixture();
    expect(() => wrapMailerWithPurposeGate({ ...f, mode } as unknown as WrapMailerWithPurposeGateOptions)).toThrow(TypeError);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.sendBatch).not.toHaveBeenCalled();
    expect(f.readiness.isReady).not.toHaveBeenCalled();
  });
  it("only explicit local mode bypasses the durable-path gate for sends and batches", async () => {
    const f = fixture();
    const production = wrapMailerWithPurposeGate({ inner: f.inner, readiness: f.readiness, mode: "production" });
    await expect(production.send(required)).rejects.toThrow("MAILER_SEND_REFUSED_NO_DURABLE_PATH");
    await expect(production.sendBatch({ ...required, messages: [message, message] })).rejects.toThrow("MAILER_SEND_REFUSED_NO_DURABLE_PATH");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.sendBatch).not.toHaveBeenCalled();
    const local = wrapMailerWithPurposeGate({ inner: f.inner, readiness: f.readiness, mode: "local" });
    await expect(local.send(required)).resolves.toEqual(success);
    await expect(local.sendBatch({ ...required, messages: [message, message] })).resolves.toEqual([success, success]);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.sendBatch).toHaveBeenCalledTimes(1);
  });
});
