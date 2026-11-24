import { useCallback, useMemo, useState } from "react";

import type { EmailApi, EmailTemplateSummary } from "../email-api.types.js";
import { errorMessage, useLoad, type LoadView, type EmailLoadApiError } from "./email-load.hooks.js";

/**
 * @file Templates list state — the Pages list's shape (`features/pages/hooks/use-pages.hooks.ts`):
 * list, New (creates, then opens the editor), Rename, Move to trash. A template is a `posts` row,
 * so trash is the generic Trash move and it can be restored from Trash.
 */

/** The admin route of one template's editor. */
export function templateEditorPath({ id }: { id: string }, _options = {}): string {
  return `/email/templates/${encodeURIComponent(id)}`;
}

export interface EmailTemplatesController {
  view: LoadView<{ templates: EmailTemplateSummary[] }>;
  error: string | null;
  creating: boolean;
  create: () => Promise<void>;
  renaming: { template: EmailTemplateSummary; name: string; pending: boolean } | null;
  startRename: (template: EmailTemplateSummary | null) => void;
  setRenameName: (name: string) => void;
  confirmRename: () => Promise<void>;
  pendingTrash: EmailTemplateSummary | null;
  setPendingTrash: (template: EmailTemplateSummary | null) => void;
  trashing: boolean;
  confirmTrash: () => Promise<void>;
}

/**
 * @param required.api - the Email API port; a fake in tests.
 * @param required.ApiError - the host's transport error class.
 * @param required.open - where a new template goes; the host's router in production.
 * @param optional.newName - the new template's name (already translated by the caller).
 */
export function useEmailTemplates(
  required: { api: Pick<EmailApi, "listTemplates" | "createTemplate" | "renameTemplate" | "trashTemplate">; ApiError: EmailLoadApiError; open: (path: string) => void },
  optional: { newName?: string } = {},
): EmailTemplatesController {
  const { api, ApiError, open } = required;
  const newName = optional.newName ?? "Untitled email";
  const { view, reload, setData } = useLoad({ ApiError, load: useCallback(() => api.listTemplates(), [api]) });
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<EmailTemplatesController["renaming"]>(null);
  const [pendingTrash, setPendingTrash] = useState<EmailTemplateSummary | null>(null);
  const [trashing, setTrashing] = useState(false);

  const create = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await api.createTemplate({ name: newName });
      open(templateEditorPath({ id: created.id }));
    } catch (failure) {
      setError(errorMessage({ error: failure, ApiError }));
    } finally {
      setCreating(false);
    }
  }, [api, newName, open]);

  const startRename = useCallback((template: EmailTemplateSummary | null) => {
    setError(null);
    setRenaming(template ? { template, name: template.name, pending: false } : null);
  }, []);
  const setRenameName = useCallback((name: string) => setRenaming((current) => (current ? { ...current, name } : current)), []);

  const confirmRename = useCallback(async () => {
    if (!renaming || renaming.pending) return;
    const name = renaming.name.trim();
    if (!name || name === renaming.template.name) {
      setRenaming(null);
      return;
    }
    setRenaming({ ...renaming, pending: true });
    try {
      const updated = await api.renameTemplate({ id: renaming.template.id, name, expectedVersion: renaming.template.version });
      if (view.kind === "loaded") setData({ templates: view.data.templates.map((row) => (row.id === updated.id ? { ...row, name: updated.name, version: updated.version, updatedAt: updated.updatedAt } : row)) });
      setRenaming(null);
    } catch (failure) {
      setError(errorMessage({ error: failure, ApiError }));
      setRenaming(null);
      reload();
    }
  }, [api, renaming, view, setData, reload]);

  const confirmTrash = useCallback(async () => {
    if (!pendingTrash) return;
    setTrashing(true);
    setError(null);
    try {
      await api.trashTemplate({ id: pendingTrash.id });
      if (view.kind === "loaded") setData({ templates: view.data.templates.filter((row) => row.id !== pendingTrash.id) });
    } catch (failure) {
      setError(errorMessage({ error: failure, ApiError }));
    } finally {
      setTrashing(false);
      setPendingTrash(null);
    }
  }, [api, pendingTrash, view, setData]);

  return useMemo(() => ({
    view, error, creating, create, renaming, startRename, setRenameName, confirmRename, pendingTrash, setPendingTrash, trashing, confirmTrash,
  }), [view, error, creating, create, renaming, startRename, setRenameName, confirmRename, pendingTrash, trashing, confirmTrash]);
}

