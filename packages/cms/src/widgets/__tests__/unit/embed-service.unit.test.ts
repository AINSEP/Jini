import { describe, expect, it } from "vitest";
import type { JsonObject } from "@jini-ai/core/primitives";
import { InMemoryEntryRepo, entryVersionConflictError, type EntryRecord } from "../../../entries/index.js";
import { InMemoryContentTypeRepo } from "../../../content-types/index.js";
import { InMemoryChangeSetRepo } from "../../../forms/__tests__/change-set.fixture.js";
import { createEntryLockState } from "../../concurrency.js";
import { buildWidgetInstanceFieldsJson } from "../../entry-payload.js";
import {
  insertWidgetEmbed,
  removeWidgetEmbed,
  reorderWidgetEmbeds,
  WidgetEmbedReorderCountMismatchError,
  type EmbedServiceDeps,
} from "../../embed-service.js";
import type { PostRecord, PostRepoPort, WidgetHostPorts } from "../../host-ports.js";
import { widgetHostFixture, InMemoryEntryRefsRepo, InMemoryOutbox } from "../support/host.fixture.js";

/**
 * @file Direct coverage for `embed-service.ts`: the three document mutations (insert/remove/reorder)
 * against both host tables (an `entries` row and a `posts` row), their tree walkers (explicit-stack,
 * order-preserving), and every refusal path of the two write arms.
 */

const WS = "ws-1";
const userActor = { principalId: "user-1", kind: "user" };
const agentActor = { principalId: "agent-1", kind: "agent" };

type PostPorts = WidgetHostPorts["posts"];
type UpdatePostCall = Parameters<PostPorts["updatePost"]>[0];
type RestoreCall = Parameters<PostPorts["restorePostForward"]>[0];

class PostVersionConflict extends Error {
  constructor(message: string, readonly currentVersion: number) { super(message); }
}
class PostNotFound extends Error {}

function entryRecord(overrides: Partial<EntryRecord> & Pick<EntryRecord, "id" | "type">): EntryRecord {
  return {
    workspaceId: WS, slug: overrides.id, status: "draft", title: overrides.id, bodyJson: null, fieldsJson: {},
    publishedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1,
    ...overrides,
  };
}

function widgetRecord(id: string, status: "active" | "trash" | "purged" = "active"): EntryRecord {
  return entryRecord({ id, type: "widget", fieldsJson: buildWidgetInstanceFieldsJson({ payload: { widgetType: "text", config: {}, status } }) });
}

function postRecord(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "post-1", workspaceId: WS, title: "Post", slug: "post", bodyJson: { type: "doc", content: [] }, status: "draft",
    kind: "post", bodyFormat: "doc", updatedAt: "2026-01-01T00:00:00.000Z", version: 3, ...overrides,
  };
}

function embed(placementId: string, widgetEntryId: string): JsonObject {
  return { type: "widgetEmbed", attrs: { placementId, widgetEntryId } };
}

interface Harness {
  deps: EmbedServiceDeps;
  entryRepo: InMemoryEntryRepo;
  posts: Map<string, PostRecord>;
  updatePostCalls: UpdatePostCall[];
  restoreCalls: RestoreCall[];
  refsCalls: Array<{ sourceEntryId: string; sourceEntryType: string; bodyJson: unknown }>;
}

