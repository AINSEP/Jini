import type { ComponentType } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { ContentTypeFieldKind } from "@jini-ai/core/contracts/content-types";
import type { QueryKey } from "@jini-ai/core/fetch";
import type { WidgetTypeKey as AdminWidgetType } from "../../../widgets/types.js";
import { type Translate, interpolate, isAbortError } from "@jini-ai/core/text";
import type { trimChars } from "@jini-ai/core/primitives";

import { CollectionSelect, SortSelect, FieldsCheckboxes, FilterRow, findContentType, maybeAgentHandle, type DisplayableField } from "./WidgetConfigFields.controls.js";

type CollectionOption = { key: string; label: string; fields: { name: string; kind: ContentTypeFieldKind }[] };
type MenuOption = { id: string; title: string; status: string };
type FormOption = { id: string; name: string; status: string };

export interface WidgetConfigFieldsProps {
  widgetType: AdminWidgetType;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  agentHandle?: string | undefined;
  t: Translate;
  MediaContentEditor: ComponentType<{ widgetType: "media" | "gallery"; config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void; agentHandle?: string | undefined; t: Translate }>;
  port: { listCollections(): Promise<CollectionOption[]>; listMenus(): Promise<MenuOption[]>; listForms(): Promise<FormOption[]> };
  useFetchedOptionsHook: <T>(required: { fetchList: () => Promise<T[]>; key: QueryKey; isAbortError: typeof isAbortError }, optional: { errorFallback: string }) => { items: T[] | null; error: string | null };
  useRecentEntriesConfigHook: (required: Pick<WidgetConfigFieldsProps, "config" | "onChange">, optional?: Record<string, never>) => {
    collection: string; sort: string; layout: string; columns: number | ""; fields: string[]; filterField: string; filterValue: string;
    setCollection(required: { value: string }): void;
    setSort(required: { value: string }): void;
    setLayout(required: { value: string }): void;
    setColumns(required: { value: string }): void;
    toggleField(required: { name: string; checked: boolean }): void;
    setFilterField(required: { name: string }): void;
    setFilterValue(required: { raw: string; kind: ContentTypeFieldKind | undefined }): void;
  };
  useSocialLinksConfigHook: (required: Pick<WidgetConfigFieldsProps, "config" | "onChange">, optional?: Record<string, never>) => {
    links: { platform: string; url: string }[];
    updateLink(required: { index: number; patch: Partial<{ platform: string; url: string }> }): void;
    removeLink(required: { index: number }): void;
    addLink(): void;
  };
  rules: {
    COLLECTION_DISPLAYABLE_FIELD_KINDS: ReadonlySet<ContentTypeFieldKind>;
    humanizeFieldName(required: { name: string }, optional?: Record<string, never>): string;
    asciiSlug(required: { text: string; trimChars: typeof trimChars }, optional?: Record<string, never>): string;
  };
}

