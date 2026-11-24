import { expect, test } from "vitest";
import { renderMemberAuthMail, type RenderEmailForSend } from "../auth-mail.js";

type Call = Parameters<RenderEmailForSend>[0];

/** A recording fake: captures what the module hands the renderer and returns a fixed message plus extra fields. */
function fakeRenderer(): { calls: Call[]; render: RenderEmailForSend } {
  const calls: Call[] = [];
  const render = (input: Call) => {
    calls.push(input);
    return { subject: "S", html: "H", text: "T", missingFields: ["ignored"] } as { subject: string; html: string; text: string };
  };
  return { calls, render };
}

test("signin picks the sign-in template and passes link and code through values", () => {
  const { calls, render } = fakeRenderer();
  renderMemberAuthMail({ purpose: "signin", link: "https://x.test/signin#magic=abc", code: "123456", renderEmailForSend: render });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.values).toEqual({ link: "https://x.test/signin#magic=abc", code: "123456" });
  expect(calls[0]?.html).toContain("<title>Your sign-in link and code</title>");
  expect(calls[0]?.html).toContain('<a href="{{link}}">{{link}}</a>');
  expect(calls[0]?.html).toContain("Or enter this one-time code: {{code}}");
  expect(calls[0]?.html).not.toContain("Reset your password");
});

test("password_reset picks the reset template with no code field", () => {
  const { calls, render } = fakeRenderer();
  renderMemberAuthMail({ purpose: "password_reset", link: "https://x.test/reset#t=1", renderEmailForSend: render });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.html).toContain("<title>Reset your password</title>");
  expect(calls[0]?.html).toContain('<a href="{{link}}">{{link}}</a>');
  expect(calls[0]?.html).toContain("If you did not request this, ignore this email.");
  expect(calls[0]?.html).not.toContain("{{code}}");
  expect(calls[0]?.html).not.toContain("one-time code");
});

test("code defaults to an empty string when absent", () => {
  const { calls, render } = fakeRenderer();
  renderMemberAuthMail({ purpose: "signin", link: "L", renderEmailForSend: render });
  renderMemberAuthMail({ purpose: "password_reset", link: "L", renderEmailForSend: render });
  expect(calls.map(call => call.values)).toEqual([{ link: "L", code: "" }, { link: "L", code: "" }]);
});

test("returns exactly the renderer's subject, html and text and drops its other fields", () => {
  const { render } = fakeRenderer();
  const mail = renderMemberAuthMail({ purpose: "signin", link: "L", code: "1", renderEmailForSend: render });
  expect(mail).toStrictEqual({ subject: "S", html: "H", text: "T" });
});

test("a renderer failure propagates unchanged", () => {
  const failure = new Error("renderer refused");
  expect(() => renderMemberAuthMail({
    purpose: "signin", link: "L", renderEmailForSend: () => { throw failure; },
  })).toThrow(failure);
});
