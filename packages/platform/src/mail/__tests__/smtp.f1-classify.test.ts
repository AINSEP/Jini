import { describe, expect, it } from "vitest";
import { SmtpMailerAdapter } from "../smtp.js";

// F1 fix wave (Stryker L1 §4 mail/smtp.ts:40 — retryable range `>=400 && <500` boundaries and
// the field-type guards). Retry is the difference between "try again" and "silently dropped mail".
const clock = { nowMs: () => Date.parse("2026-01-01T00:00:00.000Z") };
const message = { from: { email: "a@example.com" }, to: [{ email: "b@example.com" }], subject: "s", text: "t" };
const failWith = (err: unknown) => new SmtpMailerAdapter({ transport: { sendMail: async () => { throw err; } }, clock } as never).send({ message } as never);
const smtpError = (fields: Record<string, unknown>, text = "smtp failed") => Object.assign(new Error(text), fields);

describe("SMTP failure classification", () => {
  it.each([
    [399, false], [400, true], [421, true], [499, true], [500, false], [550, false], [250, false],
  ])("responseCode %d → retryable=%s, errorCode SMTP_<code>", async (responseCode, retryable) => {
    expect(await failWith(smtpError({ responseCode }))).toEqual({ ok: false, retryable, errorCode: `SMTP_${responseCode}`, message: "smtp failed" });
  });

  it("a response code wins over a connection code", async () => {
    expect(await failWith(smtpError({ responseCode: 550, code: "ECONNECTION" }))).toMatchObject({ retryable: false, errorCode: "SMTP_550" });
  });

  it.each([["EAUTH", false], ["EENVELOPE", false], ["EMESSAGE", false], ["ECONNECTION", true], ["ETIMEDOUT", true]])("code %s → retryable=%s", async (code, retryable) => {
    expect(await failWith(smtpError({ code }))).toEqual({ ok: false, retryable, errorCode: code, message: "smtp failed" });
  });

  it.each([
    ["string responseCode", smtpError({ responseCode: "550" })],
    ["numeric code", smtpError({ code: 7 })],
    ["thrown string", "raw failure"],
    ["thrown null", null],
  ])("%s → unknown, retryable", async (_l, err) => {
    const result = await failWith(err);
    expect(result).toMatchObject({ ok: false, retryable: true, errorCode: "SMTP_UNKNOWN_ERROR" });
    expect((result as { message: string }).message).toBe(err instanceof Error ? "smtp failed" : String(err));
  });
});