function harness(): Harness {
  const entryRepo = new InMemoryEntryRepo();
  const posts = new Map<string, PostRecord>();
  const updatePostCalls: UpdatePostCall[] = [];
  const restoreCalls: RestoreCall[] = [];
  const refsCalls: Harness["refsCalls"] = [];
  const postRepo: PostRepoPort = {
    findById: async ({ id }) => posts.get(id) ?? null,
    findBySlug: async () => null,
  };
  let id = 0;
  const postPorts: PostPorts = {
    isTrashed: (post) => post.deletedAt != null,
    isVersionConflict: (error): error is Error & { currentVersion: number } => error instanceof PostVersionConflict,
    isNotFound: (error) => error instanceof PostNotFound,
    updatePost: async (call) => {
      updatePostCalls.push(call);
      const current = posts.get(call.input.id)!;
      const post = { ...current, bodyJson: call.input.bodyJson, version: current.version + 1 };
      posts.set(post.id, post);
      return { post };
    },
    restorePostForward: async (call) => { restoreCalls.push(call); },
    findPublishedPostById: async () => null,
    findPublishedPostBySlug: async () => null,
  };
  const deps: EmbedServiceDeps = {
    entryLocks: createEntryLockState({}),
    host: {
      entries: widgetHostFixture.entries,
      entryRefs: { extract: (input) => { refsCalls.push(input); return []; } },
      posts: postPorts,
    },
    entryRepo,
    contentTypeRepo: new InMemoryContentTypeRepo(),
    entryRefsRepo: new InMemoryEntryRefsRepo(),
    postRepo,
    forgetRemovedPost: async () => {},
    changeSets: new InMemoryChangeSetRepo(),
    clock: { nowMs: () => 0 },
    ids: { newId: () => `id-${++id}` },
    authorize: async () => ({ allowed: true, reason: "fixture allowed" }),
    outbox: new InMemoryOutbox(),
  };
  return { deps, entryRepo, posts, updatePostCalls, restoreCalls, refsCalls };
}

async function seedEntryHost(h: Harness, bodyJson: unknown): Promise<EntryRecord> {
  const host = entryRecord({ id: "host-1", type: "article", bodyJson });
  await h.entryRepo.save(host);
  return host;
}

async function seedWidgets(h: Harness, ...ids: string[]): Promise<void> {
  for (const id of ids) await h.entryRepo.save(widgetRecord(id));
}

const entryHostInput = { workspaceId: WS, actor: userActor, hostEntryId: "host-1", baseVersion: 1 };
const postHostInput = { workspaceId: WS, actor: userActor, hostEntryId: "post-1", baseVersion: 3 };

