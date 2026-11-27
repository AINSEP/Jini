import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EmailApi, EmailTemplateDetail, EmailTemplatePreview } from "../email-api.types.js";
import { errorMessage, useLoad, type LoadView, type EmailLoadApiError } from "./email-load.hooks.js";

/**
 * @file One email template's editor page state: the raw HTML working copy, `{{field}}` fill-in
 * values (seeded from the template's declared samples), a debounced live preview of the UNSAVED
 * HTML (`POST …/email-templates/preview`), Save (`PUT …/:id/html`, conditioned on the version that
 * was loaded) and Rename (`PATCH …/:id`).
 *
 * Preview modes: `admin` keeps scripts (shown only inside the sandboxed preview iframe, the Pages
 * preview's sandbox); `sent` is exactly what a mail client gets — static HTML, scripts stripped.
 */

export type PreviewMode = "admin" | "sent";

export interface EmailTemplateEditorController {
  view: LoadView<EmailTemplateDetail>;
  html: string;
  setHtml: (html: string) => void;
  dirty: boolean;
  values: Record<string, string>;
  setValue: (field: string, value: string) => void;
  /** Field names to show: declared ones first, then any the HTML uses without declaring. */
  fieldNames: string[];
  mode: PreviewMode;
  setMode: (mode: PreviewMode) => void;
  preview: { data: EmailTemplatePreview | null; error: string | null; pending: boolean };
  saving: boolean;
  saveError: string | null;
  savedAt: string | null;
  save: () => Promise<void>;
  name: string;
  setName: (name: string) => void;
  commitName: () => Promise<void>;
  renameError: string | null;
}

/** Declared fields, then undeclared ones the HTML uses, without repeats. Pure. */
export function templateFieldNames(required: { declared: readonly { name: string }[]; undeclared: readonly string[] }): string[] {
  return [...new Set([...required.declared.map((field) => field.name), ...required.undeclared])];
}

/** The friendly line for a save failure; a 409 means someone else saved first. Pure. */
export function saveFailureText({ error, ApiError }: { error: unknown; ApiError: EmailLoadApiError }, _options = {}): string {
  if (error instanceof ApiError && error.status === 409) return "Someone else changed this template. Reload to get their version; copy your edits first.";
  return errorMessage({ error, ApiError });
}

/** Keeps the last good preview on screen beside the failure. */
function previewFailed({ error }: { error: string }, _options = {}): (current: EmailTemplateEditorController["preview"]) => EmailTemplateEditorController["preview"] {
  return (current) => ({ data: current.data, error, pending: false });
}

/**
 * @param required.api - the Email API port; a fake in tests.
 * @param required.id - the template id from the route.
 * @param required.ApiError - the host's transport error class.
 * @param optional.debounceMs - preview settle time; 0 in tests.
 */
export function useEmailTemplateEditor(
  required: { api: Pick<EmailApi, "getTemplate" | "saveTemplateHtml" | "renameTemplate" | "previewTemplate">; id: string; ApiError: EmailLoadApiError },
  optional: { debounceMs?: number } = {},
): EmailTemplateEditorController {
  const {
    api, ApiError, debounceMs, view, setData, detail, html, setHtml, values, setValues, mode, setMode, preview, setPreview, saving, setSaving, saveError, setSaveError,
    savedAt, setSavedAt, name, setName, renameError, setRenameError, loadedId,
  } = useEmailTemplateWorkingCopy({ required, optional });
  useEmailTemplatePreview({ loadedId, html, setPreview, api, ApiError, values, mode, debounceMs });

  const dirty = detail !== null && html !== detail.html;
  const setValue = useCallback((field: string, value: string) => setValues((all) => ({ ...all, [field]: value })), []);
  const fieldNames = useMemo(() => templateFieldNames({
    declared: detail?.fields ?? [],
    undeclared: preview.data?.undeclaredFields ?? detail?.undeclaredFields ?? [],
  }), [detail, preview.data]);
  const { save, commitName } = useEmailTemplateWrites({ detail, saving, dirty, setSaving, setSaveError, api, ApiError, html, setData, setHtml, setSavedAt, name, setName, setRenameError });

  return {
    view, html, setHtml, dirty, values, setValue, fieldNames, mode, setMode, preview, saving, saveError, savedAt, save, name, setName, commitName, renameError,
  };
}

