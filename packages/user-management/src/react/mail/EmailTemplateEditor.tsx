import { useEffect } from 'react';
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { agentHandle } from '@jini-ai/core/agent-handles';
import type { EmailKit, EmailLoadView, EmailStatusShape, EmailTranslate } from './email-view.types.js';

/**
 * @file One email template's editor page, laid out like the host's page editor (owner, 2026-10-22):
 * back arrow + name, an HTML | Preview tab bar with the device-width buttons, Save below it, then the
 * full-width pane. Same chrome classes as the page editor (`content-editor-*`, `page-editor-toolbar`,
 * `.segmented`, `page-html-source`) and the host's injected device-preview components; the page
 * editor's translator (`copy.pageEditorT`) supplies the shared control words.
 *
 * No Interactive tab on purpose: a visual editor rewrites the HTML on save and can drop the
 * template's field declarations in `<head>`.
 *
 * The preview uses the host's page-preview sandbox (`kit.previewSandbox`: scripts run, but with no
 * same-origin access to the admin). "As sent" shows what a mail client gets — scripts stripped by
 * the server, static HTML.
 */

export type EmailTemplateTab = 'html' | 'preview';
export type EmailPreviewMode = 'admin' | 'sent';

/** Members of the host's template editor controller that this page reads. */
export interface EmailTemplateEditorControl {
  readonly view: EmailLoadView<{ readonly subject: string }>;
  readonly html: string; readonly setHtml: (html: string) => void;
  readonly dirty: boolean;
  readonly values: Readonly<Record<string, string>>; readonly setValue: (field: string, value: string) => void;
  readonly fieldNames: readonly string[];
  readonly mode: EmailPreviewMode; readonly setMode: (mode: EmailPreviewMode) => void;
  readonly preview: {
    readonly data: { readonly subject: string; readonly html: string; readonly missingFields: readonly string[]; readonly undeclaredFields: readonly string[] } | null;
    readonly error: string | null; readonly pending: boolean;
  };
  readonly saving: boolean; readonly saveError: string | null; readonly savedAt: string | null;
  readonly save: () => Promise<void>;
  readonly name: string; readonly setName: (name: string) => void; readonly commitName: () => Promise<void>; readonly renameError: string | null;
}
/** Members of the host's editor view state (tab, device width, measured pane) that this page reads. */
export interface EmailTemplateViewControl<D extends string> {
  readonly tab: EmailTemplateTab; readonly setTab: (tab: EmailTemplateTab) => void;
  readonly device: D; readonly setDevice: (device: D) => void;
  readonly frameRef: (node: HTMLDivElement | null) => void; readonly paneWidth: number;
}

type EditorTab = { id: EmailTemplateTab; label: string };

export interface EmailTemplateEditorKit<D extends string> {
  readonly Icon: ComponentType<{ name: 'arrow-left'; size: number; 'aria-hidden': 'true' }>;
  readonly Chip: EmailKit<EmailStatusShape>['Chip'];
  readonly Loaded: EmailKit<EmailStatusShape>['Loaded'];
  readonly DevicePreviewFrame: ComponentType<{ width: number; frameRef: (node: HTMLDivElement | null) => void; paneWidth: number; children: ReactNode }>;
  readonly DevicePreviewToggle: ComponentType<{ device: D; setDevice: (device: D) => void; t: (key: string) => string; handlePrefix: string }>;
  readonly devicePreviewWidths: Readonly<Record<D, number>>;
  /** The host's page-preview iframe sandbox tokens. */
  readonly previewSandbox: string;
  readonly adminBase: string; readonly adminHref: (required: { routePath: string }) => string;
}
export interface EmailTemplateEditorHooks<C, V> {
  readonly useEditorHook: (required: { id: string }) => C;
  readonly useAdminLocaleHook: () => string;
  readonly useEmailTemplateViewHook: () => V;
  readonly useTabBarKeyboardHook: (required: { tabs: readonly EditorTab[]; activeId: string; onChange: (id: string) => void }) => { onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void };
  readonly useDirtyGuardHook: (required: { current: boolean; original: boolean | null }, optional: { host: Window; translate: (key: string) => string }) => { confirmLeave: () => boolean };
}
export interface EmailTemplateEditorCopy { readonly t: EmailTranslate; readonly pageEditorT: EmailTranslate }

const TABS: ReadonlyArray<EditorTab> = [
  { id: 'html', label: 'HTML' },
  { id: 'preview', label: 'Preview' },
];

type Base = { controller: EmailTemplateEditorControl; locale: string; t: EmailTranslate };

