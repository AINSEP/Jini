import { expect, it } from "vitest";

import type { JsonObject } from "@jini-ai/core/primitives";

import { copyBodyJsonWithFreshEmbedPlacements } from "../duplicate-embeds.js";

/**
 * @file Certifies the widgetEmbed handling of a document duplicate in isolation — see
 * `duplicate-embeds.ts`'s own header for the full design rationale (why `widgetEntryId` is kept and
 * `placementId` is regenerated, not the other way around).
 */

it("a document with no widgetEmbed nodes round-trips as a structural clone", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };
  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: doc, newPlacementId: () => "unused" });
  expect(copy).toEqual(doc);
  expect(copy, "must be a new object, not the same reference").not.toBe(doc);
});

it("a widgetEmbed node's placementId is replaced with a freshly minted one", () => {
  const doc = {
    type: "doc",
    content: [{ type: "widgetEmbed", attrs: { placementId: "source-placement-1", widgetEntryId: "widget-abc" } }],
  };
  let mintCount = 0;
  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: doc, newPlacementId: () => `fresh-${++mintCount}` });

  const embed = (copy.content as Array<Record<string, unknown>>)[0]!;
  const attrs = embed.attrs as Record<string, unknown>;
  expect(attrs.placementId, "placementId must be replaced with a newly minted id").toBe("fresh-1");
  expect(attrs.placementId, "the source page's placementId must never appear on the copy").not.toBe("source-placement-1");
});

it("a widgetEmbed node's widgetEntryId is carried over UNCHANGED — reusing the same widget instance is intended", () => {
  const doc = {
    type: "doc",
    content: [{ type: "widgetEmbed", attrs: { placementId: "p1", widgetEntryId: "widget-abc" } }],
  };
  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: doc, newPlacementId: () => "fresh-1" });

  const embed = (copy.content as Array<Record<string, unknown>>)[0]!;
  const attrs = embed.attrs as Record<string, unknown>;
  expect(attrs.widgetEntryId, "the live widget reference must be preserved — this is a supported shared reference, not a bug").toBe("widget-abc");
});

it("multiple embeds each get their OWN distinct fresh placementId, in document order", () => {
  const doc: JsonObject = {
    type: "doc",
    content: [
      { type: "widgetEmbed", attrs: { placementId: "p1", widgetEntryId: "widget-a" } },
      { type: "paragraph", content: [{ type: "text", text: "between" }] },
      { type: "widgetEmbed", attrs: { placementId: "p2", widgetEntryId: "widget-b" } },
    ],
  };
  const minted: string[] = [];
  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: doc, newPlacementId: () => {
    const id = `fresh-${minted.length + 1}`;
    minted.push(id);
    return id;
  } });

  const content = copy.content as Array<Record<string, unknown>>;
  expect((content[0]!.attrs as Record<string, unknown>).placementId).toBe("fresh-1");
  expect((content[2]!.attrs as Record<string, unknown>).placementId).toBe("fresh-2");
  expect(minted[0], "each embed must mint its own distinct id, not share one").not.toBe(minted[1]);
});

it("a widgetEmbed nested inside a blockquote is still found and regenerated (recursion into content)", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "blockquote",
        content: [{ type: "widgetEmbed", attrs: { placementId: "nested-source", widgetEntryId: "widget-xyz" } }],
      },
    ],
  };
  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: doc, newPlacementId: () => "fresh-nested" });

  const blockquote = (copy.content as Array<Record<string, unknown>>)[0]!;
  const nestedEmbed = (blockquote.content as Array<Record<string, unknown>>)[0]!;
  expect((nestedEmbed.attrs as Record<string, unknown>).placementId).toBe("fresh-nested");
});

it("a malformed widgetEmbed node (non-string placementId, or missing attrs) is left completely untouched, not crashed on", () => {
  const doc: JsonObject = {
    type: "doc",
    content: [
      { type: "widgetEmbed", attrs: { placementId: 42, widgetEntryId: "widget-a" } },
      { type: "widgetEmbed" },
    ],
  };
  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: doc, newPlacementId: () => "should-not-be-called" });
  expect(copy).toEqual(doc);
});

it("JSON null and array attributes survive copying while only an addressable neighboring embed spends an id", () => {
  const legacy = [{ type: "widgetEmbed", attrs: null }, { type: "widgetEmbed", attrs: [{ placementId: "not-a-slot" }, null] }];
  const bodyJson: JsonObject = { type: "doc", content: [...legacy, { type: "widgetEmbed", attrs: { placementId: "old", widgetEntryId: "widget" } }] };
  let minted = 0;
  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson, newPlacementId: () => `new-${++minted}` });
  expect(copy).toEqual({ type: "doc", content: [...legacy, { type: "widgetEmbed", attrs: { placementId: "new-1", widgetEntryId: "widget" } }] });
  expect(minted).toBe(1);
});

