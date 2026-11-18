import { describe, expect, test } from "vitest";
import {
  createEmailTemplate,
  editEmailTemplate,
  EmailTemplateInputError,
  EmailTemplateNotFoundError,
  EmailTemplateVersionConflictError,
  listEmailTemplates,
  readFieldValues,
  renameEmailTemplate,
  requireText,
  type EmailTemplateRecord,
  type EmailTemplateStore,
} from "../email-template-operations.js";

const HTML = '<html><head><meta name="email-fields" content="name=Ada"><title>Hi {{name}}</title></head><body><p>Hello {{name}} {{code}}</p></body></html>';

/** In-memory store: versions bump on every write; `race` makes the next conditioned write lose. */
function memoryStore(_required = {}, _options = {}) {
  const rows = new Map<string, EmailTemplateRecord>();
  let n = 0;
  let race = false;
  const store: EmailTemplateStore = {
    find: async ({ id }) => rows.get(id) ?? null,
    create: async ({ name, seedHtml }) => {
      const record = { id: `t${++n}`, name, html: seedHtml, version: 1, updatedAt: `2026-01-0${n}T00:00:00.000Z` };
      rows.set(record.id, record);
      return record;
    },
    openHtml: async ({ id }) => {
      const at = rows.get(id)!;
      return { version: at.version, write: async ({ html }) => { if (race) return false; rows.set(id, { ...at, html, version: at.version + 1 }); return true; } };
    },
    rename: async ({ id, name, ifVersion }) => {
      const at = rows.get(id)!;
      if (race || at.version !== ifVersion) return false;
      rows.set(id, { ...at, name, version: at.version + 1 });
      return true;
    },
    listPage: async ({ limit, before }) => [...rows.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .filter((r) => !before || r.updatedAt < before.updatedAt || (r.updatedAt === before.updatedAt && r.id < before.id))
      .slice(0, limit),
  };
  return { store, rows, setRace: (value: boolean) => { race = value; } };
}

describe("email-template operations over a host store", () => {
  test("create reads subject and declarations from the stored html", async () => {
    const { store } = memoryStore();
    const created = await createEmailTemplate({ store, input: { name: "  Welcome  ", html: HTML }, actorId: "u1" });
    expect(created).toMatchObject({ id: "t1", name: "Welcome", subject: "Hi {{name}}", fields: [{ name: "name", sample: "Ada" }], version: 1, undeclaredFields: ["code"] });
  });

  test("edit honours expectedVersion and maps a lost write to a version conflict", async () => {
    const { store, setRace } = memoryStore();
    await createEmailTemplate({ store, input: { name: "T", html: HTML }, actorId: "u1" });
    await expect(editEmailTemplate({ store, input: { id: "t1", html: "<p>x</p>", expectedVersion: 9 }, actorId: "u1" })).rejects.toThrow(EmailTemplateVersionConflictError);
    expect((await editEmailTemplate({ store, input: { id: "t1", html: "<p>x</p>", expectedVersion: 1 }, actorId: "u1" })).version).toBe(2);
    setRace(true);
    await expect(editEmailTemplate({ store, input: { id: "t1", html: "<p>y</p>" }, actorId: "u1" })).rejects.toThrow(/edited elsewhere/);
    await expect(editEmailTemplate({ store, input: { id: "nope", html: "<p>y</p>" }, actorId: "u1" })).rejects.toThrow(EmailTemplateNotFoundError);
  });

  test("edit against a store that captured no version refuses a stated expectedVersion and writes an unstated one", async () => {
    const { store } = memoryStore();
    await createEmailTemplate({ store, input: { name: "T", html: HTML }, actorId: "u1" });
    const unversioned: EmailTemplateStore = { ...store, openHtml: async (args) => ({ ...(await store.openHtml(args)), version: null }) };
    await expect(editEmailTemplate({ store: unversioned, input: { id: "t1", html: "<p>x</p>", expectedVersion: 1 }, actorId: "u1" })).rejects.toThrow(/is at version null, not 1/);
    expect((await editEmailTemplate({ store: unversioned, input: { id: "t1", html: "<p>x</p>" }, actorId: "u1" })).html).toBe("<p>x</p>");
  });

  test("rename is version-conditioned", async () => {
    const { store, setRace } = memoryStore();
    await createEmailTemplate({ store, input: { name: "Old", html: HTML }, actorId: "u1" });
    expect((await renameEmailTemplate({ store, input: { id: "t1", name: "New", expectedVersion: 1 } })).name).toBe("New");
    setRace(true);
    await expect(renameEmailTemplate({ store, input: { id: "t1", name: "Newer" } })).rejects.toThrow(EmailTemplateVersionConflictError);
  });

  test("list pages with an opaque cursor and refuses a forged one", async () => {
    const { store } = memoryStore();
    for (const name of ["A", "B", "C"]) await createEmailTemplate({ store, input: { name, html: HTML }, actorId: "u1" });
    const first = await listEmailTemplates({ store, input: { limit: 2 } });
    expect(first.templates.map((t) => t.name)).toEqual(["C", "B"]);
    const second = await listEmailTemplates({ store, input: { limit: 2, cursor: first.nextCursor } });
    expect(second).toEqual({ templates: [expect.objectContaining({ name: "A" })] });
    await expect(listEmailTemplates({ store, input: { cursor: "not-a-cursor" } })).rejects.toThrow(EmailTemplateInputError);
    await expect(listEmailTemplates({ store, input: { limit: 0 } })).rejects.toThrow(/limit must be/);
  });

  // Moved from the host's operations test ("readFieldValues and requireText contracts").
  test("readFieldValues and requireText contracts", () => {
    expect(readFieldValues({ value: undefined })).toEqual({});
    expect(readFieldValues({ value: { a: "x", b: 2, c: false } })).toEqual({ a: "x", b: "2", c: "false" });
    expect(requireText({ value: " a ", key: "k", max: 1 })).toBe("a");
    expect(() => requireText({ value: 3, key: "k", max: 1 })).toThrow(/k is required/);
    expect(() => requireText({ value: "ab", key: "k", max: 1 })).toThrow(/at most 1/);
  });
});
