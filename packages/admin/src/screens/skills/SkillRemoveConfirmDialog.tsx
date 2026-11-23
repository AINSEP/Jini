import type { SkillDialogClassNames, SkillsScreenController } from "./skills-screen.types.js";
import { ErrorNotice } from "../../react/kit.js";

import { type Translate } from '@jini-ai/core/text';
/** Mirrors PluginRemoveConfirmDialog with Skills' existing copy and busy guard. */
export function SkillRemoveConfirmDialog({ controller, t = key => key, classNames: cx }: { controller: SkillsScreenController; t?: Translate; classNames: SkillDialogClassNames }) {
  return (
    <div className={cx.dialogBackdrop} onClick={controller.onCancelRemove}>
      <div ref={controller.confirmation.dialogRef} className={`${cx.dialog} jini-skills-confirm-dialog`} role="dialog" aria-modal="true" aria-label={t("Remove skill")} aria-busy={controller.busy} onClick={controller.confirmation.onDialogClick}>
        <h2>{t("Remove {name}?").replace("{name}", () => controller.removing?.name ?? "")}</h2>
        {controller.failure ? <ErrorNotice failure={controller.failure} t={t} /> : controller.error ? <p className={cx.noticeError} role="alert">{t(controller.error)}</p> : null}
        <span className={cx.editorActions}>
          <button type="button" className={cx.buttonSecondary} disabled={controller.busy} onClick={controller.onCancelRemove}>{t("Cancel")}</button>
          <button type="button" className={cx.buttonDanger} disabled={controller.busy} onClick={controller.onConfirmRemove}>{t("Confirm remove")}</button>
        </span>
      </div>
    </div>
  );
}