describe("insertWidgetEmbed", () => {
  it("appends the embed to the end of an entry host's top-level content and returns the new placement id", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [{ type: "paragraph" }] });
    await seedWidgets(h, "w1");
    const { entry, placementId } = await insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } });
    expect(placementId).toBe("id-1");
    expect(entry.bodyJson).toEqual({ type: "doc", content: [{ type: "paragraph" }, embed("id-1", "w1")] });
    expect(entry.version).toBe(2);
  });

  it("re-extracts entry_refs for an entry host inside the write", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [] });
    await seedWidgets(h, "w1");
    await insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } });
    expect(h.refsCalls).toEqual([expect.objectContaining({ sourceEntryId: "host-1", sourceEntryType: "article" })]);
  });

  it("starts a fresh doc when the host body is not a doc node", async () => {
    const h = harness();
    await seedEntryHost(h, null);
    await seedWidgets(h, "w1");
    const { entry } = await insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } });
    expect(entry.bodyJson).toEqual({ type: "doc", content: [embed("id-1", "w1")] });
  });

  it("keeps a doc's other keys and treats a non-array content as empty", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: "broken", attrs: { lang: "en" } });
    await seedWidgets(h, "w1");
    const { entry } = await insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } });
    expect(entry.bodyJson).toEqual({ type: "doc", attrs: { lang: "en" }, content: [embed("id-1", "w1")] });
  });

  it("refuses a caller without widgets.place before reading the host", async () => {
    const h = harness();
    h.deps.authorize = async () => ({ allowed: false, reason: "no role" });
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetForbiddenError", message: "principal 'user-1' lacks permission 'widgets.place' (no role)",
    });
  });

  it("refuses a target id that is not a widget entry", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [] });
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "host-1" } })).rejects.toMatchObject({
      name: "WidgetInstanceNotFoundError", message: "embed references widget 'host-1', which does not exist in workspace 'ws-1'",
    });
  });

  it("refuses a target id that does not exist", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [] });
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "ghost" } })).rejects.toMatchObject({
      name: "WidgetInstanceNotFoundError", message: "embed references widget 'ghost', which does not exist in workspace 'ws-1'",
    });
  });

  it.each(["trash", "purged"] as const)("refuses a %s widget target", async (status) => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [] });
    await h.entryRepo.save(widgetRecord("w1", status));
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetInstanceNotFoundError", message: "embed references widget 'w1', which is trashed",
    });
  });

  it("refuses an embed inside a widget host (recursion guardrail)", async () => {
    const h = harness();
    await h.entryRepo.save({ ...widgetRecord("host-1"), bodyJson: { type: "doc", content: [] } });
    await seedWidgets(h, "w1");
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetEmbedGuardrailError", reason: "recursion", message: "widgetEmbed mutation on host entry rejected: recursion",
    });
  });

  it("refuses an embed past the configured per-document clamp", async () => {
    const h = harness();
    h.deps.maxEmbedsPerDocument = 1;
    await seedEntryHost(h, { type: "doc", content: [embed("p0", "w1")] });
    await seedWidgets(h, "w1");
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetEmbedGuardrailError", reason: "count-exceeded",
    });
  });

  it("applies the default clamp of 50 embeds when none is configured", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: Array.from({ length: 50 }, (_, i) => embed(`p${i}`, "w1")) });
    await seedWidgets(h, "w1");
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      reason: "count-exceeded",
    });
  });

  it("maps an entry version conflict to WidgetVersionConflictError carrying the stored version", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [] });
    await seedWidgets(h, "w1");
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, baseVersion: 7, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetVersionConflictError", currentVersion: 1, message: "expected version 7 for entry 'host-1', found 1",
    });
  });

  it("falls back to the loaded version when the host vanished before the conflict re-read", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [] });
    await seedWidgets(h, "w1");
    const updateEntry: WidgetHostPorts["entries"]["updateEntry"] = async () => {
      await h.entryRepo.hardDelete({ workspaceId: WS, id: "host-1" });
      return { ok: false, error: entryVersionConflictError({ id: "host-1", expectedVersion: 1, found: 4 }) };
    };
    h.deps.host = { ...h.deps.host, entries: { ...widgetHostFixture.entries, updateEntry } };
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetVersionConflictError", currentVersion: 1,
    });
  });

  it("rethrows any other entry write failure unchanged", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [] });
    await seedWidgets(h, "w1");
    const failure = new Error("disk full");
    const updateEntry: WidgetHostPorts["entries"]["updateEntry"] = async () => ({ ok: false, error: failure });
    h.deps.host = { ...h.deps.host, entries: { ...widgetHostFixture.entries, updateEntry } };
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } })).rejects.toBe(failure);
  });

  it("works without an injected lock state", async () => {
    const h = harness();
    delete h.deps.entryLocks;
    await seedEntryHost(h, { type: "doc", content: [] });
    await seedWidgets(h, "w1");
    const { placementId } = await insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } });
    expect(placementId).toBe("id-1");
  });
});

describe("embed host loading", () => {
  it("refuses a host id found in neither table", async () => {
    const h = harness();
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetEmbedHostNotFoundError",
      message: "host entry 'post-1' was not found in workspace 'ws-1' (it must be the id of an existing, non-trashed post, page, or content entry)",
    });
  });

  it("refuses a widget_area entry as a host", async () => {
    const h = harness();
    await h.entryRepo.save(entryRecord({ id: "host-1", type: "widget_area" }));
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetEmbedHostUnsupportedError", reason: "widget-area",
      message: "host 'host-1' is a widget_area entry, which can never host a widgetEmbed node",
    });
  });

  it("refuses a trashed post host", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord({ deletedAt: "2026-01-02T00:00:00.000Z" }));
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetEmbedHostNotFoundError",
    });
  });

  it("refuses an html-format page host", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord({ kind: "page", bodyFormat: "html" }));
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetEmbedHostUnsupportedError", reason: "html-page",
      message: "host 'post-1' is an HTML-format page, which has no rich-text body for widgetEmbed nodes; embed widgets in it with a data-embed-config marker of type \"widget\" via pages_write_region or pages_write_html instead",
    });
  });
});

