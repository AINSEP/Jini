import assert from "node:assert/strict";
import { test } from "vitest";
import { injectMemberAuthScript, memberAuthScript, memberAuthStyle, type MemberAuthNames } from "../member-auth-script.js";

/**
 * @file `injectMemberAuthScript`: the host-injected marker stamps both injected elements and is the
 * idempotency check; pages with no member hook are untouched; a hostile workspace id cannot close
 * the script tag. The browser half is exercised in jsdom by the host's own test (it needs the host's member page markup).
 */

const marker = "data-example-member-auth";

const KEYS = ["authClass", "fieldClass", "passwordClass", "passwordToggleClass", "passwordSlashClass", "labelRowClass", "actionsClass", "submitClass", "linksClass", "linkClass", "noteClass", "signoutClass", "providerListClass", "providerClass", "orClass", "oidcErrorClass", "headingRowClass", "identitiesClass", "identityListClass", "identityClass", "tipClass", "tipTextClass", "accountShortClass", "accountEmailClass"] as const;
/** Every class is `x-<key>` so a legacy name left in the engine cannot hide behind a coincidence. */
const names: MemberAuthNames = {
  ...(Object.fromEntries(KEYS.map((k) => [k, `x-${k}`])) as Record<(typeof KEYS)[number], string>),
  providerThemeClasses: "x-theme-solid x-theme-ghost",
  dangerFallbackProp: "--x-danger-fb",
  successFallbackProp: "--x-success-fb",
};

test("stamps the injected style and script with the host marker once, right before </body>", () => {
  const html = '<html><body><a href="/signin" data-member-nav>Sign in</a></body></html>';
  const out = injectMemberAuthScript({ html, workspaceId: "ws-1", marker, names });
  assert.equal(out.match(new RegExp(marker, "g"))?.length, 2, "one <style> and one <script>");
  assert.ok(out.endsWith("</script></body></html>"));
  assert.ok(out.includes(`(${JSON.stringify("/api/members/v1/workspaces/ws-1")});</script>`));
  assert.equal(injectMemberAuthScript({ html: out, workspaceId: "ws-1", marker, names }), out, "a second pass must not inject again");
});

test("leaves pages without a member hook untouched", () => {
  const html = '<html><body><a href="/signin">Sign in</a><p>data-member-nav in text only</p></body></html>';
  assert.equal(injectMemberAuthScript({ html, workspaceId: "ws-1", marker, names }), html);
});

test("appends when the document has no </body>", () => {
  const html = '<div data-member-page="signin"></div>';
  const out = injectMemberAuthScript({ html, workspaceId: "ws-1", marker, names });
  assert.ok(out.startsWith(html) && out.endsWith("</script>"));
});

test("a hostile workspace id cannot close the script tag", () => {
  const out = injectMemberAuthScript({ html: "<body data-member-page=x></body>", workspaceId: "</script><script>alert(1)", marker, names });
  assert.equal(out.match(/<\/script>/g)?.length, 1);
  assert.ok(out.includes("%3C%2Fscript%3E"));
});

test("every class the style selects and the script emits comes from the host names, never a hardcoded legacy name", () => {
  const style = memberAuthStyle({ names });
  const script = memberAuthScript({ names });
  for (const key of KEYS) assert.ok((style + script).includes(`x-${key}`), `${key} reaches the output`);
  assert.ok(script.includes('className = "x-theme-solid x-theme-ghost x-providerClass"'));
  assert.ok(script.includes('querySelector(".x-passwordSlashClass")') && script.includes('all(".x-tipClass", page)'));
  assert.ok(style.includes("var(--x-danger-fb)") && style.includes("var(--x-success-fb)"));
  // `data-member-*` hooks are the engine's own contract; nothing else may say `member-` or `btn`.
  for (const out of [style, script]) {
    assert.doesNotMatch(out.replaceAll("data-member-", ""), /member-|\bbtn\b|--member/);
  }
});

test("the generated script and style carry nothing that breaks the inline <script> embedding", () => {
  for (const source of [memberAuthScript({ names }), memberAuthStyle({ names })]) {
    assert.doesNotMatch(source, /<\/script|<\/style|`|\$\{/i);
  }
});