/**
 * @file Per-widget-type config sub-forms (`ui.spec.md` §2/§3.4) — one component per v1 widget type,
 * field sets read directly off `src/widgets/registry.ts`'s five `configSchema` records (no field
 * here is invented). Shared between `WidgetInstanceEditor.tsx` (full create/edit form) and
 * `WidgetPickerDialog.tsx` (the "create new" path of the reuse-vs-duplicate picker, REQ-33) so the
 * config-editing UI is defined once, not duplicated per call site.
 *
 * Client-side constraints here (maxItems range, links cap) are UX guidance only — the real
 * validator is server-side (REQ-02); a `WidgetConfigValidationError` must still be handled by the
 * caller even when these constraints appear satisfied (`ui.spec.md` §5/§8).
 *
 * Split into this file (the JSX per widget type) and `WidgetConfigFields.hooks.tsx` (the
 * data-fetching state `MenuConfigFields`/`ContactFormConfigFields` need), per the `@jini-ai/admin`
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern. Unlike `Select`/`WidgetPickerDialog`, there is
 * no single hook this whole exported `WidgetConfigFields` switch renders off of — it dispatches to
 * five independent, unexported per-type sub-components, and only two of them (`MenuConfigFields`,
 * `ContactFormConfigFields`) touch IO at all. The `useFetchedOptions` seam below is threaded through
 * `WidgetConfigFields`'s own props down to those two sub-components (the same
 * `{ useFetchedOptions: useOptions = useFetchedOptions, ...props }` destructure-and-rename shape
 * `RowMenu.tsx` uses for its own `useRowMenu` prop in `@jini-ai/admin`) rather than living on a
 * component-level hook the way `Select`'s `useDropdown`/`WidgetPickerDialog`'s `useDialog` do.
 *
 * The two `fetchList` closures passed into `useFetchedOptions` read through
 * `widget-config-fields-dependencies.hooks.ts`'s `defaultWidgetConfigFieldsPort` rather than
 * `lib/api`'s `api` directly — that file is the only one in this folder that imports `api`. This
 * is a second, NESTED seam underneath the already-reachable `useFetchedOptions` prop (not a new
 * component prop of its own): a test overriding `useFetchedOptions` with a fake never calls the
 * closure at all, so the port is exercised only on the real path, the same "one seam per reachable
 * boundary" reasoning `apps/admin/INFO.md`'s Components section gives for not double-injecting
 * `useWidgetPickerDialog`'s inner `useExistingInstances`.
 *
 * ## Agent handles
 *
 * `WidgetConfigFields` itself renders exactly one of the five sub-forms below (never more than
 * one), so its own `agentHandle` prop is just forwarded to whichever type is active — the field
 * names below are then each type's own, appended as `<base>-<field>`:
 *
 * | widget type | fields |
 * |---|---|
 * | `text` | `<base>-body` |
 * | `social-links` | per row `i` (0-based): `<base>-link-<i>-platform`, `<base>-link-<i>-url`, `<base>-link-<i>-remove`; plus `<base>-add` |
 * | `recent-entries` (labeled "Collection list") | `<base>-max-items`, `<base>-collection`, `<base>-sort`, `<base>-layout`, `<base>-columns` (cards layout only), `<base>-field-<fieldName>` per checkbox, `<base>-filter-field`, `<base>-filter-value` (filter row, shown only once a collection is chosen), `<base>-category-term-id` |
 * | `menu` | `<base>-menu-ref` (a real `<select>` — `page.select_option` resolves it) |
 * | `contact-form` | `<base>-form-definition-id` (a real `<select>`), `<base>-success-message` |
 * | `media` / `gallery` | see `MediaContentEditor.tsx`'s own "Agent handles" section |
 *
 * `social-links` rows are keyed by array INDEX, not a stable id — the one deliberate exception to
 * this workspace's "never an index" list-handle rule (see `@jini-ai/agentic`'s
 * `buildAgentListHandles`). `SocialLink` (`{ platform, url }`) carries no id of its own in the
 * widget's own `configSchema` (`src/widgets/registry.ts`), and inventing one here would mean
 * changing a schema this component does not own, for a value that is re-fetched fresh on every
 * page load anyway — removing a link DOES shift every later row's handle down by one for the rest
 * of THIS editing session, a real but narrow tradeoff against redesigning a persisted schema this
 * component only renders. Every other row/list handle in this app keeps the stable-id rule.
 * `agentHandle` itself is NOT sanitized — the caller's own explicit choice of name, which fails
 * loudly at first render if invalid. Omit it and no `data-agent-*` markup is emitted at all.
 */

function textValue({ config, key }: { config: Record<string, unknown>; key: string }, _options: Record<string, never> = {}): string {
  const v = config[key];
  return typeof v === "string" ? v : "";
}

/** `text` (`src/widgets/registry.ts` TEXT_REGISTRATION: `{ body: string }`). */
function TextConfigFields(props: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  agentHandle?: string | undefined;
  t: Translate;
}) {
  return (
    <div className="widget-config-fields">
      <label htmlFor="widget-field-body">{props.t("Text")}</label>
      <textarea
        id="widget-field-body"
        rows={6}
        value={textValue({ config: props.config, key: "body" })}
        onChange={(e) => props.onChange({ ...props.config, body: e.target.value })}
        {...(props.agentHandle ? agentHandle({ handle: `${props.agentHandle}-body` }, { role: "field", label: "Text" }) : {})}
      />
    </div>
  );
}