describe("post host writes", () => {
  it("writes the new body through updatePost, forwarding every other field unchanged", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    const { entry } = await insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } });
    expect(entry.version).toBe(4);
    expect(h.updatePostCalls.map((call) => call.input)).toEqual([{
      workspaceId: WS, id: "post-1", title: "Post", slug: "post", status: "draft",
      bodyJson: { type: "doc", content: [embed("id-1", "w1")] }, expectedVersion: 3, actorId: "user-1",
      delegatedByWorkspaceId: undefined, delegatedById: undefined,
    }]);
  });

  it("records an applied change set and re-extracts refs against the post kind", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord({ kind: "page" }));
    await seedWidgets(h, "w1");
    await insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } });
    expect(await h.deps.changeSets.listByWorkspace({ workspaceId: WS })).toEqual([
      expect.objectContaining({ status: "applied", summary: "Update widgetEmbed placements on post post-1" }),
    ]);
    expect(h.refsCalls).toEqual([expect.objectContaining({ sourceEntryId: "post-1", sourceEntryType: "page" })]);
  });

  it("validates guardrails against the post kind", async () => {
    const h = harness();
    h.deps.maxEmbedsPerDocument = 0;
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      reason: "count-exceeded",
    });
  });

  it("attributes a non-user actor's write as delegated", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    await insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, actor: agentActor, widgetEntryId: "w1" } });
    expect(h.updatePostCalls[0]!.input).toMatchObject({ actorId: "agent-1", delegatedByWorkspaceId: WS, delegatedById: "agent-1" });
  });

  it("maps a post version conflict to WidgetVersionConflictError", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    h.deps.host.posts.updatePost = async () => { throw new PostVersionConflict("post moved on", 9); };
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetVersionConflictError", message: "post moved on", currentVersion: 9,
    });
  });

  it("maps a post not-found during the write (trash race) to WidgetEmbedHostNotFoundError", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    h.deps.host.posts.updatePost = async () => { throw new PostNotFound("gone"); };
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetEmbedHostNotFoundError",
      message: "host entry 'post-1' was not found in workspace 'ws-1' (it must be the id of an existing, non-trashed post, page, or content entry)",
    });
  });

  it("rewords the command gateway's content.write refusal as WidgetForbiddenError", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    h.deps.authorize = async ({ permission }) => ({ allowed: permission !== "content.write", reason: "read-only" });
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toMatchObject({
      name: "WidgetForbiddenError", message: "principal 'user-1' lacks permission 'content.write' (read-only)",
    });
  });

  it("rethrows any other post write failure unchanged", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    const failure = new Error("db offline");
    h.deps.host.posts.updatePost = async () => { throw failure; };
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toBe(failure);
  });

  it("restores the prior post forward when the change set fails to record", async () => {
    const h = harness();
    const prior = postRecord({ ext: { site: { a: 1 } }, templateChoice: "wide", overridesThemePage: true });
    h.posts.set("post-1", prior);
    await seedWidgets(h, "w1");
    const failure = new Error("change set store down");
    h.deps.changeSets.insert = async () => { throw failure; };
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toBe(failure);
    expect(h.restoreCalls.map((call) => call.input)).toEqual([
      { prior, actorId: "user-1", delegatedByWorkspaceId: undefined, delegatedById: undefined },
    ]);
  });

  it("captures ext, template choice and theme override in the change set's inverse payload", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord({ ext: { site: { a: 1 } }, templateChoice: "wide", overridesThemePage: true }));
    await seedWidgets(h, "w1");
    await insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } });
    const [changeSet] = await h.deps.changeSets.listByWorkspace({ workspaceId: WS });
    const stored = await h.deps.changeSets.findById({ workspaceId: WS, id: changeSet!.id });
    expect(stored!.items[0]!.inversePayload).toEqual({
      title: "Post", slug: "post", bodyJson: { type: "doc", content: [] }, status: "draft",
      templateChoice: "wide", overridesThemePage: true, ext: { site: { a: 1 } },
    });
  });

  it("nulls absent template/theme fields and omits an absent ext in the inverse payload", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    await insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } });
    const [changeSet] = await h.deps.changeSets.listByWorkspace({ workspaceId: WS });
    const stored = await h.deps.changeSets.findById({ workspaceId: WS, id: changeSet!.id });
    expect(stored!.items[0]!.inversePayload).toEqual({
      title: "Post", slug: "post", bodyJson: { type: "doc", content: [] }, status: "draft",
      templateChoice: null, overridesThemePage: null,
    });
  });

  it("attributes a non-user actor's compensating restore as delegated", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    h.deps.changeSets.insert = async () => { throw new Error("change set store down"); };
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, actor: agentActor, widgetEntryId: "w1" } })).rejects.toThrow("change set store down");
    expect(h.restoreCalls[0]!.input).toMatchObject({ actorId: "agent-1", delegatedByWorkspaceId: WS, delegatedById: "agent-1" });
  });

  it("skips the compensating restore when no prior post could be captured", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord());
    await seedWidgets(h, "w1");
    let reads = 0;
    const loadOnce = h.deps.postRepo.findById;
    h.deps.postRepo = { ...h.deps.postRepo, findById: async (q) => (++reads === 1 ? loadOnce(q) : null) };
    h.deps.changeSets.insert = async () => { throw new Error("change set store down"); };
    await expect(insertWidgetEmbed({ deps: h.deps, input: { ...postHostInput, widgetEntryId: "w1" } })).rejects.toThrow("change set store down");
    expect(h.restoreCalls).toEqual([]);
  });
});

