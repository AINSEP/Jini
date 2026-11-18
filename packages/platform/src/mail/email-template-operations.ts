/**
 * @module email-template-operations
 *
 * The ONE set of email-template operations — create, edit, rename, list, get, preview and the send
 * render — that every surface of a host (its admin routes, its agent tools) calls. Permission checks
 * stay with those callers.
 *
 * Storage is a host port ({@link EmailTemplateStore}): the host decides where a template lives and
 * how its html body is written (compare-and-set writes, revision history, trash). These operations
 * own input validation, version conditioning, paging and the summary/detail/preview shapes.
 *
 * A template's subject and fields live in its one html body, not in extra columns, so an agent edits
 * a template with full-document writes. The pure renders live in `./email-template.js`.
 */
import {
  emailTemplateSkeleton,
  parseFieldDeclarations,
  readTemplateDeclarations,
  renderEmailForSend,
  renderEmailPreview,
  undeclaredFieldsIn,
  type EmailFieldValues,
  type EmailTemplateField,
  type SendableEmail,
} from "./email-template.js";

/** Bounds a template's name; the body is bounded by the host's request body-size limit. */
export const EMAIL_TEMPLATE_NAME_MAX = 200;

export class EmailTemplateNotFoundError extends Error {}
/** The caller's input is malformed; the message says how to fix it. */
export class EmailTemplateInputError extends Error {}
/** `expectedVersion` no longer matches, or another writer landed mid-write. Re-read and retry. */
export class EmailTemplateVersionConflictError extends Error {}

/** A live template as the host's store holds it. */
export interface EmailTemplateRecord {
  id: string;
  name: string;
  html: string;
  version: number;
  updatedAt: string;
}

/** A template's html body opened for one conditioned write. */
export interface EmailTemplateHtmlSession {
  /**
   * The version the write is conditioned on; a stated `expectedVersion` must equal it. `null` when
   * the store captured none: no stated `expectedVersion` can then match, so only an unconditioned edit proceeds.
   */
  version: number | null;
  /** Compare-and-set write of the whole html; resolves `false` when another writer landed first. */
  write(args: { html: string }): Promise<boolean>;
}

/** The host's template storage. */
export interface EmailTemplateStore {
  /** The live template `id`, or `null` (missing, trashed, another kind, not yet html). */
  find(args: { id: string }): Promise<EmailTemplateRecord | null>;
  /** Atomically creates a template named `name` whose html body is born from `seedHtml`; returns it. */
  create(args: { name: string; seedHtml: string; actorId: string }): Promise<EmailTemplateRecord>;
  /** Opens a live template's html body for one conditioned write. */
  openHtml(args: { id: string; actorId: string }): Promise<EmailTemplateHtmlSession>;
  /** Renames the template if it is still at `ifVersion`; resolves `false` when another writer landed first. */
  rename(args: { id: string; name: string; ifVersion: number }): Promise<boolean>;
  /**
   * Up to `limit` entries, most recently updated first (id breaking ties), strictly after the
   * `before` position. An entry that is not a live template comes back as `null` and still counts.
   */
  listPage(args: { limit: number; before?: { updatedAt: string; id: string } }): Promise<Array<EmailTemplateRecord | null>>;
}

export interface EmailTemplateSummary {
  id: string;
  name: string;
  subject: string;
  fields: EmailTemplateField[];
  version: number;
  updatedAt: string;
}

export interface EmailTemplateDetail extends EmailTemplateSummary {
  html: string;
  /** `{{field}}`s the HTML uses that `<meta name="email-fields">` does not declare. */
  undeclaredFields: string[];
}

export interface EmailTemplatePreview {
  subject: string;
  html: string;
  missingFields: string[];
  undeclaredFields: string[];
  /** `"admin"` keeps scripts (render in a sandboxed preview iframe); `"sent"` is the static email. */
  mode: "admin" | "sent";
  scriptsStripped: boolean;
  /** The plain-text alternative, `"sent"` mode only. */
  text?: string;
}