function Fields(props: Base & { Chip: EmailKit<EmailStatusShape>['Chip'] }) {
  const { controller, locale, t, Chip } = props;
  const missing = new Set(controller.preview.data?.missingFields ?? []);
  const undeclared = new Set(controller.preview.data?.undeclaredFields ?? []);
  return (
    <details className="email-template-fields" open>
      <summary className="jini-field-label">{t({ locale, key: 'Fill-in fields (preview values)' })}</summary>
      {controller.fieldNames.length === 0 ? (
        <p className="jini-field-hint">{t({ locale, key: 'No fill-in fields. Add {{name}} to the HTML to make one.' })}</p>
      ) : (
        <div className="email-template-field-list">
          {controller.fieldNames.map((name) => (
            <div key={name} className="jini-field email-field">
              <label className="jini-field-label" htmlFor={`email-template-field-${name}`}>
                <code>{`{{${name}}}`}</code>
                {undeclared.has(name) ? <Chip tone="warning">{t({ locale, key: 'Not declared' })}</Chip> : null}
              </label>
              <input id={`email-template-field-${name}`} className="jini-input" value={controller.values[name] ?? ''} aria-invalid={missing.has(name)}
                onChange={(e) => controller.setValue(name, e.target.value)}
                {...agentHandle({ handle: `email-template-field-${name}` }, { role: 'field', label: `Preview value for ${name}` })} />
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

/** "As sent" sits beside the device buttons as one pressed/unpressed pill (Preview is the tab). */
function AsSentToggle(props: Base) {
  const { controller, locale, t } = props;
  const sent = controller.mode === 'sent';
  return (
    <div className="segmented email-template-as-sent" role="group" aria-label={t({ locale, key: 'Preview mode' })}>
      <button type="button" aria-pressed={sent} className={sent ? 'is-active' : undefined}
        onClick={() => controller.setMode(sent ? 'admin' : 'sent')}
        {...agentHandle({ handle: 'email-template-mode-sent' }, { role: 'button', label: 'Toggle the As sent preview (scripts stripped, what a mail client gets)' })}>
        {t({ locale, key: 'As sent' })}
      </button>
    </div>
  );
}

function Preview<D extends string>(props: Base & { view: EmailTemplateViewControl<D>; kit: EmailTemplateEditorKit<D> }) {
  const { controller, view, locale, t, kit } = props;
  const { data, error, pending } = controller.preview;
  return (
    <div className="email-template-preview">
      <Fields controller={controller} locale={locale} t={t} Chip={kit.Chip} />
      {error ? <p className="jini-field-error" role="alert">{t({ locale, key: error })}</p> : null}
      {controller.mode === 'sent' ? <p className="jini-field-hint">{t({ locale, key: "Mail apps don't run scripts, so they are removed when it sends." })}</p> : null}
      <kit.DevicePreviewFrame width={kit.devicePreviewWidths[view.device]} frameRef={view.frameRef} paneWidth={view.paneWidth}>
        {data ? (
          <iframe
            className="page-preview-iframe"
            title={t({ locale, key: 'Email preview' })}
            sandbox={kit.previewSandbox}
            srcDoc={data.html}
            {...agentHandle({ handle: 'email-template-preview' }, { role: 'region', label: 'Live preview of this email' })}
          />
        ) : (
          <p className="jini-field-hint email-template-empty">{t({ locale, key: pending ? 'Loading…' : 'Write some HTML to see it here.' })}</p>
        )}
      </kit.DevicePreviewFrame>
    </div>
  );
}

/** Back arrow, the template name as the title, and its subject where the page editor shows the slug. */
function Header<D extends string>(props: Base & { kit: EmailTemplateEditorKit<D>; pageT: (key: string) => string }) {
  const { controller, locale, t, kit } = props;
  const subject = controller.preview.data?.subject ?? (controller.view.kind === 'loaded' ? controller.view.data.subject : '');
  return (
    <div className="content-editor-header" {...agentHandle({ handle: 'email-template-header' }, { role: 'region', label: "Editor header — the back link, the template's name and its subject" })}>
      <h1 className="visually-hidden">{t({ locale, key: 'Templates' })}</h1>
      <a
        className="content-editor-back"
        href={kit.adminHref({ routePath: '/email?tab=templates' })}
        aria-label={`${props.pageT('Back')}: ${t({ locale, key: 'Templates' })}`}
        {...agentHandle({ handle: 'email-template-back' }, { role: 'link', label: 'Back to the email templates list' })}
      >
        <kit.Icon name="arrow-left" size={22} aria-hidden="true" />
      </a>
      <label className="visually-hidden" htmlFor="email-template-name">{t({ locale, key: 'Template name' })}</label>
      <input
        id="email-template-name"
        className="editor-title content-editor-title email-template-name"
        value={controller.name}
        maxLength={200}
        disabled={controller.view.kind !== 'loaded'}
        onChange={(e) => controller.setName(e.target.value)}
        onBlur={() => void controller.commitName()}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        {...agentHandle({ handle: 'email-template-name' }, { role: 'field', label: 'Template name' })}
      />
      {subject ? (
        <div className="editor-slug email-template-subject">
          <span>{t({ locale, key: 'Subject' })}</span>
          <span className="email-template-subject-text" title={subject}>{subject}</span>
        </div>
      ) : null}
    </div>
  );
}

type ToolbarProps<D extends string> = Base & {
  view: EmailTemplateViewControl<D>; kit: EmailTemplateEditorKit<D>; pageT: (key: string) => string;
  useTabBarKeyboardHook: EmailTemplateEditorHooks<unknown, unknown>['useTabBarKeyboardHook'];
  resolveTabIndex: (required: { tabs: readonly EditorTab[]; activeId: string; tab: EditorTab }) => number;
};

/** HTML | Preview tabs (the page editor's segmented tablist and keyboard contract), device widths, As sent. */
function Toolbar<D extends string>(props: ToolbarProps<D>) {
  const { controller, view, locale, t, kit, pageT } = props;
  const { onKeyDown } = props.useTabBarKeyboardHook({ tabs: TABS, activeId: view.tab, onChange: (id) => view.setTab(id as EmailTemplateTab) });
  return (
    <div className="page-editor-toolbar">
      <div className="content-editor-toolbar-start">
        <div className="segmented" role="tablist" aria-label={pageT('Editor view')} onKeyDown={onKeyDown}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={view.tab === entry.id}
              className={view.tab === entry.id ? 'is-active' : undefined}
              tabIndex={props.resolveTabIndex({ tabs: TABS, activeId: view.tab, tab: entry })}
              onClick={() => view.setTab(entry.id)}
              {...agentHandle({ handle: `email-template-view-${entry.id}` }, { role: 'button', label: `Switch to the ${entry.label} view` })}
            >
              {pageT(entry.label)}
            </button>
          ))}
        </div>
        {view.tab === 'preview' ? (
          <>
            <kit.DevicePreviewToggle device={view.device} setDevice={view.setDevice} t={pageT} handlePrefix="email-template-preview-width" />
            <AsSentToggle controller={controller} locale={locale} t={t} />
          </>
        ) : null}
      </div>
      {controller.preview.pending && view.tab === 'preview' ? <span className="jini-field-hint" role="status">{t({ locale, key: 'Updating…' })}</span> : null}
    </div>
  );
}

/** Save and its state word, in the row under the toolbar like the page editor's action row. */
function Actions(props: Base) {
  const { controller, locale, t } = props;
  const status = editorStatus(controller);
  return (
    <div className="editor-action-row content-action-row" {...agentHandle({ handle: 'email-template-actions' }, { role: 'region', label: 'Save and its status' })}>
      <div className="content-action-group">
        <button type="button" onClick={() => void controller.save()} disabled={!controller.dirty || controller.saving}
          {...agentHandle({ handle: 'email-template-save' }, { role: 'button', label: "Save this template's HTML" })}>
          {t({ locale, key: 'Save' })}
        </button>
      </div>
      {status ? <span className={status === 'Saved' ? 'save-ok' : 'jini-field-hint'} role="status">{t({ locale, key: status })}</span> : null}
    </div>
  );
}

/** Whether an anchor replaces this editor through the host's SPA. Pure; other windows stay usable. */
function leavesEditor({ anchor, location, adminBase }: { anchor: HTMLAnchorElement | null; location: Location; adminBase: string }, _options = {}): boolean {
  if (!replacesCurrentWindow(anchor)) return false;
  const url = new URL(anchor.href, location.href);
  const adminPath = url.pathname === adminBase || url.pathname.startsWith(`${adminBase}/`);
  const routeChanged = url.pathname !== location.pathname || url.search !== location.search;
  return url.origin === location.origin && adminPath && routeChanged;
}

/** Downloads and explicitly separate browsing contexts leave the working copy open. */
function replacesCurrentWindow(anchor: HTMLAnchorElement | null): anchor is HTMLAnchorElement {
  if (!anchor || anchor.hasAttribute('download')) return false;
  return !anchor.target || anchor.target === '_self';
}

/** Only a plain click replaces this tab; modified clicks leave its working copy alive. */
function isPlainNavigationClick({ event }: { event: MouseEvent }, _options = {}): boolean {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  return event.button === 0 && !event.defaultPrevented && !modified;
}

type EditorKeysRequired = {
  controller: EmailTemplateEditorControl; locale: string; t: EmailTranslate; adminBase: string;
  useDirtyGuardHook: EmailTemplateEditorHooks<unknown, unknown>['useDirtyGuardHook'];
};

/** Reuse the host's dirty guard for unload and in-app links; also save on Cmd/Ctrl+S. Removes all listeners. */
function useEditorKeys(
  { controller, locale, t, adminBase, useDirtyGuardHook }: EditorKeysRequired,
  { host = window, documentHost = document }: { host?: Window; documentHost?: Document } = {},
): void {
  const { dirty, save } = controller;
  const { confirmLeave } = useDirtyGuardHook(
    { current: dirty, original: controller.view.kind === 'loaded' ? false : null },
    { host, translate: (key) => t({ locale, key }) },
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    host.addEventListener('keydown', onKey);
    return () => host.removeEventListener('keydown', onKey);
  }, [host, save]);
  useEffect(() => {
    const onNavigate = (event: MouseEvent) => {
      if (!isPlainNavigationClick({ event })) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!leavesEditor({ anchor, location: host.location, adminBase })) return;
      if (confirmLeave()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // MOVE: Capture covers sidebar anchors outside this page before the shared SPA interceptor.
    documentHost.addEventListener('click', onNavigate, true);
    return () => documentHost.removeEventListener('click', onNavigate, true);
  }, [confirmLeave, host, documentHost, adminBase]);
}

/** The save-state word beside the Save button, or null before any edit. Pure. */
export function editorStatus(controller: Pick<EmailTemplateEditorControl, 'saving' | 'dirty' | 'savedAt'>): string | null {
  if (controller.saving) return 'Saving…';
  if (controller.dirty) return 'Unsaved changes';
  return controller.savedAt ? 'Saved' : null;
}

export interface EmailTemplateEditorProps<D extends string, C extends EmailTemplateEditorControl, V extends EmailTemplateViewControl<D>> {
  readonly id: string; readonly locale?: string | undefined;
  readonly hooks: EmailTemplateEditorHooks<C, V>; readonly kit: EmailTemplateEditorKit<D>;
  readonly copy: EmailTemplateEditorCopy;
  readonly resolveTabIndex: (required: { tabs: readonly EditorTab[]; activeId: string; tab: EditorTab }) => number;
}

/** The editor page. Every hook, component and dictionary is the host's, injected through props. */
export function EmailTemplateEditor<D extends string, C extends EmailTemplateEditorControl, V extends EmailTemplateViewControl<D>>(props: EmailTemplateEditorProps<D, C, V>) {
  const { hooks, kit, copy } = props;
  const controller = hooks.useEditorHook({ id: props.id });
  const adminLocale = hooks.useAdminLocaleHook();
  const locale = props.locale ?? adminLocale;
  const view = hooks.useEmailTemplateViewHook();
  const t = copy.t;
  useEditorKeys({ controller, locale, t, adminBase: kit.adminBase, useDirtyGuardHook: hooks.useDirtyGuardHook });
  const pageT = (key: string) => copy.pageEditorT({ locale, key });
  const base = { controller, locale, t };
  return (
    <div className="page content-editor-page email-template-page">
      <Header {...base} kit={kit} pageT={pageT} />
      {controller.renameError ? <p className="jini-field-error" role="alert">{t({ locale, key: controller.renameError })}</p> : null}
      {controller.saveError ? <div className="notice error" role="alert">{t({ locale, key: controller.saveError })}</div> : null}
      <kit.Loaded view={controller.view} locale={locale}>
        {() => (
          <>
            <Toolbar {...base} view={view} kit={kit} pageT={pageT} useTabBarKeyboardHook={hooks.useTabBarKeyboardHook} resolveTabIndex={props.resolveTabIndex} />
            <Actions {...base} />
            {view.tab === 'html' ? (
              <textarea
                className="page-html-source email-template-source"
                value={controller.html}
                onChange={(e) => controller.setHtml(e.target.value)}
                spellCheck={false}
                aria-label={t({ locale, key: 'Template HTML' })}
                placeholder={t({ locale, key: "Write the email's HTML, or ask the assistant to." })}
                {...agentHandle({ handle: 'email-template-html' }, { role: 'field', label: "This email template's raw HTML" })}
              />
            ) : (
              <Preview {...base} view={view} kit={kit} />
            )}
          </>
        )}
      </kit.Loaded>
    </div>
  );
}
