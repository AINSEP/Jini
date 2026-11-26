import fs from "node:fs";
import path from "node:path";
import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";

/**
 * @file What an imported archive may leave switched ON. Imported themes and HTML pages count as
 * code, so they stay installed and a person turns them on. Never a refusal: an owner's own exported
 * site still imports whole.
 *
 * Themes are judged by byte identity with this site's own copy. Pages keep their look when the shared page
 * sanitizer's allow-list would leave them untouched, since most real HTML pages hold no code.
 */

const LIVE_THEME_FILE = /^themes\/((?:static|declarative)\/([^/]+))\/(.+)$/;
/** Outside the page sanitizer's allow-list but plain text styling. The generated privacy page uses it. */
const INERT_DROPS: ReadonlySet<string> = new Set(["mark"]);
const MAX_PAGE_NOTICES = 20;
const MAX_NOTICE_TITLE = 80;

/** One stored row's value the scans read; the host's column names stay behind {@link KeepOffStore}. */
type RowId = string | number;

/**
 * The imported database as the host stores it: the few reads and writes this step makes, with the
 * host's tables and columns behind them. `close` releases the connection and is always called.
 */
export interface KeepOffStore {
  /** The active theme id of every workspace's presentation settings. */
  activeThemeIds(): Promise<string[]>;
  /** Moves every workspace whose active theme is `from` onto `to`. */
  reassignActiveTheme(required: { from: string; to: string }): Promise<void>;
  /** Published pages whose body is HTML. */
  publishedHtmlPages(): Promise<{ id: RowId; title: unknown; bodyHtml: string | null }[]>;
  draftPage(required: { id: RowId }): Promise<void>;
  menus(): Promise<{ id: RowId; title: unknown; docJson: string }[]>;
  setMenuDoc(required: { id: RowId; docJson: string }): Promise<void>;
  forms(): Promise<{ id: RowId; name: unknown; fieldsJson: string }[]>;
  disableForm(required: { id: RowId }): Promise<void>;
  close(): Promise<void>;
}

/** The host's plain-word notice for each thing this step keeps off; every member is REQUIRED. */
export interface KeepOffNotices {
  setAside(required: { fallback: string }): string;
  themeKeptOff(required: { themeId: string }): string;
  pageDrafted(required: { title: string }): string;
  morePagesDrafted: {
    singular(required: { count: number }): string;
    plural(required: { count: number }): string;
  };
  menuKeptOff(required: { title: string; id: RowId }): string;
  moreMenusKeptOff(required: { count: number }): string;
  formDisabled(required: { name: string; id: RowId }): string;
  moreFormsDisabled(required: { count: number }): string;
}

/** What the host owns: the page sanitizer whose allow-list decides "code", the no-theme id and the notice copy. */
export interface KeepOffHost {
  /** Runs the shared page sanitizer, reporting every element/attribute it would drop. */
  sanitizePageHtml(required: { html: string }, optional: { reportDrops: (report: { dropped: Readonly<Record<string, unknown>> }) => void }): unknown;
  /** The theme id meaning "no theme"; it is never moved. */
  readonly noThemeId: string;
  readonly notices: KeepOffNotices;
}
type Ctx = { store: KeepOffStore; host: KeepOffHost };

/**
 * Ids of live theme trees that are not byte-identical to the copy this new site already holds.
 * Must run before restore replaces those trees.
 * @complexity O(staged theme files + their bytes), bounded by the 300 MiB import cap.
 */
export function unrecognisedThemes(required: { root: string; dir: string; files: readonly string[]; liveThemes: ReadonlySet<string> }): Set<string> {
  const unrecognised = new Set<string>();
  for (const file of required.files) {
    const match = LIVE_THEME_FILE.exec(file);
    if (!match || !required.liveThemes.has(match[1]!) || unrecognised.has(match[2]!)) continue;
    if (!sameBytes({ left: path.join(required.root, file), right: path.join(required.dir, file) })) unrecognised.add(match[2]!);
  }
  return unrecognised;
}

function sameBytes({ left, right }: { left: string; right: string }, _optional: Record<string, never> = {}): boolean {
  return fs.existsSync(right) && fs.readFileSync(left).equals(fs.readFileSync(right));
}

