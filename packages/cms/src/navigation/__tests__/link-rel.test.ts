/**
 * Menu link `rel` policy (owner decision 11-02, open-bugs ~361): `rel` keeps only standard link-type
 * tokens; unknown tokens are dropped, not rejected; a link that opens in a new tab always carries
 * `noopener noreferrer`. Bug class: authored/agent-written `rel` text reached the rendered `<a>`
 * unvalidated, and a `target=_blank` link could ship without `noopener`. Guarded on both sides:
 * the write chokepoint (`validateAndCloneTree`) stores the clean value, and the read path
 * (`resolveMenuDoc`) cleans rows written before this policy existed.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { MENU_REL_TOKENS, normalizeMenuRel } from "../link-rel.js";
import { validateAndCloneTree } from "../menu-service.js";
import { resolveMenuDoc, type ResolveTargetHrefFn } from "../resolver.js";
import { NAV_DOC_TYPE, type NavItemNode } from "../types.js";

const noTargets: ResolveTargetHrefFn = async () => null;

function urlItem(id: string, attrs: NavItemNode["attrs"]): NavItemNode {
  return { id, label: id, target: { kind: "url", href: "https://example.com/" }, attrs };
}

test("the allowlist is exactly the decided standard link-type tokens", () => {
  assert.deepEqual([...MENU_REL_TOKENS].sort(), [
    "author", "bookmark", "external", "help", "license", "me", "next", "nofollow",
    "noopener", "noreferrer", "prev", "sponsored", "tag", "ugc",
  ]);
});

test("normalizeMenuRel keeps allowed tokens, drops unknown ones, lowercases and dedupes", () => {
  assert.equal(normalizeMenuRel({ rel: "NoFollow  ugc nofollow" }, {}), "nofollow ugc");
  assert.equal(normalizeMenuRel({ rel: 'nofollow" onmouseover="x' }, {}), undefined);
  assert.equal(normalizeMenuRel({ rel: "stylesheet preload opener" }, {}), undefined);
  assert.equal(normalizeMenuRel({ rel: "" }, {}), undefined);
  assert.equal(normalizeMenuRel({ rel: undefined }, {}), undefined);
  // Untrusted JSON: a non-string rel is treated as absent, never thrown on.
  assert.equal(normalizeMenuRel({ rel: 42 as unknown as string }, {}), undefined);
});

test("normalizeMenuRel always adds noopener noreferrer to a new-tab link", () => {
  assert.equal(normalizeMenuRel({ rel: undefined }, { openInNewTab: true }), "noopener noreferrer");
  assert.equal(normalizeMenuRel({ rel: "sponsored opener" }, { openInNewTab: true }), "sponsored noopener noreferrer");
  assert.equal(normalizeMenuRel({ rel: "noreferrer" }, { openInNewTab: true }), "noreferrer noopener");
  assert.equal(normalizeMenuRel({ rel: undefined }, { openInNewTab: false }), undefined);
});

test("the write chokepoint stores only the normalized rel, at every depth", () => {
  const items: NavItemNode[] = [{
    ...urlItem("parent", { rel: "nofollow evil", cssClass: "kept" }),
    children: [urlItem("child", { rel: "preload", openInNewTab: true })],
  }];
  const [parent] = validateAndCloneTree({ items });
  assert.deepEqual(parent!.attrs, { rel: "nofollow", cssClass: "kept" });
  assert.deepEqual(parent!.children![0]!.attrs, { rel: "noopener noreferrer", openInNewTab: true });
  // Input is not mutated (the function returns a defensive clone).
  assert.equal(items[0]!.attrs!.rel, "nofollow evil");
});

test("the write chokepoint drops a rel that normalizes to nothing and leaves rel-less items alone", () => {
  const [onlyUnknown, none] = validateAndCloneTree({ items: [urlItem("a", { rel: "stylesheet" }), urlItem("b", undefined)] });
  assert.deepEqual(onlyUnknown!.attrs, {});
  assert.equal(none!.attrs, undefined);
});

test("rows written before the policy are cleaned when resolved for rendering", async () => {
  const legacy = [{ ...urlItem("old", { rel: "nofollow x-evil", openInNewTab: true }), children: [urlItem("kid", { rel: "me" })] }];
  const [item] = await resolveMenuDoc({
    doc: { type: NAV_DOC_TYPE, version: 1, items: legacy },
    context: { workspaceId: "ws-1" },
    resolveTargetHref: noTargets,
  });
  assert.equal(item!.attrs!.rel, "nofollow noopener noreferrer");
  assert.equal(item!.attrs!.openInNewTab, true);
  assert.equal(item!.children[0]!.attrs!.rel, "me");
});

test("menu links drop malformed rel tokens whole instead of turning fragments into trusted link types", () => {
  for (const rel of ["x-nofollow", "ugc123", "nofollow,external", "me/author", "tag\u00a0help"]) {
    assert.equal(normalizeMenuRel({ rel }), undefined, rel);
  }
  assert.equal(normalizeMenuRel({ rel: "NoFollow\tugc\nexternal\rhelp\fauthor" }), "nofollow ugc external help author");
  assert.equal(normalizeMenuRel({ rel: "invalid-noopener noreferrer2", }, { openInNewTab: true }), "noopener noreferrer");
});
