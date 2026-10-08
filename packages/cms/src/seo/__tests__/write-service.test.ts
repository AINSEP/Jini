import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";

import { ForbiddenError } from "../../core/index.js";
import { InMemoryPostRepo, type PostRecord } from "./support/post.fixture.js";
import {
  SeoEntryNotFoundError,
  SeoFieldValidationError,
  SeoInvalidCanonicalUrlError,
} from "../errors.js";
import { setEntrySeoOverrides } from "./support/legacy-api.fixture.js";
import { buildPostRecord } from "./support/post.fixture.js";

/**
 * @file T014 — failing-first unit certification of `setEntrySeoOverrides`
 * (ADR-PIPE-008 Decision §4, C-004): authorize -> validate (registered-key
 * only, length/URL-scheme) -> merge -> save, nothing persisted on rejection.
 */

const WORKSPACE = "workspace-1";
const ENTRY_ID = "post-1";

function seedPost(overrides: Partial<PostRecord> = {}): PostRecord {
  return buildPostRecord({
    id: ENTRY_ID,
    workspaceId: WORKSPACE,
    title: "Hello World",
    slug: "hello-world",
    bodyJson: { type: "doc", content: [] },
    status: "published",
    kind: "post",
    updatedAt: "2026-07-13T00:00:00.000Z",
    version: 1,
    seoExtJson: null,
    ...overrides,
  });
}

const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const alwaysDeny = async () => ({ allowed: false, reason: "no_grant" });
const noopInvalidate = () => {};
const clock = { nowMs: () => Date.parse("2026-09-18T00:00:00.000Z") };

test("setEntrySeoOverrides: authorize() runs first — unauthorized caller gets FORBIDDEN, zero writes", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysDeny, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { title: "New Title" }, callerPrincipalId: "p1" },
      }),
    ForbiddenError
  );

  const after = await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID });
  assert.equal(after?.seoExtJson, null);
  await assert.rejects(() => setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysDeny, invalidateSitemapCache: noopInvalidate, clock },
    input: { workspaceId: WORKSPACE, entryId: "missing", patch: { unknown: "invalid" } as never, callerPrincipalId: "p1" },
  }), ForbiddenError);
  assert.deepEqual(await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID }), seedPost());
  assert.deepEqual(await repo.listRevisions({ workspaceId: WORKSPACE, postId: ENTRY_ID }), []);
});

test("setEntrySeoOverrides: a grant for this SEO permission and caller context permits the persisted write", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);
  const expected = { permission: "admin.seo.manage", principalId: "seo-editor", workspaceId: WORKSPACE,
    entityType: "seo-entry", entityId: ENTRY_ID };
  const requests: unknown[] = [];
  await setEntrySeoOverrides({ deps: { postRepo: repo, invalidateSitemapCache: noopInvalidate, clock,
    authorize: async (request) => {
      requests.push(request);
      return { allowed: Object.entries(expected).every(([key, value]) => request[key as keyof typeof request] === value), reason: "scoped SEO grant" };
    },
  }, input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { title: "Authorized title" }, callerPrincipalId: "seo-editor" } });
  assert.deepEqual(requests, [expected]);
  assert.deepEqual(JSON.parse((await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID }))!.seoExtJson!), { title: "Authorized title" });
});

test("setEntrySeoOverrides: an unregistered key is rejected, existing row unchanged (AC-04)", async () => {
  const repo = new InMemoryPostRepo([seedPost({ seoExtJson: JSON.stringify({ title: "Existing" }) })]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: {
          workspaceId: WORKSPACE,
          entryId: ENTRY_ID,
          patch: { notARealField: "x" } as never,
          callerPrincipalId: "p1",
        },
      }),
    SeoFieldValidationError
  );

  const after = await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID });
  assert.equal(after?.seoExtJson, JSON.stringify({ title: "Existing" }));
});

test("setEntrySeoOverrides: a 500-char title string is accepted", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);
  const title = "a".repeat(500);

  const result = await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { title }, callerPrincipalId: "p1" },
  });

  assert.equal(result.overrides.title, title);
});

test("setEntrySeoOverrides: a 501-char title string is rejected", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);
  const title = "a".repeat(501);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { title }, callerPrincipalId: "p1" },
      }),
    SeoFieldValidationError
  );
});

test("setEntrySeoOverrides: a 2048-char canonical URL is accepted", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);
  const canonical = "https://example.com/" + "a".repeat(2048 - "https://example.com/".length);
  assert.equal(canonical.length, 2048);

  const result = await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { canonical }, callerPrincipalId: "p1" },
  });

  assert.equal(result.overrides.canonical, canonical);
});

test("setEntrySeoOverrides: a 2049-char canonical URL is rejected", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);
  const canonical = "https://example.com/" + "a".repeat(2049 - "https://example.com/".length);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { canonical }, callerPrincipalId: "p1" },
      }),
    SeoFieldValidationError
  );
});