describe("removeWidgetEmbed", () => {
  it("removes every embed with the placement id at any depth, leaving every other node in place", async () => {
    const h = harness();
    const body = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        embed("p1", "w1"),
        { type: "blockquote", content: [embed("p1", "w1"), embed("p2", "w2")] },
        embed("p3", "w3"),
      ],
    };
    await seedEntryHost(h, body);
    const { entry } = await removeWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, placementId: "p1" } });
    expect(entry.bodyJson).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "blockquote", content: [embed("p2", "w2")] },
        embed("p3", "w3"),
      ],
    });
  });

  it("does not mutate the stored document it read", async () => {
    const h = harness();
    const body = { type: "doc", content: [embed("p1", "w1"), { type: "paragraph" }] };
    await seedEntryHost(h, body);
    await removeWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, placementId: "p1" } });
    expect(body).toEqual({ type: "doc", content: [embed("p1", "w1"), { type: "paragraph" }] });
  });

  it("finds a placement nested under a non-matching embed that itself carries content", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [{ ...embed("outer", "w1"), content: [embed("inner", "w2")] }] });
    const { entry } = await removeWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, placementId: "inner" } });
    expect(entry.bodyJson).toEqual({ type: "doc", content: [{ ...embed("outer", "w1"), content: [] }] });
  });

  it("removes from a post host", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord({ bodyJson: { type: "doc", content: [embed("p1", "w1")] } }));
    const { entry } = await removeWidgetEmbed({ deps: h.deps, input: { ...postHostInput, placementId: "p1" } });
    expect(entry.bodyJson).toEqual({ type: "doc", content: [] });
  });

  it("refuses an unknown placement id instead of reporting a no-op success", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [embed("p1", "w1"), { type: "paragraph" }, "loose"] });
    await expect(removeWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, placementId: "nope" } })).rejects.toMatchObject({
      name: "WidgetEmbedPlacementNotFoundError", message: "no widget embed with placementId 'nope' was found in host 'host-1'",
    });
  });

  it("refuses when the host has no body at all", async () => {
    const h = harness();
    await seedEntryHost(h, null);
    await expect(removeWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, placementId: "p1" } })).rejects.toMatchObject({
      name: "WidgetEmbedPlacementNotFoundError",
    });
  });

  it("does not match an embed whose attrs are not a record", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [{ type: "widgetEmbed", attrs: "p1" }] });
    await expect(removeWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, placementId: "p1" } })).rejects.toMatchObject({
      name: "WidgetEmbedPlacementNotFoundError",
    });
  });

  it("refuses a caller without widgets.place", async () => {
    const h = harness();
    h.deps.authorize = async () => ({ allowed: false, reason: "no role" });
    await expect(removeWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, placementId: "p1" } })).rejects.toMatchObject({
      name: "WidgetForbiddenError", message: "principal 'user-1' lacks permission 'widgets.place' (no role)",
    });
  });

  it("works without an injected lock state", async () => {
    const h = harness();
    delete h.deps.entryLocks;
    await seedEntryHost(h, { type: "doc", content: [embed("p1", "w1")] });
    const { entry } = await removeWidgetEmbed({ deps: h.deps, input: { ...entryHostInput, placementId: "p1" } });
    expect(entry.bodyJson).toEqual({ type: "doc", content: [] });
  });
});

