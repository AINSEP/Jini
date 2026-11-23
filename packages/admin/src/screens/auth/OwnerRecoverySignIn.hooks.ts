import type { DescribeOwnerRecoveryFailure, OwnerRecoverRequest, UseRecoveryCodeSignInHook } from './auth-host-slots.js';

import { type Translate } from '@jini-ai/core/text';
/** Reset the owner password with a one-use recovery code. The host injects the base recovery-code
 *  controller hook and its recovery failure describer. */
export function useOwnerRecoverySignIn({ recover, t, useRecoveryCodeSignIn, ownerRecoveryFailure }: { recover: OwnerRecoverRequest; t: Translate; useRecoveryCodeSignIn: UseRecoveryCodeSignInHook; ownerRecoveryFailure: DescribeOwnerRecoveryFailure }, _options = {}) {
  const controller = useRecoveryCodeSignIn({
    recover, t,
    describeFailure: ({ error }) => ownerRecoveryFailure({ error, message: 'The owner account could not be recovered.', action: 'Follow the server explanation. Ask the host operator for help if recovery is unavailable.', step: 'owner-recovery-redeem', t, secrets: [controller.code.trim(), controller.password] }),
    copy: {
      mismatch: t('The passwords do not match. Enter the same password in both fields. Details: owner-recovery-confirmation'),
      recovered: t('Owner password reset. Sign in with your new password. Authenticators, passkeys, sessions and recovery codes were invalidated.'),
      reset: '',
    },
  }, {});
  return controller;
}
