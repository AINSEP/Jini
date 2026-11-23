import { Button, Dialog, TextField } from "@jini-ai/ui-kit/react";
import type { FormEvent } from "react";

import { type Translate } from '@jini-ai/core/text';

/**
 * What the dialog reads from the host's URL-dialog controller. The host's hook (bound to its rich-text
 * editor) owns open/close, validation and insertion; this view only renders its state.
 */
export interface PostUrlDialogView {
  open: boolean;
  title: string;
  image: boolean;
  url: string;
  alt: string;
  error: string;
  errorId: string;
  pending: boolean;
  invalid: boolean;
  disabled: boolean;
  cancel: () => void;
  submit: (event: Pick<FormEvent<HTMLFormElement>, "preventDefault">) => void;
  changeUrl: (change: { value: string }) => void;
  changeAlt: (change: { value: string }) => void;
}

/**
 * One compact URL form shared by Link, image and YouTube; the hook owns its behavior.
 *
 * Styling: the host loads its shared domain-dialog stylesheet plus `@jini-ai/admin/posts/post-url-dialog.css`
 * (the `.jini-post-url-dialog` width) wherever it renders this dialog.
 */
export function PostUrlDialog({ dialog, t }: { dialog: PostUrlDialogView; t: Translate }) {
  if (!dialog.open) return null;
  return (
    <Dialog open title={t(dialog.title)} pending={dialog.pending} onClose={dialog.cancel} className="settings-dialog jini-domain-dialog jini-post-url-dialog">
      <form onSubmit={dialog.submit} noValidate>
        <TextField label={t("URL")} type="url" required placeholder="https://" value={dialog.url} onValueChange={dialog.changeUrl}
          attrs={{ "data-jini-autofocus": "", "aria-invalid": dialog.invalid, "aria-describedby": dialog.error ? dialog.errorId : undefined }} />
        {dialog.error ? <span id={dialog.errorId} className="jini-field-error" role="alert">{t(dialog.error)}</span> : null}
        {dialog.image ? <TextField label={t("Alt text (optional)")} value={dialog.alt} onValueChange={dialog.changeAlt} /> : null}
        <div className="jini-dialog-footer">
          <Button variant="secondary" className="btn-secondary" disabled={dialog.pending} onPress={dialog.cancel}>{t("Cancel")}</Button>
          <Button type="submit" variant="primary" disabled={dialog.disabled}>{t("Insert")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
