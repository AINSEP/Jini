import type { ForwardedRef, RefObject } from "react";
import type { AccessTokenRow } from "../access-token-rows.js";
import { customCredentialReadyToSave, isValidHttpUrl } from "../custom-credential-forms.js";

export interface RemoveConfirmDialogActions {
  close: () => void;
  confirm: () => void;
}

/**
 * `RemoveConfirmDialog`'s close/confirm — extracted verbatim, same two calls, same order.
 *
 * @param required - The dialog and controller inputs.
 * @param required.ref - The forwarded ref `RemoveConfirmDialog` receives from its caller.
 * @param required.row - The token row this confirm dialog is for.
 * @param required.controller - `AccessTokensController.removeToken` is the one call this hook makes.
 * @returns `close`/`confirm`, wired directly to the dialog's Cancel/"Remove from Tovu" buttons.
 * @complexity O(1).
 */
export function useRemoveConfirmDialog(
  { ref, row, controller }: {
    ref: ForwardedRef<HTMLDialogElement>;
    row: AccessTokenRow;
    controller: { removeToken: (row: AccessTokenRow) => Promise<unknown> };
  },
  _optional: Record<string, never> = {},
): RemoveConfirmDialogActions {
  function close(): void {
    (ref as RefObject<HTMLDialogElement>).current?.close();
  }
  function confirm(): void {
    close();
    void controller.removeToken(row);
  }
  return { close, confirm };
}

export interface AddCustomCredentialDialogState {
  readyToSave: boolean;
  baseUrlInvalid: boolean;
  close: () => void;
  save: () => Promise<void>;
}

/**
 * `AddCustomCredentialDialog`'s two save-readiness checks and its close/save handlers. The token
 * field's show/hide lives in the shared `SecretInput`, which re-hides once the form resets.
 *
 * @param ref - The forwarded ref `AddCustomCredentialDialog` receives from its caller.
 * @param controller - Reads `controller.customAddForm`; calls `resetCustomAddForm`/
 *   `createCustomCredential`.
 * @returns `readyToSave`/`baseUrlInvalid` for the form's own validity checks, and `close`/`save`.
 * @complexity O(1).
 */
export function useAddCustomCredentialDialog(
  { ref, controller }: { ref: ForwardedRef<HTMLDialogElement>; controller: { customAddForm: Parameters<typeof customCredentialReadyToSave>[0]; resetCustomAddForm: () => void; createCustomCredential: () => Promise<boolean> } },
  _optional: Record<string, never> = {},
): AddCustomCredentialDialogState {
  const form = controller.customAddForm;
  const readyToSave = customCredentialReadyToSave(form);
  const baseUrlInvalid = form.baseUrl.trim() !== "" && !isValidHttpUrl({ value: form.baseUrl.trim() });

  function close(): void {
    (ref as RefObject<HTMLDialogElement>).current?.close();
    controller.resetCustomAddForm();
  }
  async function save(): Promise<void> {
    const ok = await controller.createCustomCredential();
    if (ok) (ref as RefObject<HTMLDialogElement>).current?.close();
  }

  return { readyToSave, baseUrlInvalid, close, save };
}

