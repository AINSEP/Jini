import { describe, expect, test } from "vitest";
import {
  createEmailTemplate,
  editEmailTemplate,
  getEmailTemplate,
  EmailTemplateInputError,
  EmailTemplateNotFoundError,
  EmailTemplateVersionConflictError,
  listEmailTemplates,
  previewEmailTemplate,
  readFieldValues,
  renameEmailTemplate,
  renderEmailTemplateForSend,
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

  test.each([
    { fields: undefined, declarations: [], greeting: "Hello," },
    { fields: "name=Ada,code", declarations: [{ name: "name", sample: "Ada" }, { name: "code" }], greeting: "Hello {{name}}," },
    { fields: [{ name: "name", sample: "Ada" }, { name: "code" }, "city=London"],
      declarations: [{ name: "name", sample: "Ada" }, { name: "code" }, { name: "city", sample: "London" }], greeting: "Hello {{name}}," },
  ])("creates a starter from fields $fields", async ({ fields, declarations, greeting }) => {
    const { store } = memoryStore();
    await createEmailTemplate({ store, input: { name: "Welcome & thanks", fields }, actorId: "operator" });
    const record = await getEmailTemplate({ store, id: "t1" });
    expect(record).toMatchObject({ name: "Welcome & thanks", subject: "Welcome & thanks", fields: declarations, version: 1 });
    expect(record.html).toContain(`<p>${greeting}</p>`);
    expect(record.html).toContain("<title>Welcome &amp; thanks</title>");
  });

  test.each([
    { input: { fields: {} }, message: "fields must be a list of field names." },
    { input: { fields: [null] }, message: "each field must be a name or {name, sample}." },
    { input: { fields: [{ name: "first,last" }] }, message: "field names cannot contain commas or equals signs." },
    { input: { fields: [{ name: "first=last" }] }, message: "field names cannot contain commas or equals signs." },
    { input: { fields: [{ name: "name", sample: "Ada,Lovelace" }] }, message: "field samples cannot contain commas." },
    { input: { html: 123 }, message: "html must be a string." },
    { input: { subject: false }, message: "subject must be a string." },
  ])("refuses $message before creating a row", async ({ input, message }) => {
    const { store, rows } = memoryStore();
    const operation = createEmailTemplate({ store, input: { name: "Welcome", ...input }, actorId: "operator" });
    await expect(operation).rejects.toThrow(EmailTemplateInputError);
    await expect(operation).rejects.toThrow(message);
    expect(rows.size).toBe(0);
  });

  test("stale rename leaves both the saved name and HTML alone", async () => {
    const { store } = memoryStore();
    await createEmailTemplate({ store, input: { name: "Before", html: HTML }, actorId: "operator" });
    const rename = renameEmailTemplate({ store, input: { id: "t1", name: "After", expectedVersion: 2 } });
    await expect(rename).rejects.toThrow(EmailTemplateVersionConflictError);
    await expect(rename).rejects.toThrow("is at version 1, not 2");
    expect(await store.find({ id: "t1" })).toMatchObject({ name: "Before", html: HTML, version: 1 });
  });

  test("renders saved sample HTML only in admin preview and uses real values for delivery", async () => {
    const { store } = memoryStore();
    const html = HTML.replace("</body>", "<script>window.preview = true</script></body>");
    await createEmailTemplate({ store, input: { name: "Welcome", html }, actorId: "operator" });
    const admin = await previewEmailTemplate({ store, input: { id: "t1" } });
    expect(admin).toMatchObject({ subject: "Hi Ada", mode: "admin", scriptsStripped: false, missingFields: ["code"], undeclaredFields: ["code"] });
    expect(admin.html).toContain("<script>window.preview = true</script>");
    expect(admin.text).toBeUndefined();

    const sent = await previewEmailTemplate({ store, input: { html, mode: "sent", values: { name: "Grace", code: 42 } } });
    expect(sent).toMatchObject({ subject: "Hi Grace", text: "Hello Grace 42", mode: "sent", scriptsStripped: true, missingFields: [], undeclaredFields: ["code"] });
    expect(sent.html).not.toContain("window.preview");

    const delivery = await renderEmailTemplateForSend({ store, id: "t1", values: { name: "Lin", code: "77" } });
    expect(delivery).toMatchObject({ subject: "Hi Lin", text: "Hello Lin 77", missingFields: [] });
    expect(delivery.html).toContain("<p>Hello Lin 77</p>");
    expect(delivery.html).not.toContain("window.preview");
  });

  test.each([
    { input: { mode: "raw" }, message: 'mode must be "admin" or "sent".' },
    { input: { values: null }, message: "values must be an object of field name to text." },
    { input: { values: [] }, message: "values must be an object of field name to text." },
    { input: { values: 42 }, message: "values must be an object of field name to text." },
    { input: { values: { name: { name: "Ada" } } }, message: "values.name must be text, a number or a boolean." },
  ])("refuses preview input with $message", async ({ input, message }) => {
    const { store } = memoryStore();
    const preview = previewEmailTemplate({ store, input: { html: HTML, ...input } });
    await expect(preview).rejects.toThrow(EmailTemplateInputError);
    await expect(preview).rejects.toThrow(message);
  });

  test("a structurally invalid decoded cursor is rejected rather than paging from the start", async () => {
    const { store } = memoryStore();
    const cursor = Buffer.from('{"updatedAt":"2026-01-01T00:00:00.000Z","id":7}').toString("base64url");
    const result = listEmailTemplates({ store, input: { cursor } });
    await expect(result).rejects.toThrow(EmailTemplateInputError);
    await expect(result).rejects.toThrow("cursor must be a nextCursor returned by email_template_list.");
  });
});

test.each([0, 1.5, "1"])("refuses to edit with a malformed expected version %j", async expectedVersion => {
  const { store } = memoryStore();
  await createEmailTemplate({ store, input: { name: "Welcome", html: HTML }, actorId: "operator" });
  const operation = editEmailTemplate({ store, input: { id: "t1", html: "<title>Changed</title>", expectedVersion }, actorId: "operator" });
  await expect(operation).rejects.toThrow(EmailTemplateInputError);
  await expect(operation).rejects.toThrow("expectedVersion must be the positive integer version a read returned.");
  expect(await store.find({ id: "t1" })).toMatchObject({ html: HTML, version: 1 });
});
