import { Button, Dialog } from "../../react/kit.js";

import type { CopyKeysController } from "./hooks/use-copy-keys.hooks.js";
import { type Translate } from '@jini-ai/core/text';

/** One selection approves access for this site; a key saved on another site joins Shared Keys first. */
export function CopyKeysDialog({ dialog, t }: { dialog: CopyKeysController; t: Translate }) {
  if (!dialog.open) return null;
  // Every input locks while inventory loads or a site grant is in flight.
  const locked = dialog.pending || dialog.loading;
  return (
    <Dialog open title={t("Use a saved key")} pending={dialog.pending} onClose={dialog.cancel} className="settings-dialog jini-domain-dialog copy-keys-dialog">
      <form onSubmit={dialog.submit}>
        <div className="jini-dialog-body">
          <p>{t("Shared Keys and keys saved on your other sites. A key from another site is added to Shared Keys first.")}</p>
          {dialog.loading ? <span role="status">{t("Loading Shared Keys…")}</span> : null}
          {dialog.empty ? <span>{t("No saved keys are available. Use Add credential to enter a new key.")}</span> : null}
          <div className="copy-keys-list">
            {dialog.keys.map(key => <label key={key.id}><input type="radio" name="saved-key" value={key.id} checked={key.checked} onChange={dialog.changeKey} disabled={locked || Boolean(key.locked)} />{key.text}{key.worksFor ? <span> · {key.worksFor}</span> : null}{key.locked ? <span className="jini-field-error"> {t(key.locked)}</span> : null}</label>)}
          </div>
          {dialog.omissions.map(omission => <p key={omission.id}>{omission.siteName}: {omission.count} {t("more not shown")}</p>)}
          {dialog.error ? <span className="jini-field-error" role="alert">{dialog.error}</span> : null}
          {dialog.results.length ? <ul aria-live="polite" className="copy-keys-results">{dialog.results.map(result => <li key={result.key}>{result.text}</li>)}</ul> : null}
        </div>
        <div className="jini-dialog-footer">
          <Button variant="secondary" className="btn-secondary" disabled={dialog.pending} onPress={dialog.cancel}>{t("Cancel")}</Button>
          <Button type="submit" variant="primary" className="btn-primary" disabled={dialog.disabled}>{t("Use this key on this site")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