/** `social-links` (SOCIAL_LINKS_REGISTRATION: `{ links: [{platform,url}], max 20 }`). */
function SocialLinksConfigFields({ useSocialLinksConfigHook, ...props }: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  agentHandle?: string | undefined;
  t: Translate; useSocialLinksConfigHook: WidgetConfigFieldsProps["useSocialLinksConfigHook"];
}) {
  const { links, updateLink, removeLink, addLink } = useSocialLinksConfigHook({ config: props.config, onChange: props.onChange });
  const base = props.agentHandle;
  const { t } = props;

  return (
    <div className="widget-config-fields">
      <p>{t("Social links")}</p>
      {links.map((link, i) => (
        <fieldset key={i} className="widget-config-social-link-row">
          <legend>{interpolate({ template: t("Link {n}"), vars: { n: i + 1 } })}</legend>
          <label htmlFor={`widget-social-platform-${i}`}>{t("Platform")}</label>
          <input
            id={`widget-social-platform-${i}`}
            value={link.platform}
            onChange={(e) => updateLink({ index: i, patch: { platform: e.target.value } })}
            placeholder={t("e.g. a project link")}
            {...(base ? agentHandle({ handle: `${base}-link-${i}-platform` }, { role: "field", label: `Link ${i + 1} platform` }) : {})}
          />
          <label htmlFor={`widget-social-url-${i}`}>{t("URL")}</label>
          <input
            id={`widget-social-url-${i}`}
            value={link.url}
            onChange={(e) => updateLink({ index: i, patch: { url: e.target.value } })}
            placeholder={t("https://…")}
            {...(base ? agentHandle({ handle: `${base}-link-${i}-url` }, { role: "field", label: `Link ${i + 1} URL` }) : {})}
          />
          <button
            type="button"
            onClick={() => removeLink({ index: i })}
            {...(base ? agentHandle({ handle: `${base}-link-${i}-remove` }, { role: "button", label: `Remove link ${i + 1}` }) : {})}
          >
            {t("Remove")}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={addLink}
        disabled={links.length >= 20}
        {...(base ? agentHandle({ handle: `${base}-add` }, { role: "button", label: "Add a social link" }) : {})}
      >
        {t("Add link")}
      </button>
    </div>
  );
}

type FetchedConfigFieldsProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  agentHandle?: string | undefined;
  t: Translate;
  useRecentEntriesConfigHook: WidgetConfigFieldsProps["useRecentEntriesConfigHook"];
  port: WidgetConfigFieldsProps["port"];
  rules: WidgetConfigFieldsProps["rules"];
} & FetchedOptionsSeam;

/**
 * `recent-entries` (RECENT_ENTRIES_REGISTRATION), labeled "Collection list" in this UI (R1 renamed
 * the widget's behavior, not its type key — `widgetType`/stored config are unaffected). Fetches
 * the content-type registry itself, the same `useFetchedOptions` seam `MenuConfigFields`/
 * `ContactFormConfigFields` use, filtered to `isUserCollection` (system types never appear here —
 * A2's own rule). All config mutation lives in `useRecentEntriesConfig`
 * (`WidgetConfigFields.hooks.tsx`); the Collection/Sort/Fields/Filter controls each live in their
 * own small component above (this function was over the complexity ceiling as one block) — this
 * function only assembles them.
 *
 * "All collections" (an empty `collection`) keeps today's behavior: every user content type,
 * newest-updated first (D7). Fields/Filter are per-content-type, so both are hidden until a
 * specific collection is chosen — there is no single field list to check boxes against otherwise.
 */
function RecentEntriesConfigFields(props: FetchedConfigFieldsProps) {
  const { useFetchedOptionsHook: useOptions, t, useRecentEntriesConfigHook } = props;
  const maxItems = typeof props.config.maxItems === "number" ? props.config.maxItems : 5;
  const base = props.agentHandle;
  const { items: collections, error: collectionsError } = useOptions<CollectionOption>(
    { fetchList: () => props.port.listCollections(), key: ["collections", "options"], isAbortError },
    { errorFallback: t("failed to load collections") },
  );
  const c = useRecentEntriesConfigHook({ config: props.config, onChange: props.onChange });
  const selectedType = findContentType({ collections, key: c.collection });
  const displayableFields = selectedType ? selectedType.fields.filter((f) => props.rules.COLLECTION_DISPLAYABLE_FIELD_KINDS.has(f.kind)) : [];
  const showFieldsAndFilter = selectedType !== null && displayableFields.length > 0;

  return <RecentEntriesConfigControls props={props} t={t} maxItems={maxItems} base={base} collections={collections} collectionsError={collectionsError} c={c} displayableFields={displayableFields} showFieldsAndFilter={showFieldsAndFilter} />;
}

function RecentEntriesConfigControls({ props, t, maxItems, base, collections, collectionsError, c, displayableFields, showFieldsAndFilter }: {
  props: FetchedConfigFieldsProps; t: Translate; maxItems: number; base: string | undefined;
  collections: CollectionOption[] | null; collectionsError: string | null;
  c: ReturnType<WidgetConfigFieldsProps["useRecentEntriesConfigHook"]>;
  displayableFields: DisplayableField[]; showFieldsAndFilter: boolean;
}) {
  return (
    <div className="widget-config-fields">
      <label htmlFor="widget-field-maxItems">{t("Max items")}</label>
      <input
        id="widget-field-maxItems"
        type="number"
        min={1}
        max={20}
        step={1}
        value={maxItems}
        onChange={(e) => props.onChange({ ...props.config, maxItems: e.target.value === "" ? undefined : Number(e.target.value) })}
        {...maybeAgentHandle({ base, suffix: "max-items", opts: { role: "field", label: "Max items" } })}
      />

      <CollectionSelect collections={collections} error={collectionsError} value={c.collection} onChange={(value) => c.setCollection({ value })} base={base} t={t} />

      <SortSelect rules={props.rules} value={c.sort} fields={displayableFields} onChange={(value) => c.setSort({ value })} base={base} t={t} />

      <label htmlFor="widget-field-layout">{t("Layout")}</label>
      <select
        id="widget-field-layout"
        value={c.layout}
        onChange={(e) => c.setLayout({ value: e.target.value })}
        {...maybeAgentHandle({ base, suffix: "layout", opts: { role: "field", label: "Layout" } })}
      >
        <option value="">{t("Default (cards)")}</option>
        <option value="cards">{t("Cards")}</option>
        <option value="list">{t("List")}</option>
      </select>

      {c.layout !== "list" && (
        <>
          <label htmlFor="widget-field-columns">{t("Columns")}</label>
          <input
            id="widget-field-columns"
            type="number"
            min={1}
            max={6}
            step={1}
            value={c.columns}
            onChange={(e) => c.setColumns({ value: e.target.value })}
            {...maybeAgentHandle({ base, suffix: "columns", opts: { role: "field", label: "Columns" } })}
          />
        </>
      )}

      {showFieldsAndFilter && <FieldsCheckboxes rules={props.rules} fields={displayableFields} selected={c.fields} onToggle={(name, checked) => c.toggleField({ name, checked })} base={base} t={t} />}

      {showFieldsAndFilter && (
        <FilterRow rules={props.rules} fields={displayableFields} field={c.filterField} value={c.filterValue} onFieldChange={(name) => c.setFilterField({ name })} onValueChange={(raw, kind) => c.setFilterValue({ raw, kind })} base={base} t={t} />
      )}

      {/* REQ-32/EC-03: a documented soft reference — plain text input, no taxonomy-term picker exists yet in this admin app. */}
      <label htmlFor="widget-field-categoryTermId">{t("Category term id (optional)")}</label>
      <input
        id="widget-field-categoryTermId"
        value={textValue({ config: props.config, key: "categoryTermId" })}
        onChange={(e) => props.onChange({ ...props.config, categoryTermId: e.target.value || undefined })}
        {...maybeAgentHandle({ base, suffix: "category-term-id", opts: { role: "field", label: "Category term id" } })}
      />
    </div>
  );
}

interface FetchedOptionsSeam {
  useFetchedOptionsHook: WidgetConfigFieldsProps["useFetchedOptionsHook"];
}

/** `menu` (MENU_REGISTRATION: `{ menuRef: string }`) — dropdown over `api.listMenus()`, mirrors
 * `Jini packages/admin/src/seo/react/pages/SeoPage.tsx`'s `EntryPicker` exactly. */
function MenuConfigFields({
  useFetchedOptionsHook: useOptions,
  t,
  ...props
}: FetchedConfigFieldsProps) {
  const { items: menus, error } = useOptions<MenuOption>(
    { fetchList: () => props.port.listMenus(), key: ["menus", "options"], isAbortError },
    { errorFallback: t("failed to load menus") },
  );

  if (error) return <div className="notice error">{error}</div>;
  if (!menus) return <div className="notice">{t("Loading menus…")}</div>;

  return (
    <div className="widget-config-fields">
      <label htmlFor="widget-field-menuRef">{t("Menu")}</label>
      <select
        id="widget-field-menuRef"
        value={textValue({ config: props.config, key: "menuRef" })}
        onChange={(e) => props.onChange({ ...props.config, menuRef: e.target.value })}
        {...(props.agentHandle
          ? agentHandle({ handle: `${props.agentHandle}-menu-ref` }, {
              role: "field",
              label: "Menu — set with page.select_option, not click",
            })
          : {})}
      >
        <option value="">{t("Choose a menu…")}</option>
        {menus.map((menu) => (
          <option key={menu.id} value={menu.id}>
            {menu.title} ({menu.status})
          </option>
        ))}
      </select>
    </div>
  );
}

/** `contact-form` (CONTACT_FORM_REGISTRATION: `{ formDefinitionId: string, successMessage? }`) —
 * dropdown over `api.listForms()`; each option discloses `status` inline (REQ-38 — an operator
 * shouldn't be surprised later by the disabled-form placeholder render). */
function ContactFormConfigFields({
  useFetchedOptionsHook: useOptions,
  t,
  ...props
}: FetchedConfigFieldsProps) {
  const { items: forms, error } = useOptions<FormOption>(
    { fetchList: () => props.port.listForms(), key: ["forms", "options"], isAbortError },
    { errorFallback: t("failed to load forms") },
  );

  if (error) return <div className="notice error">{error}</div>;
  if (!forms) return <div className="notice">{t("Loading forms…")}</div>;

  return (
    <div className="widget-config-fields">
      <label htmlFor="widget-field-formDefinitionId">{t("Form")}</label>
      <select
        id="widget-field-formDefinitionId"
        value={textValue({ config: props.config, key: "formDefinitionId" })}
        onChange={(e) => props.onChange({ ...props.config, formDefinitionId: e.target.value })}
        {...(props.agentHandle
          ? agentHandle({ handle: `${props.agentHandle}-form-definition-id` }, {
              role: "field",
              label: "Form — set with page.select_option, not click",
            })
          : {})}
      >
        <option value="">{t("Choose a form…")}</option>
        {forms.map((form) => (
          <option key={form.id} value={form.id}>
            {form.name} — {form.status}
          </option>
        ))}
      </select>
      <label htmlFor="widget-field-successMessage">{t("Success message (optional)")}</label>
      <input
        id="widget-field-successMessage"
        value={textValue({ config: props.config, key: "successMessage" })}
        onChange={(e) => props.onChange({ ...props.config, successMessage: e.target.value || undefined })}
        {...(props.agentHandle
          ? agentHandle({ handle: `${props.agentHandle}-success-message` }, { role: "field", label: "Success message" })
          : {})}
      />
    </div>
  );
}

const FETCHED_CONFIG_EDITORS = {
  "recent-entries": RecentEntriesConfigFields,
  menu: MenuConfigFields,
  "contact-form": ContactFormConfigFields,
} as const;

export function WidgetConfigFields(props: WidgetConfigFieldsProps) {
  const { t, MediaContentEditor } = props;
  switch (props.widgetType) {
    // Gallery is a compatibility alias over the media widget's resolver (mediawidget contract), so
    // both get the same two-tab Media / Raw HTML editor; legacy `images` configs are read in place.
    case "media":
    case "gallery":
      return <MediaContentEditor widgetType={props.widgetType} config={props.config} onChange={props.onChange} t={t} agentHandle={props.agentHandle} />;
    case "text":
      return <TextConfigFields config={props.config} onChange={props.onChange} agentHandle={props.agentHandle} t={t} />;
    case "social-links":
      return <SocialLinksConfigFields useSocialLinksConfigHook={props.useSocialLinksConfigHook} config={props.config} onChange={props.onChange} agentHandle={props.agentHandle} t={t} />;
    case "recent-entries":
    case "menu":
    case "contact-form": {
      const Editor = FETCHED_CONFIG_EDITORS[props.widgetType];
      return <Editor config={props.config} onChange={props.onChange} agentHandle={props.agentHandle} port={props.port} rules={props.rules} useRecentEntriesConfigHook={props.useRecentEntriesConfigHook} useFetchedOptionsHook={props.useFetchedOptionsHook} t={t} />;
    }
    default:
      return null;
  }
}