async function loadTemplate({ store, id }: { store: EmailTemplateStore; id: string }, _options = {}): Promise<EmailTemplateRecord> {
  const record = await store.find({ id });
  if (record === null) throw new EmailTemplateNotFoundError(`email template '${id}' was not found`);
  return record;
}

function toSummary(record: EmailTemplateRecord, _options = {}): EmailTemplateSummary {
  const declarations = readTemplateDeclarations({ html: record.html });
  return { id: record.id, name: record.name, subject: declarations.subject, fields: declarations.fields, version: record.version, updatedAt: record.updatedAt };
}

function toDetail(record: EmailTemplateRecord, _options = {}): EmailTemplateDetail {
  const summary = toSummary(record);
  return { ...summary, html: record.html, undeclaredFields: undeclaredFieldsIn({ html: record.html, declarations: summary }) };
}

/** A required, trimmed, bounded string. */
export function requireText({ value, key, max }: { value: unknown; key: string; max: number }, _options = {}): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new EmailTemplateInputError(`${key} is required and must be a non-empty string.`);
  if (text.length > max) throw new EmailTemplateInputError(`${key} must be at most ${max} characters.`);
  return text;
}

/** An optional string; `undefined` when absent. */
function optionalString({ value, key }: { value: unknown; key: string }, _options = {}): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new EmailTemplateInputError(`${key} must be a string.`);
  return value;
}

/** Field values: strings, numbers and booleans (stringified); anything else is refused. */
export function readFieldValues({ value }: { value: unknown }, _options = {}): Record<string, string> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new EmailTemplateInputError("values must be an object of field name to text.");
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!["string", "number", "boolean"].includes(typeof raw)) throw new EmailTemplateInputError(`values.${name} must be text, a number or a boolean.`);
    out[name] = String(raw);
  }
  return out;
}

/** Field declarations from either a list of names / `{name, sample}` objects, or the meta `content` string form. */
function readFieldsInput({ value }: { value: unknown }, _options = {}): EmailTemplateField[] {
  if (value === undefined) return [];
  if (typeof value === "string") return parseFieldDeclarations({ content: value });
  if (!Array.isArray(value)) throw new EmailTemplateInputError("fields must be a list of field names.");
  const entries = value.map((entry) => (typeof entry === "string" ? entry : formatFieldObject({ entry: entry })));
  return parseFieldDeclarations({ content: entries.join(",") });
}

function formatFieldObject({ entry }: { entry: unknown }, _options = {}): string {
  const record = (entry ?? {}) as { name?: unknown; sample?: unknown };
  if (typeof record.name !== "string") throw new EmailTemplateInputError("each field must be a name or {name, sample}.");
  if (record.name.includes(",") || record.name.includes("=")) throw new EmailTemplateInputError("field names cannot contain commas or equals signs.");
  if (typeof record.sample === "string" && record.sample.includes(",")) throw new EmailTemplateInputError("field samples cannot contain commas.");
  return typeof record.sample === "string" ? `${record.name}=${record.sample}` : record.name;
}

function readExpectedVersion({ value }: { value: unknown }, _options = {}): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) throw new EmailTemplateInputError("expectedVersion must be the positive integer version a read returned.");
  return value as number;
}

/**
 * Creates a template; the store births its html body from the seed.
 * @param required.input - `{ name, html?, subject?, fields? }`; with no `html`, a starter email is
 *   built from `subject` (default: the name) and `fields`.
 * @throws {EmailTemplateInputError} For a missing name or malformed fields/html.
 */
