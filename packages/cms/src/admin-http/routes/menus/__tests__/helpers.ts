import type { OutboxPort } from "@jini-ai/core/contracts/events";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { NavMenuEntry } from "../../../../navigation/index.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../../../../navigation/index.js";
import { InMemoryOutbox } from "../../../../redirects/__tests__/support/events.fixture.js";

/** @file Shared fakes for the menus route-spec tests: a fixed menu row, a recording authorizer, the refusal reader and two write-deps factories. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;
/** The host's raw-HTML permission is injected, so the tests use a value no real host ships. */
export const RAW_HTML_PERMISSION = "test.raw_html";
/** Words a classified error for the caller as the Tovu host does: its own message, unchanged. */
export const outwardErrorMessage = ({ error }: { error: Error }): string => error.message;

/** One stored menu, so serialized DTOs can be pinned field by field. */
export function fakeMenu(overrides: Partial<NavMenuEntry> = {}): NavMenuEntry {
  return {
    id: "m1", workspaceId: WORKSPACE_ID, title: "Header", slug: "header-main", status: "published", version: 1,
    doc: { type: "menu", version: 1, items: [{ id: "home", label: "Home", target: { kind: "url", href: "/" } }] },
    locations: [], updatedAt: "2026-10-08T00:00:00.000Z", ...overrides,
  } as NavMenuEntry;
}

/** The serialized form of {@link fakeMenu}: optional item fields stay as `undefined` keys, as the host wrote them. */
export function fakeMenuDto(overrides: Partial<NavMenuEntry> = {}): Record<string, unknown> {
  const menu = fakeMenu(overrides);
  return {
    id: menu.id, workspaceId: menu.workspaceId, slug: menu.slug, title: menu.title, status: menu.status,
    items: menu.doc.items.map((item) => ({ id: item.id, label: item.label, target: item.target, attrs: item.attrs, children: undefined })),
    locations: [...menu.locations], updatedAt: menu.updatedAt, version: menu.version,
  };
}

/** One recorded authorization: the permission, the entity type and, for by-id routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; `denied` permissions throw, as the host port's 403 refusal would. */
export function recordingAuthorize(denied: readonly string[] = []): {
  authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[];
} {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }, optional = {}) => {
      calls.push({ permission, entityType, ...optional });
      if (denied.includes(permission)) throw new Error(`denied ${permission}`);
    },
  };
}

/** Run `fn` and return the refusal it throws (status + flat body); fails if it does not refuse. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

/** The raw input a host adapter hands `parse`. */
export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });

/** Real write deps over the in-memory repos, so the specs are pinned against the real menu services. */
export async function makeWriteDeps(rows: NavMenuEntry[] = [fakeMenu()]) {
  let tick = 0;
  const menuRepo = new InMemoryMenuRepo({}, { initialRows: rows });
  return {
    workspaceId: WORKSPACE_ID,
    menuRepo,
    navLocationBindingRepo: new InMemoryNavLocationBindingRepo({}),
    clock: { nowMs: () => Date.parse("2026-10-08T01:00:00.000Z") + 1000 * tick++ },
    idGen: { newId: () => `id-${++tick}` },
    outbox: new InMemoryOutbox(),
    outwardErrorMessage,
    rawHtmlPermission: RAW_HTML_PERMISSION,
    // Identity normalizer: the specs only pass it through; markup balancing is the host's Node adapter.
    normalizeMenuHtml: ({ html }: { html: string }) => html,
  };
}

/** The write collaborators the menu service needs, over empty in-memory repos and a recording outbox. */
export function makeMenuDeps() {
  let idTick = 0;
  const enqueued: unknown[] = [];
  const outbox: OutboxPort = {
    enqueue: async (event) => { enqueued.push(event); },
    claimPending: async () => [],
    markDelivered: async () => {},
    markFailed: async () => {},
  };
  return {
    workspaceId: WORKSPACE_ID,
    outwardErrorMessage,
    rawHtmlPermission: "pages.edit_html",
    menuRepo: new InMemoryMenuRepo({}),
    navLocationBindingRepo: new InMemoryNavLocationBindingRepo({}),
    clock: { nowMs: () => Date.parse("2026-07-10T00:00:00.000Z"), nowIso: () => "2026-07-10T00:00:00.000Z" },
    idGen: { newId: () => `id-${++idTick}` },
    outbox,
    enqueued,
    normalizeMenuHtml: ({ html }: { html: string }) => `<!--n-->${html}`,
  };
}