test("setEntrySeoOverrides: a javascript: canonical scheme is rejected with SeoInvalidCanonicalUrlError", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: {
          workspaceId: WORKSPACE,
          entryId: ENTRY_ID,
          patch: { canonical: "javascript:alert(1)" },
          callerPrincipalId: "p1",
        },
      }),
    SeoInvalidCanonicalUrlError
  );

  const after = await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID });
  assert.equal(after?.seoExtJson, null);
});

test("setEntrySeoOverrides: a data: canonical scheme is rejected with SeoInvalidCanonicalUrlError", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: {
          workspaceId: WORKSPACE,
          entryId: ENTRY_ID,
          patch: { canonical: "data:text/html,<script>" },
          callerPrincipalId: "p1",
        },
      }),
    SeoInvalidCanonicalUrlError
  );
});

test("setEntrySeoOverrides: entry-not-found rejects with SeoEntryNotFoundError", async () => {
  const repo = new InMemoryPostRepo([]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: "missing", patch: { title: "x" }, callerPrincipalId: "p1" },
      }),
    SeoEntryNotFoundError
  );
});

test("setEntrySeoOverrides: merges the patch into an existing override bag rather than replacing it", async () => {
  const repo = new InMemoryPostRepo([seedPost({ seoExtJson: JSON.stringify({ title: "Old Title", noindex: true }) })]);

  const result = await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { description: "New description" }, callerPrincipalId: "p1" },
  });

  assert.equal(result.overrides.title, "Old Title");
  assert.equal(result.overrides.noindex, true);
  assert.equal(result.overrides.description, "New description");
});

test("setEntrySeoOverrides: a noindex-affecting write invalidates the sitemap cache directly", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);
  let invalidatedFor: string | undefined;

  await setEntrySeoOverrides({
    deps: {
      postRepo: repo,
      authorize: alwaysAllow,
      clock,
      invalidateSitemapCache: (input) => {
        invalidatedFor = input.workspaceId;
      },
    },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { noindex: true }, callerPrincipalId: "p1" },
  });

  assert.equal(invalidatedFor, WORKSPACE);
});

test("setEntrySeoOverrides: a write that touches neither noindex nor canonical does not invalidate the sitemap cache", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);
  let invalidateCalls = 0;

  await setEntrySeoOverrides({
    deps: {
      postRepo: repo,
      authorize: alwaysAllow,
      clock,
      invalidateSitemapCache: () => {
        invalidateCalls++;
      },
    },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { title: "New title" }, callerPrincipalId: "p1" },
  });

  assert.equal(invalidateCalls, 0);
});

test("setEntrySeoOverrides: bumps the post's version (audit signal)", async () => {
  const repo = new InMemoryPostRepo([seedPost({ version: 3 })]);

  await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { title: "New title" }, callerPrincipalId: "p1" },
  });

  const after = await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID });
  assert.equal(after?.version, 4);
});

test("setEntrySeoOverrides: non-string value for string field throws SeoFieldValidationError", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { title: 123 as unknown as string }, callerPrincipalId: "p1" },
      }),
    (err: unknown) => err instanceof SeoFieldValidationError && err.message.includes("'title' must be a string")
  );
});

test("setEntrySeoOverrides: non-string value for URL field throws SeoFieldValidationError", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { ogImage: false as unknown as string }, callerPrincipalId: "p1" },
      }),
    (err: unknown) => err instanceof SeoFieldValidationError && err.message.includes("'ogImage' must be a string")
  );
});

test("setEntrySeoOverrides: URL field exceeding 2048 chars throws SeoFieldValidationError", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { ogImage: "https://example.com/" + "a".repeat(2040) }, callerPrincipalId: "p1" },
      }),
    (err: unknown) => err instanceof SeoFieldValidationError && err.message.includes("'ogImage' must be at most 2048 characters")
  );
});

test("setEntrySeoOverrides: vbscript: and file: canonical schemes are rejected with SeoInvalidCanonicalUrlError", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { canonical: "vbscript:msgbox(1)" }, callerPrincipalId: "p1" },
      }),
    SeoInvalidCanonicalUrlError
  );

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { canonical: "file:///etc/passwd" }, callerPrincipalId: "p1" },
      }),
    SeoInvalidCanonicalUrlError
  );
});

test("setEntrySeoOverrides: non-boolean value for boolean field throws SeoFieldValidationError", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { noindex: "true" as unknown as boolean }, callerPrincipalId: "p1" },
      }),
    (err: unknown) => err instanceof SeoFieldValidationError && err.message.includes("'noindex' must be a boolean")
  );

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { nofollow: 0 as unknown as boolean }, callerPrincipalId: "p1" },
      }),
    (err: unknown) => err instanceof SeoFieldValidationError && err.message.includes("'nofollow' must be a boolean")
  );
});

test("setEntrySeoOverrides: invalid ogType and twitterCard values throw SeoFieldValidationError", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { ogType: "invalid_type" as unknown as "website" }, callerPrincipalId: "p1" },
      }),
    (err: unknown) => err instanceof SeoFieldValidationError && err.message.includes("'ogType' must be one of")
  );

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { twitterCard: "invalid_card" as unknown as "summary" }, callerPrincipalId: "p1" },
      }),
    (err: unknown) => err instanceof SeoFieldValidationError && err.message.includes("'twitterCard' must be one of")
  );
});