describe("reorderWidgetEmbeds", () => {
  it("reassigns widgets to the existing slots in document order with fresh placement ids, keeping the document shape", async () => {
    const h = harness();
    await seedEntryHost(h, {
      type: "doc",
      content: [
        embed("p1", "w1"),
        { type: "paragraph", content: [{ type: "text", text: "between" }] },
        { type: "blockquote", content: [embed("p2", "w2")] },
        embed("p3", "w3"),
      ],
    });
    await seedWidgets(h, "w1", "w2", "w3");
    const { entry } = await reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: ["w3", "w1", "w2"] } });
    expect(entry.bodyJson).toEqual({
      type: "doc",
      content: [
        embed("id-1", "w3"),
        { type: "paragraph", content: [{ type: "text", text: "between" }] },
        { type: "blockquote", content: [embed("id-2", "w1")] },
        embed("id-3", "w2"),
      ],
    });
  });

  it("does not mutate the stored document it read", async () => {
    const h = harness();
    const body = { type: "doc", content: [embed("p1", "w1"), embed("p2", "w2")] };
    await seedEntryHost(h, body);
    await seedWidgets(h, "w1", "w2");
    await reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: ["w2", "w1"] } });
    expect(body).toEqual({ type: "doc", content: [embed("p1", "w1"), embed("p2", "w2")] });
  });

  it("walks a body nested deeper than the call stack allows", async () => {
    const h = harness();
    let node: JsonObject = embed("p1", "w1");
    for (let i = 0; i < 20000; i++) node = { type: "blockquote", content: [node] };
    await seedEntryHost(h, { type: "doc", content: [node] });
    await seedWidgets(h, "w1", "w2");
    const { entry } = await reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: ["w2"] } });
    let leaf: unknown = entry.bodyJson;
    while ((leaf as JsonObject).type !== "widgetEmbed") leaf = ((leaf as JsonObject).content as unknown[])[0];
    expect(leaf).toEqual(embed("id-1", "w2"));
  });

  it("skips non-record nodes when counting and rewriting slots", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: ["loose", null, embed("p1", "w1")] });
    await seedWidgets(h, "w1");
    const { entry } = await reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: ["w1"] } });
    expect(entry.bodyJson).toEqual({ type: "doc", content: ["loose", null, embed("id-1", "w1")] });
  });

  it("leaves an embed node whose attrs are not a record untouched", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [{ type: "widgetEmbed", attrs: "p0" }] });
    const { entry } = await reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: [] } });
    expect(entry.bodyJson).toEqual({ type: "doc", content: [{ type: "widgetEmbed", attrs: "p0" }] });
  });

  it("copies a node without content as-is, adding no content key", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [{ type: "horizontalRule" }] });
    const { entry } = await reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: [] } });
    expect(entry.bodyJson).toStrictEqual({ type: "doc", content: [{ type: "horizontalRule" }] });
  });

  it("counts only embeds whose ids are both strings", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [embed("p1", "w1"), { type: "widgetEmbed", attrs: { placementId: 1, widgetEntryId: "w2" } }] });
    await seedWidgets(h, "w1");
    await expect(reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: ["w1", "w1"] } })).rejects.toMatchObject({
      name: "WidgetEmbedReorderCountMismatchError", expectedCount: 1, actualCount: 2,
    });
  });

  it("does not count an embed whose widgetEntryId is not a string", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [{ type: "widgetEmbed", attrs: { placementId: "p1", widgetEntryId: 7 } }] });
    await expect(reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: ["w1"] } })).rejects.toMatchObject({
      expectedCount: 0, actualCount: 1,
    });
  });

  it("rewrites a malformed embed slot too, so one valid id can land a slot with no widgetEntryId (reported, not fixed)", async () => {
    // collectEmbeds counts only string-id embeds, but reorderEmbedSlots rewrites every widgetEmbed
    // node with record attrs — the count check passes and the extra slot gets `undefined`.
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [{ type: "widgetEmbed", attrs: {} }, embed("p1", "w1")] });
    await seedWidgets(h, "w1");
    const { entry } = await reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: ["w1"] } });
    expect(entry.bodyJson).toEqual({
      type: "doc",
      content: [embed("id-1", "w1"), { type: "widgetEmbed", attrs: { placementId: "id-2", widgetEntryId: undefined } }],
    });
  });

  it("refuses a count mismatch before writing", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [embed("p1", "w1")] });
    const error = await reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: [] } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WidgetEmbedReorderCountMismatchError);
    expect(error).toMatchObject({
      name: "WidgetEmbedReorderCountMismatchError", expectedCount: 1, actualCount: 0,
      message: "reorder must supply exactly one widgetEntryId per existing embed slot (1 present, 0 supplied)",
    });
    expect((await h.entryRepo.findById({ workspaceId: WS, id: "host-1" }))!.version).toBe(1);
  });

  it("refuses an empty replacement id", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [embed("p1", "w1")] });
    await expect(reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: [""] } })).rejects.toMatchObject({
      name: "WidgetInstanceNotFoundError", message: "reorder contains an invalid widgetEntryId",
    });
  });

  it("refuses a non-string replacement id", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [embed("p1", "w1")] });
    const ids: unknown[] = [42];
    await expect(reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: ids as string[] } })).rejects.toMatchObject({
      name: "WidgetInstanceNotFoundError", message: "reorder contains an invalid widgetEntryId",
    });
  });

  it("refuses a replacement id that is not a live widget", async () => {
    const h = harness();
    await seedEntryHost(h, { type: "doc", content: [embed("p1", "w1")] });
    await expect(reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: ["does-not-exist"] } })).rejects.toMatchObject({
      name: "WidgetInstanceNotFoundError", message: "embed references widget 'does-not-exist', which does not exist in workspace 'ws-1'",
    });
  });

  it("reorders a post host's embeds", async () => {
    const h = harness();
    h.posts.set("post-1", postRecord({ bodyJson: { type: "doc", content: [embed("p1", "w1"), embed("p2", "w2")] } }));
    await seedWidgets(h, "w1", "w2");
    const { entry } = await reorderWidgetEmbeds({ deps: h.deps, input: { ...postHostInput, orderedWidgetEntryIds: ["w2", "w1"] } });
    expect(entry.bodyJson).toEqual({ type: "doc", content: [embed("id-1", "w2"), embed("id-2", "w1")] });
  });

  it("refuses a caller without widgets.place", async () => {
    const h = harness();
    h.deps.authorize = async () => ({ allowed: false, reason: "no role" });
    await expect(reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: [] } })).rejects.toMatchObject({
      name: "WidgetForbiddenError", message: "principal 'user-1' lacks permission 'widgets.place' (no role)",
    });
  });

  it("works without an injected lock state", async () => {
    const h = harness();
    delete h.deps.entryLocks;
    await seedEntryHost(h, { type: "doc", content: [] });
    const { entry } = await reorderWidgetEmbeds({ deps: h.deps, input: { ...entryHostInput, orderedWidgetEntryIds: [] } });
    expect(entry.bodyJson).toEqual({ type: "doc", content: [] });
  });
});
