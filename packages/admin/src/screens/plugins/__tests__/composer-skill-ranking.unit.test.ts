import { describe, expect, it } from "vitest";
import { projectComposerCapabilities, rankComposerDiscoveryGroups, type ComposerCapability } from "../composer-capabilities.js";

const source = (items: ComposerCapability[]) => ({ id: "fixture", list: async () => items });
const row = (id: string, label: string, description = ""): ComposerCapability => ({ groupId: id, groupLabel: id, item: { id, label, description } });
const ids = (groups: Awaited<ReturnType<typeof projectComposerCapabilities>>["groups"]) => groups.flatMap(g => g.items.map(i => i.id));

describe("name-first discovery across every source", () => {
  it("ranks an exact name before an unrelated skill with only a prefix match", async () => {
    const skill = row("skill", "ui-helper");
    const p = await projectComposerCapabilities({ sources: [source([
      { ...skill, item: { ...skill.item, kind: "skill" } }, row("exact", "ui"),
    ])] });

    expect(ids(rankComposerDiscoveryGroups({ groups: p.groups, draft: "/ui" }))).toEqual(["exact", "skill"]);
  });
  it("preserves discovery groups for drafts without a leading slash", async () => {
    const p = await projectComposerCapabilities({ sources: [source([row("b", "Beta"), row("a", "Alpha")])] });

    for (const draft of ["", "write a post", "hello /ui"]) {
      expect(rankComposerDiscoveryGroups({ groups: p.groups, draft })).toEqual([
        { id: "b", label: "b", items: [{ id: "b", label: "Beta", description: "" }] },
        { id: "a", label: "a", items: [{ id: "a", label: "Alpha", description: "" }] },
      ]);
    }

    // A leading slash matches even with an empty query before whitespace.
    for (const draft of ["/", "/ ui"]) {
      expect(rankComposerDiscoveryGroups({ groups: p.groups, draft })).toEqual([
        { id: "a:a", label: "a", items: [{ id: "a", label: "Alpha", description: "" }] },
        { id: "b:b", label: "b", items: [{ id: "b", label: "Beta", description: "" }] },
      ]);
    }
  });

  it.each(["ui", "sk"])("ranks /%s by exact, prefix, word-prefix, substring, then description/keywords", async query => {
    const projection = await projectComposerCapabilities({ sources: [source([
      row("description", "Word Count", `Built-in ${query} helpers`),
      row("substring", `my${query}helper`), row("word", `design-${query}-helper`),
      row("prefix", `${query}-design`), row("exact", query),
    ])] });
    expect(ids(rankComposerDiscoveryGroups({ groups: projection.groups, draft: `/${query}` }))).toEqual(["exact", "prefix", "word", "substring", "description"]);
  });
  it("ranks a matching visible name even when its command uses a different alias", async () => {
    const alias = row("alias", "UI");
    const p = await projectComposerCapabilities({ sources: [source([row("prefix", "ui-helper"), { ...alias, item: { ...alias.item, command: "design" } }])] });
    expect(ids(rankComposerDiscoveryGroups({ groups: p.groups, draft: "/ui" }))).toEqual(["alias", "prefix"]);
  });
  it("gives ux in ui-ux-design word-prefix priority over a substring", async () => {
    const p = await projectComposerCapabilities({ sources: [source([row("substring", "luxury"), row("word", "ui-ux-design")])] });
    expect(ids(rankComposerDiscoveryGroups({ groups: p.groups, draft: "/ux" }))).toEqual(["word", "substring"]);
  });
});
