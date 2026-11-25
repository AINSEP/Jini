import { ConfirmDialog } from '../../../react/components/ConfirmDialog/ConfirmDialog.js';
import type { FormEditorReload } from "../hooks/use-form-editor-refresh.hooks.js";

/** The "this form changed" notice and its discard confirmation. Reloading a dirty draft always asks
 * first; the draft and the notice stay put until a fresh read is actually applied. */
export function FormEditorReloadNotice({ reload, t }: { reload: FormEditorReload; t: (key: string) => string }) {
  return (
    <>
      {reload.available ? (
        <div className="notice" role="status">
          {t("This form changed since you opened it. Reload it to see the latest version.")}{" "}
          <button type="button" className="btn" onClick={() => reload.request()} disabled={reload.pending}>{t("Reload form")}</button>
        </div>
      ) : null}
      <ConfirmDialog
        open={reload.confirmOpen}
        agentHandle="form-editor-reload-confirm"
        title={t("Reload form")}
        body={<p>{t("Reloading discards your unsaved changes.")}</p>}
        confirmLabel={t("Reload form")}
        cancelLabel={t("Keep editing")}
        tone="danger"
        onConfirm={() => reload.confirm()}
        onCancel={() => reload.cancel()}
      />
    </>
  );
}