it("a 5000-deep document is copied with fresh placementIds minted in document order instead of overflowing the call stack", () => {
  const depth = 5000;
  let deep: JsonObject = { type: "widgetEmbed", attrs: { placementId: "old-deep", widgetEntryId: "w-deep" } };
  for (let i = 0; i < depth; i++) deep = { type: "blockquote", content: [deep] };
  const doc = {
    type: "doc",
    content: [
      { type: "widgetEmbed", attrs: { placementId: "old-first", widgetEntryId: "w-first" } },
      deep,
      { type: "widgetEmbed", attrs: { placementId: "old-last", widgetEntryId: "w-last" } },
    ],
  };
  let minted = 0;

  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: doc, newPlacementId: () => `new-${++minted}` }) as { content: Array<Record<string, unknown>> };

  expect(copy.content[0]).toEqual({ type: "widgetEmbed", attrs: { placementId: "new-1", widgetEntryId: "w-first" } });
  expect(copy.content[2]).toEqual({ type: "widgetEmbed", attrs: { placementId: "new-3", widgetEntryId: "w-last" } });
  let node: Record<string, unknown> | undefined = copy.content[1];
  for (let i = 0; i < depth; i++) {
    expect(node?.type).toBe("blockquote");
    node = (node?.content as Array<Record<string, unknown>> | undefined)?.[0];
  }
  expect(node).toEqual({ type: "widgetEmbed", attrs: { placementId: "new-2", widgetEntryId: "w-deep" } });
  expect(minted).toBe(3);
  expect((doc.content[0]?.attrs as { placementId: string } | undefined)?.placementId, "the source document must not be mutated").toBe("old-first");
});

it("the copied document isolates nested text, marks and attributes from the source", () => {
  type Mark = { type: string; attrs: { href: string } };
  type Paragraph = { type: string; attrs: { textAlign: string }; content: [{ type: string; text: string; marks: [Mark] }] };
  type Embed = { type: string; attrs: { placementId: string; widgetEntryId: string; metadata: { label: string } } };
  type IsolationDoc = { type: string; content: [Paragraph, Embed] };
  const doc: IsolationDoc = { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "original", marks: [{ type: "link", attrs: { href: "/original" } }] }] }, { type: "widgetEmbed", attrs: { placementId: "source", widgetEntryId: "w", metadata: { label: "original" } } }] };
  const original = structuredClone(doc);
  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: doc, newPlacementId: () => "fresh" }) as IsolationDoc;
  copy.content[0].attrs.textAlign = "right";
  copy.content[0].content[0].text = "changed";
  copy.content[0].content[0].marks[0].attrs.href = "/changed";
  copy.content[1].attrs.metadata.label = "changed";
  expect(doc).toEqual(original);
});

it("three embeds at mixed depths get three fresh ids in document order; nested and unknown nodes are copied untouched", () => {
  const doc: JsonObject = {
    type: "doc",
    content: [
      { type: "widgetEmbed", attrs: { placementId: "a", widgetEntryId: "w1" } },
      { type: "futureBlock", attrs: { anything: [1, { deep: true }] }, content: [{ type: "widgetEmbed", attrs: { placementId: "b", widgetEntryId: "w2" } }] },
      { type: "paragraph", content: [{ type: "text", text: "kept", marks: [{ type: "bold" }] }] },
      { type: "widgetEmbed", attrs: { placementId: "c", widgetEntryId: "w3" } },
    ],
  };
  const fakeIds = ["x1", "x2", "x3"];
  const copy = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: doc, newPlacementId: () => fakeIds.shift() ?? "exhausted" });
  expect(copy).toEqual({
    type: "doc",
    content: [
      { type: "widgetEmbed", attrs: { placementId: "x1", widgetEntryId: "w1" } },
      { type: "futureBlock", attrs: { anything: [1, { deep: true }] }, content: [{ type: "widgetEmbed", attrs: { placementId: "x2", widgetEntryId: "w2" } }] },
      { type: "paragraph", content: [{ type: "text", text: "kept", marks: [{ type: "bold" }] }] },
      { type: "widgetEmbed", attrs: { placementId: "x3", widgetEntryId: "w3" } },
    ],
  });
  expect(fakeIds).toEqual([]);
});
