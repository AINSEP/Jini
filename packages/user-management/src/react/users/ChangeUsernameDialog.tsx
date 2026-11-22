import { ConfirmDialog } from "../kit.js";
import { agentHandle } from "@jini-ai/core/agent-handles";

import type { useChangeUsername } from "./hooks/use-change-username.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/** Markup shared by row actions and the signed-in user's profile; state lives in the hook. */
export function ChangeUsernameDialog({ controller, translate: t }: {
  controller: ReturnType<typeof useChangeUsername>; translate: Translate;
}) {
  return <ConfirmDialog open={controller.target !== null} agentHandle="users-change-username"
    title={t("Change username")} cancelLabel={t("Cancel")} confirmLabel={t("Change username")}
    pending={controller.pending} onConfirm={() => void controller.confirm({})} onCancel={() => controller.cancel({})}
    body={<>
      <p>{controller.target?.username}</p>
      <label>{t("New username")}<input value={controller.username} autoComplete="off"
        disabled={controller.pending} onChange={event => controller.setUsername(event.target.value)}
        {...agentHandle({ handle: "users-change-username-input" }, { role: "field", label: "New login username" })} /></label>
      <p>{t("Existing sessions stay signed in. Use the new username the next time you sign in.")}</p>
      {controller.error ? <p role="alert" className="save-error">{controller.error}</p> : null}
    </>} />;
}