/**
 * Whether a page body counts as code: `true` unless the allow-list keeps every element and
 * attribute and no attribute value holds markup or an escape.
 * @complexity O(html length).
 */
export function pageBodyMayRunScript(required: { html: string; host: KeepOffHost }): boolean {
  let dropped = false;
  required.host.sanitizePageHtml({ html: required.html }, { reportDrops: ({ dropped: drops }) => { dropped ||= Object.keys(drops).some(drop => !INERT_DROPS.has(drop)); } });
  return dropped || attributeHoldsMarkup(parseFragment(required.html));
}

/** Native form grouping and input hints are inert; check behavior without changing stored HTML. */
function formBodyMayRunScript(required: { html: string; host: KeepOffHost }, _optional = {}): boolean {
  const root = parseFragment(required.html);
  const pending = root.childNodes.map(node => ({ node, depth: 0 }));
  const tags = new Set(["fieldset", "legend", "optgroup"]);
  const attrs = new Set(["maxlength", "pattern", "accept", "inputmode", "spellcheck", "autocapitalize", "readonly", "label"]);
  while (pending.length) {
    const next = pending.pop();
    if (next === undefined) throw new Error("Imported markup scan has no pending node");
    const { node, depth } = next;
    if (!("tagName" in node)) continue;
    if (depth >= 128) return true;
    stripInertFormHints(node, tags, attrs);
    pending.push(...[...node.childNodes, ...("content" in node ? node.content.childNodes : [])].map(node => ({ node, depth: depth + 1 })));
  }
  return pageBodyMayRunScript({ html: serialize(root), host: required.host });
}

function stripInertFormHints(node: DefaultTreeAdapterMap["element"], tags: ReadonlySet<string>, attrs: ReadonlySet<string>): void {
  if (node.namespaceURI === "http://www.w3.org/1999/xhtml") {
    // Keep option grouping valid inside select so reparsing preserves its attributes.
    if (tags.has(node.tagName)) node.tagName = node.nodeName = node.tagName === "optgroup" ? "option" : "div";
    node.attrs = node.attrs.filter(attr => attr.namespace || attr.prefix || !attrs.has(attr.name));
  }
}

function attributeHoldsMarkup(root: DefaultTreeAdapterMap["documentFragment"]): boolean {
  // Depth is bounded by the sanitizer above: anything deeper than its limit counts as a drop.
  const pending: DefaultTreeAdapterMap["childNode"][] = [...root.childNodes];
  while (pending.length) {
    const node = pending.pop();
    if (node === undefined) throw new Error("Imported attribute scan has no pending node");
    if (!("tagName" in node)) continue;
    if (node.attrs.some(attr => /[<>\\]/.test(attr.value))) return true;
    pending.push(...node.childNodes, ...("content" in node ? node.content.childNodes : []));
  }
  return false;
}

/**
 * Leaves an active theme on only when it is this site's own, and moves every other one to the
 * fallback, which the archive can never replace.
 * @returns One notice per imported theme that was active.
 * @complexity O(workspaces), one update per changed row.
 */
async function keepThemesOff(required: Ctx & { fallback: string; liveThemeIds: ReadonlySet<string>; unrecognised: ReadonlySet<string> }): Promise<string[]> {
  const { store, host, fallback, liveThemeIds, unrecognised } = required;
  const notices = new Set<string>();
  for (const active of await store.activeThemeIds()) {
    const own = active === fallback || liveThemeIds.has(active);
    if (active === host.noThemeId || (own && !unrecognised.has(active))) continue;
    if (unrecognised.has(active)) notices.add(host.notices.themeKeptOff({ themeId: active }));
    await store.reassignActiveTheme({ from: active, to: fallback });
  }
  return [...notices];
}

/**
 * Turns every published HTML page that could run script into a draft.
 * @returns At most {@link MAX_PAGE_NOTICES} page notices plus one summary line.
 * @complexity O(published HTML pages + their bytes) once per import; one update per kept-off page.
 */
async function keepPagesOff(required: Ctx): Promise<string[]> {
  const { store, host } = required;
  const kept = (await store.publishedHtmlPages()).filter(page => pageBodyMayRunScript({ html: page.bodyHtml ?? "", host }));
  for (const page of kept) await store.draftPage({ id: page.id });
  const notices = kept.slice(0, MAX_PAGE_NOTICES).map(page => host.notices.pageDrafted({ title: String(page.title).slice(0, MAX_NOTICE_TITLE) }));
  const more = kept.length - MAX_PAGE_NOTICES;
  const morePagesDrafted = more === 1 ? host.notices.morePagesDrafted.singular : host.notices.morePagesDrafted.plural;
  return more > 0 ? [...notices, morePagesDrafted({ count: more })] : notices;
}

