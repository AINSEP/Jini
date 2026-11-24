import { agentHandle } from "@jini-ai/core/agent-handles";
import { useRemoteImageImport } from "./use-remote-image-import.hooks.js";
import type { HeaderTipComponent, ImportDialogKit, RemoteImageImportCollaborators } from "./ports.js";

/** Markup only; downloads, mutation state, dialog state and list invalidation live in the hook.
 *  The "Import from URL" button sits beside "Upload image" and opens the same dialog shape
 *  (owner item #9, 2026-10-13). */
export function RemoteImageImport(props: RemoteImageImportCollaborators & { HeaderTip: HeaderTipComponent; kit: ImportDialogKit }) {
  const { t, HeaderTip } = props;
  const { Button, Dialog, TextField } = props.kit;
  const controller = useRemoteImageImport({ t, port: props.port, describeError: props.describeError, useFetchMutation: props.useFetchMutation });
  return (
    <>
      {/* Icon button (owner, 2026-11-01): tooltip and accessible name are the same text. */}
      <HeaderTip label={t("Import from URL")}>
        <button type="button" className="jini-btn-secondary jini-media-icon-btn" aria-label={t("Import from URL")} onClick={controller.openDialog}
          {...agentHandle({ handle: "media-import-open" }, { role: "button", label: "Open the Import from URL dialog" })}>
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path d="M7.5 10.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M10.5 7.5a3 3 0 0 0-4.2 0L3.7 10.1a3 3 0 0 0 4.2 4.2l.9-.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </HeaderTip>
      <Dialog open={controller.open} title={t("Import from URL")} pending={controller.pending} onClose={controller.close}
        className="jini-settings-dialog jini-domain-dialog jini-media-import-dialog">
        <form onSubmit={controller.submit} noValidate>
          <TextField label={t("Remote image URL")} type="url" placeholder="https://" value={controller.url} disabled={controller.pending}
            onValueChange={({ value }) => controller.setUrl(value)}
            attrs={{ "data-jini-autofocus": "", "aria-invalid": controller.urlInvalid,
              ...agentHandle({ handle: "media-import-url" }, { role: "field", label: t("Remote image URL") }) }} />
          {controller.urlInvalid ? <span className="jini-field-error">{t("Enter an https:// image URL.")}</span> : null}
          {/* Short visible label like the upload dialog's, but its own accessible name: that field
              already owns "Alt text (optional)" on this screen. */}
          <TextField label={t("Alt text (optional)")} value={controller.alt} disabled={controller.pending}
            onValueChange={({ value }) => controller.setAlt(value)}
            attrs={{ "aria-label": t("Imported image alt text (optional)"),
              ...agentHandle({ handle: "media-import-alt" }, { role: "field", label: t("Imported image alt text (optional)") }) }} />
          {controller.error ? <div role="alert" className="jini-notice jini-notice-error">{controller.error}</div> : null}
          <div className="jini-dialog-footer">
            <Button variant="secondary" className="jini-btn-secondary" disabled={controller.pending} onPress={controller.close}>{t("Cancel")}</Button>
            <Button type="submit" variant="primary" disabled={!controller.canSubmit}
              attrs={agentHandle({ handle: "media-import-submit" }, { role: "button", label: t("Import from URL") })}>
              {controller.pending ? t("Importing…") : t("Import")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