test("setEntrySeoOverrides: valid ogType and twitterCard values are accepted and saved", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);

  const result = await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: {
      workspaceId: WORKSPACE,
      entryId: ENTRY_ID,
      patch: {
        ogType: "article",
        twitterCard: "summary_large_image",
        nofollow: true,
      },
      callerPrincipalId: "p1",
    },
  });

  assert.equal(result.overrides.ogType, "article");
  assert.equal(result.overrides.twitterCard, "summary_large_image");
  assert.equal(result.overrides.nofollow, true);
});

test("setEntrySeoOverrides: canonical change triggers sitemap cache invalidation", async () => {
  const repo = new InMemoryPostRepo([seedPost()]);
  let invalidatedFor: string | undefined;

  await setEntrySeoOverrides({
    deps: {
      postRepo: repo,
      authorize: alwaysAllow,
      clock,
      invalidateSitemapCache: (input) => {
        invalidatedFor = input.workspaceId;
      },
    },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { canonical: "https://example.com/canonical-post" }, callerPrincipalId: "p1" },
  });

  assert.equal(invalidatedFor, WORKSPACE);
});

// ---------------------------------------------------------------------------
// Regression: a patch value of `null` clears that key back to absent, rather
// than being rejected or stored as a literal empty/falsy value. Before this
// fix there was no way to remove a key once set — see `seo.ts`'s
// `resolveTitleAndDescription`, whose `??` chain treats a stored `""` as a
// present value and never falls through to the site default/derived excerpt.
// ---------------------------------------------------------------------------

test("setEntrySeoOverrides: a null patch value clears that key back to absent, not an empty string", async () => {
  const repo = new InMemoryPostRepo([seedPost({ seoExtJson: JSON.stringify({ description: "" }) })]);

  const result = await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { description: null }, callerPrincipalId: "p1" },
  });

  assert.equal("description" in result.overrides, false, "cleared key must be absent, not merely falsy");

  const after = await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID });
  assert.equal(
    after?.seoExtJson,
    null,
    "clearing the only set key collapses seo_ext_json back to NULL (the entry's original state), not a leftover '{}'"
  );
});

test("setEntrySeoOverrides: clearing one key leaves sibling overrides intact", async () => {
  const repo = new InMemoryPostRepo([
    seedPost({ seoExtJson: JSON.stringify({ title: "Kept Title", description: "Clear me", noindex: true }) }),
  ]);

  const result = await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { description: null }, callerPrincipalId: "p1" },
  });

  assert.equal(result.overrides.title, "Kept Title");
  assert.equal(result.overrides.noindex, true);
  assert.equal("description" in result.overrides, false);

  const after = await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID });
  assert.deepEqual(JSON.parse(after!.seoExtJson!), { title: "Kept Title", noindex: true });
});

test("setEntrySeoOverrides: a null value alongside a set value in the same patch applies both (clear + set in one call)", async () => {
  const repo = new InMemoryPostRepo([seedPost({ seoExtJson: JSON.stringify({ description: "Old" }) })]);

  const result = await setEntrySeoOverrides({
    deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
    input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { description: null, title: "New Title" }, callerPrincipalId: "p1" },
  });

  assert.equal("description" in result.overrides, false);
  assert.equal(result.overrides.title, "New Title");
});

// ---------------------------------------------------------------------------
// S6 (web-high fix plan, 2026-09-24) — a trashed entry must refuse the write, not merge onto it and
// bump its version. `InMemoryPostRepo.findById` (like the real sqlite repo) returns trashed rows, so
// seeding one directly with `deletedAt` set reproduces the same shape `deletePost` leaves behind.
// ---------------------------------------------------------------------------

test("setEntrySeoOverrides: a trashed post is refused with the entity-liveness message, unchanged version and seoExtJson", async () => {
  const repo = new InMemoryPostRepo([
    seedPost({ deletedAt: "2026-09-24T00:00:00.000Z", seoExtJson: JSON.stringify({ title: "Before" }), version: 4 }),
  ]);

  await assert.rejects(
    () =>
      setEntrySeoOverrides({
        deps: { postRepo: repo, authorize: alwaysAllow, invalidateSitemapCache: noopInvalidate, clock },
        input: { workspaceId: WORKSPACE, entryId: ENTRY_ID, patch: { title: "After" }, callerPrincipalId: "p1" },
      }),
    { message: `ENTITY_IN_TRASH: post '${ENTRY_ID}' is in the Trash. Restore it from the Trash before changing it.` }
  );

  const after = await repo.findById({ workspaceId: WORKSPACE, id: ENTRY_ID });
  assert.equal(after?.version, 4, "a refused write must not bump the version");
  assert.equal(after?.seoExtJson, JSON.stringify({ title: "Before" }), "a refused write must not touch seoExtJson");
});


afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