export async function createEmailTemplate(
  { store, input, actorId }: { store: EmailTemplateStore; input: Record<string, unknown>; actorId: string },
  _options = {},
): Promise<EmailTemplateDetail> {
  const name = requireText({ value: input.name, key: "name", max: EMAIL_TEMPLATE_NAME_MAX });
  const html = optionalString({ value: input.html, key: "html" });
  const subject = optionalString({ value: input.subject, key: "subject" }) ?? name;
  const seed = html ?? emailTemplateSkeleton({ subject, fields: readFieldsInput({ value: input.fields }) });
  return toDetail(await store.create({ name, seedHtml: seed, actorId }));
}

/**
 * Replaces a template's whole HTML through the store's compare-and-set write.
 * @param required.input - `{ id, html, expectedVersion? }`; a stated `expectedVersion` must be the
 *   version the write is actually conditioned on, or nothing is written.
 * @throws {EmailTemplateNotFoundError} When `id` is not a live template.
 * @throws {EmailTemplateVersionConflictError} On a stale `expectedVersion` or a concurrent write.
 */
export async function editEmailTemplate(
  { store, input, actorId }: { store: EmailTemplateStore; input: Record<string, unknown>; actorId: string },
  _options = {},
): Promise<EmailTemplateDetail> {
  const id = requireText({ value: input.id, key: "id", max: EMAIL_TEMPLATE_NAME_MAX });
  const html = requireText({ value: input.html, key: "html", max: Number.MAX_SAFE_INTEGER });
  const expectedVersion = readExpectedVersion({ value: input.expectedVersion });
  await loadTemplate({ store: store, id: id });
  const session = await store.openHtml({ id, actorId });
  const basis = session.version;
  if (expectedVersion !== undefined && expectedVersion !== basis) {
    throw new EmailTemplateVersionConflictError(`email template '${id}' is at version ${basis}, not ${expectedVersion} — re-read it and retry`);
  }
  if (!(await session.write({ html }))) throw new EmailTemplateVersionConflictError(`email template '${id}' was edited elsewhere — re-read it and retry`);
  return toDetail(await loadTemplate({ store: store, id: id }));
}

/**
 * Renames a template: only its name changes, through the store's compare-and-set rename, so the
 * HTML body and its revision history are untouched.
 * @param required.input - `{ id, name, expectedVersion? }`.
 * @throws {EmailTemplateNotFoundError} When `id` is not a live template.
 * @throws {EmailTemplateVersionConflictError} On a stale `expectedVersion` or a concurrent write.
 */
export async function renameEmailTemplate(
  { store, input }: { store: EmailTemplateStore; input: Record<string, unknown> },
  _options = {},
): Promise<EmailTemplateDetail> {
  const id = requireText({ value: input.id, key: "id", max: EMAIL_TEMPLATE_NAME_MAX });
  const name = requireText({ value: input.name, key: "name", max: EMAIL_TEMPLATE_NAME_MAX });
  const expectedVersion = readExpectedVersion({ value: input.expectedVersion });
  const record = await loadTemplate({ store: store, id: id });
  if (expectedVersion !== undefined && expectedVersion !== record.version) {
    throw new EmailTemplateVersionConflictError(`email template '${id}' is at version ${record.version}, not ${expectedVersion} — re-read it and retry`);
  }
  if (!(await store.rename({ id, name, ifVersion: record.version }))) throw new EmailTemplateVersionConflictError(`email template '${id}' was edited elsewhere — re-read it and retry`);
  return toDetail(await loadTemplate({ store: store, id: id }));
}

/** Every live template, most recently updated first. */
export async function listEmailTemplates({ store, input = {} }: { store: EmailTemplateStore; input?: { limit?: unknown; cursor?: unknown } }, _options = {}): Promise<{ templates: EmailTemplateSummary[]; nextCursor?: string }> {
  const limit = templatePageLimit({ value: input.limit });
  const before = readTemplateCursor({ value: input.cursor });
  const rows = await store.listPage({ limit: limit + 1, ...(before ? { before } : {}) });
  const page = rows.slice(0, limit).filter((row): row is EmailTemplateRecord => row !== null);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt, id: last.id })).toString("base64url") : undefined;
  return { templates: page.map(row => toSummary(row)), ...(nextCursor ? { nextCursor } : {}) };
}

