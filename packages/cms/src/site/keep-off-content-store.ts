import type { Kysely } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";

type Kernel = StorageKernel<Kysely<{
  presentation_settings: { active_theme_id: string };
  posts: { id: string; title: string; body_html: string | null; body_format: string; status: string };
  menus: { id: string; title: string; doc_json: string };
  form_definitions: { id: string; name: string; fields_json: string; status: string };
}>, unknown>;

export function contentStore({ db: kernel }: { db: StorageKernel<unknown, unknown> }, _optional = {}) {
  const db = kernel as Kernel;
  return {
    activeThemeIds: async () => (await db.run(query => query.selectFrom("presentation_settings").select("active_theme_id").execute())).map(row => row.active_theme_id),
    reassignActiveTheme: ({ from, to }: { from: string; to: string }) => db.run(query => query.updateTable("presentation_settings").set({ active_theme_id: to }).where("active_theme_id", "=", from).execute()).then(() => undefined),
    publishedHtmlPages: async () => (await db.run(query => query.selectFrom("posts").select(["id", "title", "body_html"]).where("body_format", "=", "html").where("status", "=", "published").execute())).map(row => ({ id: row.id, title: row.title, bodyHtml: row.body_html })),
    draftPage: ({ id }: { id: string }) => db.run(query => query.updateTable("posts").set({ status: "draft" }).where("id", "=", id).execute()).then(() => undefined),
    menus: async () => (await db.run(query => query.selectFrom("menus").select(["id", "title", "doc_json"]).execute())).map(row => ({ id: row.id, title: row.title, docJson: row.doc_json })),
    setMenuDoc: ({ id, docJson }: { id: string; docJson: string }) => db.run(query => query.updateTable("menus").set({ doc_json: docJson }).where("id", "=", id).execute()).then(() => undefined),
    forms: async () => (await db.run(query => query.selectFrom("form_definitions").select(["id", "name", "fields_json"]).execute())).map(row => ({ id: row.id, name: row.name, fieldsJson: row.fields_json })),
    disableForm: ({ id }: { id: string }) => db.run(query => query.updateTable("form_definitions").set({ status: "disabled" }).where("id", "=", id).execute()).then(() => undefined),
    close: () => db.close(),
  };
}

