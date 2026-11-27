import { expect, it } from "vitest";
import type { PostRecord } from "../../../posts/post.js";
import { toAdminPostResponse } from "../posts.js";

it("wraps a scheduled HTML page in the admin post envelope without leaking storage fields", () => {
  const post: PostRecord = {
    id: "page-22", workspaceId: "ws-9", kind: "page", title: "Fall opening", slug: "opening",
    status: "draft", updatedAt: "2026-09-17T12:34:56Z", version: 7,
    bodyFormat: "html", bodyHtml: "<main>We open at noon</main>", bodyJson: null,
    publishAt: "2026-10-01T09:00:00Z", deletedAt: null, showAuthor: true,
  };
  expect(toAdminPostResponse(post)).toStrictEqual({ post: {
    id: "page-22", workspaceId: "ws-9", kind: "page", title: "Fall opening", slug: "opening",
    status: "draft", updatedAt: "2026-09-17T12:34:56Z", version: 7, author: null, showAuthor: true,
    templateChoice: null, overridesThemePage: null, publishAt: "2026-10-01T09:00:00Z",
    bodyFormat: "html", bodyHtml: "<main>We open at noon</main>", bodyJson: null,
  } });
});
