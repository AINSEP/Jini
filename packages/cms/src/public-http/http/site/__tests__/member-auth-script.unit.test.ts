import assert from "node:assert/strict";
import { test } from "vitest";
import { injectMemberAuthScript } from "../member-auth-script.js";

/**
 * @file `injectMemberAuthScript`: the host-injected marker stamps both injected elements and is the
 * idempotency check; pages with no member hook are untouched; a hostile workspace id cannot close
 * the script tag. The browser half is exercised in jsdom by the host's own test (it needs the host's member page markup).
 */

const marker = "data-example-member-auth";

test("stamps the injected style and script with the host marker once, right before </body>", () => {
  const html = '<html><body><a href="/signin" data-member-nav>Sign in</a></body></html>';
  const out = injectMemberAuthScript({ html, workspaceId: "ws-1", marker });
  assert.equal(out.match(new RegExp(marker, "g"))?.length, 2, "one <style> and one <script>");
  assert.ok(out.endsWith("</script></body></html>"));
  assert.ok(out.includes(`(${JSON.stringify("/api/members/v1/workspaces/ws-1")});</script>`));
  assert.equal(injectMemberAuthScript({ html: out, workspaceId: "ws-1", marker }), out, "a second pass must not inject again");
});

test("leaves pages without a member hook untouched", () => {
  const html = '<html><body><a href="/signin">Sign in</a><p>data-member-nav in text only</p></body></html>';
  assert.equal(injectMemberAuthScript({ html, workspaceId: "ws-1", marker }), html);
});

test("appends when the document has no </body>", () => {
  const html = '<div data-member-page="signin"></div>';
  const out = injectMemberAuthScript({ html, workspaceId: "ws-1", marker });
  assert.ok(out.startsWith(html) && out.endsWith("</script>"));
});

test("a hostile workspace id cannot close the script tag", () => {
  const out = injectMemberAuthScript({ html: "<body data-member-page=x></body>", workspaceId: "</script><script>alert(1)", marker });
  assert.equal(out.match(/<\/script>/g)?.length, 1);
  assert.ok(out.includes("%3C%2Fscript%3E"));
});