/** Bounded list size, shared by the route and tool inputs. */
function templatePageLimit({ value }: { value: unknown }, _options = {}): number {
  const limit = value === undefined ? 25 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new EmailTemplateInputError("limit must be a whole number from 1 to 100.");
  return limit;
}

/** Only a timestamp/id pair from this list is accepted as a continuation. */
function readTemplateCursor({ value }: { value: unknown }, _options = {}): { updatedAt: string; id: string } | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString()) as { updatedAt?: unknown; id?: unknown };
    if (typeof parsed.updatedAt === "string" && typeof parsed.id === "string") return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch { /* The same typed refusal covers malformed and structurally invalid tokens. */ }
  throw new EmailTemplateInputError("cursor must be a nextCursor returned by email_template_list.");
}

/** One template with its HTML; `version` is the basis an edit states back as `expectedVersion`. */
export async function getEmailTemplate({ store, id }: { store: EmailTemplateStore; id: string }, _options = {}): Promise<EmailTemplateDetail> {
  return toDetail(await loadTemplate({ store: store, id: id }));
}

/** The HTML a preview renders: a saved template's, or unsaved HTML straight from the editor. */
async function previewSource({ store, input }: { store: EmailTemplateStore; input: Record<string, unknown> }, _options = {}): Promise<string> {
  if (input.html !== undefined) return requireText({ value: input.html, key: "html", max: Number.MAX_SAFE_INTEGER });
  return (await loadTemplate({ store: store, id: requireText({ value: input.id, key: "id", max: EMAIL_TEMPLATE_NAME_MAX }) })).html;
}

function readMode({ value }: { value: unknown }, _options = {}): "admin" | "sent" {
  if (value === undefined || value === "admin") return "admin";
  if (value === "sent") return "sent";
  throw new EmailTemplateInputError('mode must be "admin" or "sent".');
}

/**
 * Renders a template with `{{field}}` values for the live preview. `"admin"` mode fills declared
 * samples for missing values and keeps scripts (the host's preview iframe sandboxes them);
 * `"sent"` mode is exactly {@link renderEmailTemplateForSend}'s output, samples unused.
 * @param required.input - `{ id } | { html }`, plus `values?` and `mode?`.
 */
export async function previewEmailTemplate(
  { store, input }: { store: EmailTemplateStore; input: Record<string, unknown> },
  _options = {},
): Promise<EmailTemplatePreview> {
  const mode = readMode({ value: input.mode });
  const values = readFieldValues({ value: input.values });
  const html = await previewSource({ store, input });
  const undeclaredFields = undeclaredFieldsIn({ html, declarations: readTemplateDeclarations({ html }) });
  if (mode === "sent") {
    const sent = renderEmailForSend({ html, values });
    return { ...sent, undeclaredFields, mode, scriptsStripped: true };
  }
  // Scripts are kept: the host shows this preview in a preview iframe sandboxed without
  // `allow-same-origin`, so they run in an opaque origin; `scriptsStripped: false` says so.
  return { ...renderEmailPreview({ html, values }), undeclaredFields, mode, scriptsStripped: false };
}

/**
 * The send-path operation: a saved template + values -> the `subject`/`html`/`text` an outbound
 * email carries (static HTML; see `renderEmailForSend`). It sends nothing; a mail send path
 * spreads the result into its message alongside `to`/`from`.
 * @param required.values - Field values; a field with none renders empty and is listed in `missingFields`.
 */
export async function renderEmailTemplateForSend(
  { store, id, values }: { store: EmailTemplateStore; id: string; values: EmailFieldValues },
  _options = {},
): Promise<SendableEmail> {
  return renderEmailForSend({ html: (await loadTemplate({ store: store, id: id })).html, values });
}
