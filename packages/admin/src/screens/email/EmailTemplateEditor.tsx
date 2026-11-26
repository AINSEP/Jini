import { useEffect } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { ComponentType } from "react";
import type { useDirtyGuard, useTabBarKeyboard, AdminKitValues } from "../../react/kit.js";

import { DEVICE_PREVIEW_WIDTHS } from "../../shell/components/DevicePreview/DevicePreview.hooks.js";
import { DevicePreviewFrame } from "../../shell/components/DevicePreview/DevicePreviewFrame.js";
import { DevicePreviewToggle } from "../../shell/components/DevicePreview/DevicePreviewToggle.js";
import { ADMIN_BASE, adminHref } from "../../shell/lib/router.js";
import { PAGE_PREVIEW_IFRAME_SANDBOX } from "../../pages/page-editor-rules.js";
import { t } from "./email-i18n.js";
import { Chip, Loaded } from "./EmailParts.js";
import type { EmailTemplateEditorController } from "./hooks/use-email-template-editor.hooks.js";
import type { useEmailTemplateView, EmailTemplateTab, EmailTemplateViewState } from "./hooks/use-email-template-view.hooks.js";
import "./email.css";

/**
 * @file One email template's editor page (`/admin/email/templates/:id`), laid out like the Pages
 * editor (owner, 2026-10-22): back arrow + name, an HTML | Preview tab bar with the device-width
 * buttons, Save below it, then the full-width pane. Same chrome classes as `PageEditor.tsx`
 * (`content-editor-*`, `page-editor-toolbar`, `.segmented`, `page-html-source`) and the same shared
 * `DevicePreview*` components; the Pages translator supplies the shared control words.
 *
 * No Interactive tab on purpose: the Pages visual editor rewrites the HTML on save and can drop the
 * template's field declarations in `<head>`.
 *
 * The preview uses the Pages sandbox (`PAGE_PREVIEW_IFRAME_SANDBOX`: scripts run, but with no
 * same-origin access to the admin). "As sent" shows what a mail client gets — scripts stripped by
 * the server, static HTML.
 */

const TABS: ReadonlyArray<{ id: EmailTemplateTab; label: string }> = [
  { id: "html", label: "HTML" },
  { id: "preview", label: "Preview" },
];