function useEmailTemplateWrites(
  { detail, saving, dirty, setSaving, setSaveError, api, ApiError, html, setData, setHtml, setSavedAt, name, setName, setRenameError }:
    Pick<ReturnType<typeof useEmailTemplateWorkingCopy>, "detail" | "saving" | "setSaving" | "setSaveError" | "api" | "ApiError" | "html" | "setData" | "setHtml"
    | "setSavedAt" | "name" | "setName" | "setRenameError"> &
    { dirty: boolean }
) {
  const save = useCallback(async () => {
    if (!detail || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.saveTemplateHtml({ id: detail.id, html, expectedVersion: detail.version });
      setData(saved);
      // The server stores its normalized copy (it trims the trailing newline), so adopt it unless the
      // owner typed more while saving; otherwise `dirty` stayed true after every save.
      setHtml((current) => (current === html ? saved.html : current));
      setSavedAt(saved.updatedAt);
    } catch (error) {
      setSaveError(saveFailureText({ error, ApiError }));
    } finally {
      setSaving(false);
    }
  }, [api, detail, saving, dirty, html, setData]);

  const commitName = useCallback(async () => {
    if (!detail) return;
    const next = name.trim();
    if (!next || next === detail.name) {
      setName(detail.name);
      return;
    }
    setRenameError(null);
    try {
      const renamed = await api.renameTemplate({ id: detail.id, name: next, expectedVersion: detail.version });
      // Keep the working copy: a rename only changes the title and the version the next save states.
      setData({ ...detail, name: renamed.name, version: renamed.version, updatedAt: renamed.updatedAt });
    } catch (error) {
      setRenameError(saveFailureText({ error, ApiError }));
      setName(detail.name);
    }
  }, [api, detail, name, setData]);
  return { save, commitName };
}

function useEmailTemplatePreview(
  { loadedId, html, setPreview, api, ApiError, values, mode, debounceMs }:
    Pick<ReturnType<typeof useEmailTemplateWorkingCopy>, "loadedId" | "html" | "setPreview" | "api" | "ApiError" | "values" | "mode" | "debounceMs">
) {
  useEffect(() => {
    if (!loadedId) return undefined;
    if (!html.trim()) {
      setPreview({ data: null, error: null, pending: false });
      return undefined;
    }
    let live = true;
    setPreview((current) => ({ ...current, pending: true }));
    const timer = setTimeout(() => {
      api.previewTemplate({ html, values, mode }).then(
        (data) => { if (live) setPreview({ data, error: null, pending: false }); },
        (error: unknown) => { if (live) setPreview(previewFailed({ error: errorMessage({ error, ApiError }) })); },
      );
    }, debounceMs);
    return () => { live = false; clearTimeout(timer); };
  }, [api, loadedId, html, values, mode, debounceMs]);
}

function useEmailTemplateWorkingCopy(
  { required, optional }:
    { required: Parameters<typeof useEmailTemplateEditor>[0]; optional: NonNullable<Parameters<typeof useEmailTemplateEditor>[1]> }
) {
  const { api, id, ApiError } = required;
  const debounceMs = optional.debounceMs ?? 400;
  const { view, setData } = useLoad({ ApiError, load: useCallback(() => api.getTemplate({ id }), [api, id]) });
  const detail = view.kind === "loaded" ? view.data : null;
  const [html, setHtml] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<PreviewMode>("admin");
  const [preview, setPreview] = useState<EmailTemplateEditorController["preview"]>({ data: null, error: null, pending: true });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  // Seed the working copy once per loaded template (not on every save's fresh detail).
  const loadedId = detail?.id ?? null;
  const seededId = useRef<string | null>(null);
  useEffect(() => {
    if (!detail) { seededId.current = null; return; }
    if (seededId.current === loadedId) return;
    seededId.current = loadedId;
    // A different template: drop the previous one's preview (and the undeclared fields it reported)
    // so they never show under this template while its own preview renders.
    setPreview({ data: null, error: null, pending: true });
    setHtml(detail.html);
    setName(detail.name);
    setValues(Object.fromEntries(detail.fields.map((field) => [field.name, field.sample ?? ""])));
    // Keyed on the id on purpose: a save's refreshed detail must not replace the working copy.
  }, [detail, loadedId]);
  return {
    api, ApiError, debounceMs, view, setData, detail, html, setHtml, values, setValues, mode, setMode, preview, setPreview, saving, setSaving, saveError, setSaveError,
    savedAt, setSavedAt, name, setName, renameError, setRenameError, loadedId,
  };
}