/**
 * Restore's one step that decides what stays on in the new database.
 * @returns Notices for the person importing, in plain words.
 * @throws Whatever the database throws; the caller's restore then fails and cleans up.
 */
export async function keepImportedCodeOff(required: { dbPath: string; fallback: string; liveThemes: ReadonlySet<string>; unrecognised: ReadonlySet<string>; setAside: boolean; openStore: (required: { filePath: string }) => KeepOffStore; host: KeepOffHost }): Promise<string[]> {
  const store = required.openStore({ filePath: required.dbPath });
  const { host } = required;
  const ctx = { store, host };
  try {
    const liveThemeIds = new Set([...required.liveThemes].flatMap(id => {
      if (id.startsWith("__")) return [];
      const name = id.split("/").at(-1);
      if (name === undefined) throw new Error("Imported live theme has no ID");
      return [name];
    }));
    const setAside = required.setAside ? [host.notices.setAside({ fallback: required.fallback })] : [];
    return [...setAside, ...await keepThemesOff({ ...ctx, fallback: required.fallback, liveThemeIds, unrecognised: required.unrecognised }), ...await keepPagesOff(ctx), ...await keepMenusOff(ctx), ...await keepFormsOff(ctx)];
  } finally { await store.close(); }
}

/**
 * Switches every HTML-mode menu that could run script back to items mode.
 * @returns At most {@link MAX_PAGE_NOTICES} menu notices plus one summary line.
 * @complexity O(menus + their bytes) once per import; one update per kept-off menu.
 */
async function keepMenusOff(required: Ctx, _optional = {}): Promise<string[]> {
  const { store, host } = required;
  const menuNotices: string[] = [];
  for (const menu of await store.menus()) {
    let doc: { mode?: unknown; html?: unknown } | null;
    try { doc = JSON.parse(menu.docJson); } catch { continue; }
    if (!doc || doc.mode !== "html" || typeof doc.html !== "string" || !pageBodyMayRunScript({ html: doc.html, host })) continue;
    // Draft menus still resolve at markers; items mode keeps the original HTML without serving it.
    await store.setMenuDoc({ id: menu.id, docJson: JSON.stringify({ ...doc, mode: "items" }) });
    menuNotices.push(host.notices.menuKeptOff({ title: String(menu.title).slice(0, MAX_NOTICE_TITLE), id: menu.id }));
  }
  const moreMenus = menuNotices.length - MAX_PAGE_NOTICES;
  const notices = menuNotices.slice(0, MAX_PAGE_NOTICES);
  if (moreMenus > 0) notices.push(host.notices.moreMenusKeptOff({ count: moreMenus }));
  return notices;
}

/**
 * Disables every HTML-mode form that could run script.
 * @returns At most {@link MAX_PAGE_NOTICES} form notices plus one summary line.
 * @complexity O(forms + their bytes) once per import; one update per kept-off form.
 */
async function keepFormsOff(required: Ctx, _optional = {}): Promise<string[]> {
  const { store, host } = required;
  const formNotices: string[] = [];
  for (const form of await store.forms()) {
    let fields: { mode?: unknown; html?: unknown } | null;
    try { fields = JSON.parse(form.fieldsJson); } catch { continue; }
    if (!fields || fields.mode !== "html" || typeof fields.html !== "string" || !formBodyMayRunScript({ html: fields.html, host })) continue;
    // Disabled forms do not resolve at markers; keep the authored envelope byte-for-byte.
    await store.disableForm({ id: form.id });
    formNotices.push(host.notices.formDisabled({ name: String(form.name).slice(0, MAX_NOTICE_TITLE), id: form.id }));
  }
  const moreForms = formNotices.length - MAX_PAGE_NOTICES;
  const notices = formNotices.slice(0, MAX_PAGE_NOTICES);
  if (moreForms > 0) notices.push(host.notices.moreFormsDisabled({ count: moreForms }));
  return notices;
}