function Fields(props: { controller: EmailTemplateEditorController; locale: string }) {
  const { controller, locale } = props;
  const missing = new Set(controller.preview.data?.missingFields ?? []);
  const undeclared = new Set(controller.preview.data?.undeclaredFields ?? []);
  return (
    <details className="email-template-fields" open>
      <summary className="jini-field-label">{t({ locale, key: "Fill-in fields (preview values)" })}</summary>
      {controller.fieldNames.length === 0 ? (
        <p className="jini-field-hint">{t({ locale, key: "No fill-in fields. Add {{name}} to the HTML to make one." })}</p>
      ) : (
        <div className="email-template-field-list">
          {controller.fieldNames.map((name) => (
            <div key={name} className="jini-field email-field">
              <label className="jini-field-label" htmlFor={`email-template-field-${name}`}>
                <code>{`{{${name}}}`}</code>
                {undeclared.has(name) ? <Chip tone="warning">{t({ locale, key: "Not declared" })}</Chip> : null}
              </label>
              <input id={`email-template-field-${name}`} className="jini-input" value={controller.values[name] ?? ""} aria-invalid={missing.has(name)}
                onChange={(e) => controller.setValue(name, e.target.value)}
                {...agentHandle({ handle: `email-template-field-${name}` }, { role: "field", label: `Preview value for ${name}` })} />
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

/** "As sent" sits beside the device buttons as one pressed/unpressed pill (Preview is the tab). */
function AsSentToggle(props: { controller: EmailTemplateEditorController; locale: string }) {
  const { controller, locale } = props;
  const sent = controller.mode === "sent";
  return (
    <div className="segmented email-template-as-sent" role="group" aria-label={t({ locale, key: "Preview mode" })}>
      <button type="button" aria-pressed={sent} className={sent ? "is-active" : undefined}
        onClick={() => controller.setMode(sent ? "admin" : "sent")}
        {...agentHandle({ handle: "email-template-mode-sent" }, { role: "button", label: "Toggle the As sent preview (scripts stripped, what a mail client gets)" })}>
        {t({ locale, key: "As sent" })}
      </button>
    </div>
  );
}

function Preview(props: { controller: EmailTemplateEditorController; view: EmailTemplateViewState; locale: string }) {
  const { controller, view, locale } = props;
  const { data, error, pending } = controller.preview;
  return (
    <div className="email-template-preview">
      <Fields controller={controller} locale={locale} />
      {error ? <p className="jini-field-error" role="alert">{t({ locale, key: error })}</p> : null}
      {controller.mode === "sent" ? <p className="jini-field-hint">{t({ locale, key: "Mail apps don't run scripts, so they are removed when it sends." })}</p> : null}
      <DevicePreviewFrame width={DEVICE_PREVIEW_WIDTHS[view.device]} frameRef={view.frameRef} paneWidth={view.paneWidth}>
        {data ? (
          <iframe
            className="page-preview-iframe"
            title={t({ locale, key: "Email preview" })}
            sandbox={PAGE_PREVIEW_IFRAME_SANDBOX}
            srcDoc={data.html}
            {...agentHandle({ handle: "email-template-preview" }, { role: "region", label: "Live preview of this email" })}
          />
        ) : (
          <p className="jini-field-hint email-template-empty">{t({ locale, key: pending ? "Loading…" : "Write some HTML to see it here." })}</p>
        )}
      </DevicePreviewFrame>
    </div>
  );
}

/** Back arrow, the template name as the title, and its subject where Pages shows the slug. */
function Header(props: { controller: EmailTemplateEditorController; locale: string; pageEditorT: (key: string) => string; kit: Parameters<typeof EmailTemplateEditor>[0]["kit"] }) {
  const { controller, locale, pageEditorT, kit: { Icon } } = props;
  const subject = controller.preview.data?.subject ?? (controller.view.kind === "loaded" ? controller.view.data.subject : "");
  return (
    <div className="content-editor-header" {...agentHandle({ handle: "email-template-header" }, { role: "region", label: "Editor header — the back link, the template's name and its subject" })}>
      <h1 className="visually-hidden">{t({ locale, key: "Templates" })}</h1>
      <a
        className="content-editor-back"
        href={adminHref({ routePath: "/email?tab=templates" })}
        aria-label={`${pageEditorT("Back")}: ${t({ locale, key: "Templates" })}`}
        {...agentHandle({ handle: "email-template-back" }, { role: "link", label: "Back to the email templates list" })}
      >
        <Icon name="arrow-left" size={22} aria-hidden="true" />
      </a>
      <label className="visually-hidden" htmlFor="email-template-name">{t({ locale, key: "Template name" })}</label>
      <input
        id="email-template-name"
        className="editor-title content-editor-title email-template-name"
        value={controller.name}
        maxLength={200}
        disabled={controller.view.kind !== "loaded"}
        onChange={(e) => controller.setName(e.target.value)}
        onBlur={() => void controller.commitName()}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        {...agentHandle({ handle: "email-template-name" }, { role: "field", label: "Template name" })}
      />
      {subject ? (
        <div className="editor-slug email-template-subject">
          <span>{t({ locale, key: "Subject" })}</span>
          <span className="email-template-subject-text" title={subject}>{subject}</span>
        </div>
      ) : null}
    </div>
  );
}

/** HTML | Preview tabs (Pages' segmented tablist and keyboard contract), device widths, As sent. */
function Toolbar({ useTabBarKeyboardHook, ...props }: { controller: EmailTemplateEditorController; view: EmailTemplateViewState; locale: string; useTabBarKeyboardHook: typeof useTabBarKeyboard; pageEditorT: (key: string) => string; kit: Parameters<typeof EmailTemplateEditor>[0]["kit"] }) {
  const { controller, view, locale } = props;
  const pageT = props.pageEditorT;
  const { resolveTabBarTabIndex } = props.kit;
  const { onKeyDown } = useTabBarKeyboardHook({ tabs: TABS, activeId: view.tab, onChange: (id) => view.setTab(id as EmailTemplateTab) });
  return (
    <div className="page-editor-toolbar">
      <div className="content-editor-toolbar-start">
        <div className="segmented" role="tablist" aria-label={pageT("Editor view")} onKeyDown={onKeyDown}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={view.tab === entry.id}
              className={view.tab === entry.id ? "is-active" : undefined}
              tabIndex={resolveTabBarTabIndex({ tabs: TABS, activeId: view.tab, tab: entry })}
              onClick={() => view.setTab(entry.id)}
              {...agentHandle({ handle: `email-template-view-${entry.id}` }, { role: "button", label: `Switch to the ${entry.label} view` })}
            >
              {pageT(entry.label)}
            </button>
          ))}
        </div>
        {view.tab === "preview" ? (
          <>
            <DevicePreviewToggle device={view.device} setDevice={view.setDevice} t={pageT} handlePrefix="email-template-preview-width" />
            <AsSentToggle controller={controller} locale={locale} />
          </>
        ) : null}
      </div>
      {controller.preview.pending && view.tab === "preview" ? <span className="jini-field-hint" role="status">{t({ locale, key: "Updating…" })}</span> : null}
    </div>
  );
}

/** Save and its state word, in the row under the toolbar like the Pages editor's action row. */
function Actions(props: { controller: EmailTemplateEditorController; locale: string }) {
  const { controller, locale } = props;
  const status = editorStatus(controller);
  return (
    <div className="editor-action-row content-action-row" {...agentHandle({ handle: "email-template-actions" }, { role: "region", label: "Save and its status" })}>
      <div className="content-action-group">
        <button type="button" onClick={() => void controller.save()} disabled={!controller.dirty || controller.saving}
          {...agentHandle({ handle: "email-template-save" }, { role: "button", label: "Save this template's HTML" })}>
          {t({ locale, key: "Save" })}
        </button>
      </div>
      {status ? <span className={status === "Saved" ? "save-ok" : "jini-field-hint"} role="status">{t({ locale, key: status })}</span> : null}
    </div>
  );
}

/** Whether an anchor replaces this editor through the admin SPA. Pure; other windows stay usable. */
function leavesEditor({ anchor, location }: { anchor: HTMLAnchorElement | null; location: Location }, _options = {}): boolean {
  if (!replacesCurrentWindow(anchor)) return false;
  const url = new URL(anchor.href, location.href);
  const adminPath = url.pathname === ADMIN_BASE || url.pathname.startsWith(`${ADMIN_BASE}/`);
  const routeChanged = url.pathname !== location.pathname || url.search !== location.search;
  return url.origin === location.origin && adminPath && routeChanged;
}

/** Downloads and explicitly separate browsing contexts leave the working copy open. */
function replacesCurrentWindow(anchor: HTMLAnchorElement | null): anchor is HTMLAnchorElement {
  if (!anchor || anchor.hasAttribute("download")) return false;
  return !anchor.target || anchor.target === "_self";
}

/** Only a plain click replaces this tab; modified clicks leave its working copy alive. */
function isPlainNavigationClick({ event }: { event: MouseEvent }, _options = {}): boolean {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  return event.button === 0 && !event.defaultPrevented && !modified;
}

/** Reuse Pages' guard for unload and in-app links; also save on Cmd/Ctrl+S. Removes all listeners. */
function useEditorKeys(
  { controller, locale, useDirtyGuardHook }: { controller: EmailTemplateEditorController; locale: string; useDirtyGuardHook: typeof useDirtyGuard },
  { host = window, documentHost = document }: { host?: Window; documentHost?: Document } = {},
): void {
  const { dirty, save } = controller;
  const { confirmLeave } = useDirtyGuardHook(
    { current: dirty, original: controller.view.kind === "loaded" ? false : null },
    { host, translate: (key) => t({ locale, key }) },
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    host.addEventListener("keydown", onKey);
    return () => host.removeEventListener("keydown", onKey);
  }, [host, save]);
  useEffect(() => {
    const onNavigate = (event: MouseEvent) => {
      if (!isPlainNavigationClick({ event })) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!leavesEditor({ anchor, location: host.location })) return;
      if (confirmLeave()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // MOVE: Capture covers sidebar anchors outside this page before the shared SPA interceptor.
    documentHost.addEventListener("click", onNavigate, true);
    return () => documentHost.removeEventListener("click", onNavigate, true);
  }, [confirmLeave, host, documentHost]);
}

/** The save-state word beside the Save button, or null before any edit. Pure. */
export function editorStatus(controller: Pick<EmailTemplateEditorController, "saving" | "dirty" | "savedAt">): string | null {
  if (controller.saving) return "Saving…";
  if (controller.dirty) return "Unsaved changes";
  return controller.savedAt ? "Saved" : null;
}

/**
 * The editor page. `useEditorHook` is the DI seam — a test mounts it over a fake controller.
 */
export function EmailTemplateEditor({ useEditorHook, useAdminLocaleHook, useEmailTemplateViewHook, useTabBarKeyboardHook, useDirtyGuardHook, pageEditorT, kit }: {
  useEditorHook: () => EmailTemplateEditorController;
  useAdminLocaleHook: () => string;
  pageEditorT: (key: string) => string;
  useEmailTemplateViewHook: typeof useEmailTemplateView;
  useTabBarKeyboardHook: typeof useTabBarKeyboard;
  useDirtyGuardHook: typeof useDirtyGuard;
  kit: { Icon: ComponentType<{ name: "arrow-left"; size: number; "aria-hidden"?: boolean | "true" | "false" }>; resolveTabBarTabIndex: AdminKitValues["resolveTabBarTabIndex"] };
}, _optional = {}) {
  const controller = useEditorHook();
  const locale = useAdminLocaleHook();
  const view = useEmailTemplateViewHook();
  useEditorKeys({ controller, locale, useDirtyGuardHook });
  return (
    <div className="page content-editor-page email-template-page">
      <Header controller={controller} locale={locale} pageEditorT={pageEditorT} kit={kit} />
      {controller.renameError ? <p className="jini-field-error" role="alert">{t({ locale, key: controller.renameError })}</p> : null}
      {controller.saveError ? <div className="notice error" role="alert">{t({ locale, key: controller.saveError })}</div> : null}
      <Loaded view={controller.view} locale={locale}>
        {() => (
          <>
            <Toolbar controller={controller} view={view} locale={locale} useTabBarKeyboardHook={useTabBarKeyboardHook} pageEditorT={pageEditorT} kit={kit} />
            <Actions controller={controller} locale={locale} />
            {view.tab === "html" ? (
              <textarea
                className="page-html-source email-template-source"
                value={controller.html}
                onChange={(e) => controller.setHtml(e.target.value)}
                spellCheck={false}
                aria-label={t({ locale, key: "Template HTML" })}
                placeholder={t({ locale, key: "Write the email's HTML, or ask the assistant to." })}
                {...agentHandle({ handle: "email-template-html" }, { role: "field", label: "This email template's raw HTML" })}
              />
            ) : (
              <Preview controller={controller} view={view} locale={locale} />
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}
