import { createRecoveryKitDownload as createJiniRecoveryKitDownload, type useRecoveryKit as useJiniRecoveryKit, type useOwnerPasswordReset } from './OwnerRecovery.hooks.js';
import type { UserFacingError } from '@jini-ai/core';

import { type Translate } from '@jini-ai/core/text';
export interface OwnerRecoveryStatus { isOwner: boolean; available: boolean; desktopOwnerReset: boolean }
export interface OwnerRecoveryPort {
  status(): Promise<OwnerRecoveryStatus>;
  issue(input: { password: string; code?: string }, optional?: Record<string, never>): Promise<{ codes: string[] }>;
  reset(input: { password: string }, optional?: Record<string, never>): Promise<void>;
  recover(input: { code: string; password: string }, optional?: Record<string, never>): Promise<void>;
}
/** The host's redacting formatter. `secrets` carries the exact submitted values, because a driver may
 * echo them without a label; the host's redactor scrubs them from the message and the details. */
export type OwnerRecoveryFailureFormatter = (
  required: { error: unknown; message: string; action: string; step: string; t: Translate; secrets?: string[] },
  optional?: Record<string, never>,
) => UserFacingError;

/** What the card hands each of its two controller hooks. */
export interface OwnerRecoveryHookArgs { port: OwnerRecoveryPort; t: Translate; describeFailure: OwnerRecoveryFailureFormatter }

/** Issue a fresh recovery kit after password proof. The host binds the inner `useRecoveryKit` hook. */
export function useOwnerRecoveryKit({ port, t, describeFailure }: OwnerRecoveryHookArgs,
  { useJiniRecoveryKitHook }: { useJiniRecoveryKitHook: typeof useJiniRecoveryKit }) {
  const controller = useJiniRecoveryKitHook({
    issue: port.issue,
    describeFailure: ({ error }) => describeFailure({ error, message: 'Recovery codes could not be generated.', action: 'Follow the server explanation before generating another set. Ask the host operator for help if it continues.', step: 'owner-recovery-issue', t, secrets: [controller.password, controller.code] }),
  }, {});
  return controller;
}

/** Browser download of the kit text; the object URL is released as soon as the click is dispatched. */
export function saveTextFileViaDom({ text, filename }: { text: string; filename: string }, _optional: Record<string, never> = {}) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

/** Download the displayed codes and clear them from the view. */
export function createOwnerRecoveryKitDownload({ codes, dismiss, filename }: { codes: string[]; dismiss: () => void; filename: string },
  { saveTextFile = saveTextFileViaDom }: { saveTextFile?: typeof saveTextFileViaDom } = {}) {
  return createJiniRecoveryKitDownload({ codes, dismiss, filename, saveTextFile }, {});
}

/** Reset the desktop owner's password using its restored owner session. The host binds the inner
 * `useOwnerPasswordReset` hook. */
export function useDesktopOwnerReset({ port, t, describeFailure }: OwnerRecoveryHookArgs,
  { useOwnerPasswordResetHook }: { useOwnerPasswordResetHook: typeof useOwnerPasswordReset }) {
  const controller = useOwnerPasswordResetHook({
    reset: port.reset, t,
    describeFailure: ({ error }) => describeFailure({ error, message: 'The owner password could not be reset.', action: 'Follow the server explanation. Reopen this site in the desktop app to renew local proof if it was refused.', step: 'desktop-owner-reset', t, secrets: [controller.password] }),
    copy: {
      mismatch: t('The passwords do not match. Enter the same password in both fields. Details: desktop-owner-confirmation'),
      recovered: '',
      reset: t('Owner password reset. All sessions and recovery codes were invalidated. Reopen the site or sign in with your new password.'),
    },
  }, {});
  return controller;
}

/** The card's recovery-kit controller hook, already bound by the host to its inner hook. */
export type OwnerRecoveryKitHook = (required: OwnerRecoveryHookArgs) => ReturnType<typeof useOwnerRecoveryKit>;
/** The card's desktop-reset controller hook, already bound by the host to its inner hook. */
export type DesktopOwnerResetHook = (required: OwnerRecoveryHookArgs) => ReturnType<typeof useDesktopOwnerReset>;
