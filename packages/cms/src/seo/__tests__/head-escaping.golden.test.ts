import assert from "node:assert/strict";
import { test } from "vitest";
import { buildHeadElements } from "../page-head.js";
import { OriginNotVerifiedError } from "@jini-ai/http-kit/verified-origin";
import { buildPostRecord, InMemoryPostRepo } from "./support/post.fixture.js";
import { InMemorySettingsRepo, seoDeps } from "./support/legacy-api.fixture.js";
import { InMemoryMediaRepo, InMemoryTransformDefinitionRepo } from "../../media/index.js";

/**
 * Captured by reading today's head producer and server serializer. The producer carries raw
 * values in structured descriptors; the renderer escapes attributes and JSON-LD at its sinks.
 * The DOM suite separately asserts the JSON-LD escape bytes and that attribute values stay data.
 */
test("head descriptors retain hostile attribute text and JSON-LD data for the escaping sink", async () => {
  const title = '\"><img src=x onerror="alert(1)">&';
  const description = "</script><script>alert(1)</script>";
  const deps = seoDeps({ postRepo: new InMemoryPostRepo([buildPostRecord({ title,
    seoExtJson: JSON.stringify({ description }) })]), settingsRepo: new InMemorySettingsRepo(),
    media: { mediaRepo: new InMemoryMediaRepo({}, { initialRows: [] }),
      transformDefinitionRepo: new InMemoryTransformDefinitionRepo({}, { initialRows: [] }) },
    originRegistry: { canonicalOrigin: async () => { throw new OriginNotVerifiedError({ message: "unverified" }); },
      isAllowedRedirectTarget: async () => false, isAllowedEgressTarget: async () => false } });
  const elements = await buildHeadElements({ deps, rootSlug: "/", siteTitle: async () => undefined,
    ctx: { workspaceId: "workspace-1", route: "/hello-world", canonicalUrl: "/hello-world", siteTitle: "Site",
      entry: { id: "post-1", type: "post", title, slug: "hello-world", status: "published",
        updatedAt: "2026-04-06T00:00:00.000Z", ext: {} } } });
  assert.deepEqual(elements.find(element => element.kind === "meta" && element.name === "description"),
    { kind: "meta", name: "description", content: description, priority: 110 });
  assert.deepEqual(elements.find(element => element.kind === "og" && element.property === "og:title"),
    { kind: "og", property: "og:title", content: title, priority: 140 });
  assert.deepEqual(elements.find(element => element.kind === "jsonld"), { kind: "jsonld", priority: 900,
    data: { "@context": "https://schema.org", "@type": "Article", headline: title, description } });
});
