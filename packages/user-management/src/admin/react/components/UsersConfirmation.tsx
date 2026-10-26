import { ConfirmDialog, Notice } from '@jini-ai/ui-kit/react';
import { SecretInput } from '@jini-ai/ui';
import { useId } from 'react';
import { useUsersConfirmation, newPasswordAttrs } from '../hooks/UsersTab.hooks.js';
/** Kept mounted independently of row menus. Confirmation and cancellation share ui-kit's guards. */
export function UsersConfirmation(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const v = useUsersConfirmation({});
  const fieldId = useId();
  return <ConfirmDialog {...v.confirm} body={<div><p>{v.s.pending?.user.username}</p><p>{v.copy.body}</p>
    {v.reset ? <><label className="jini-field-label" htmlFor={`${fieldId}-new`}>New password</label>
      <SecretInput id={`${fieldId}-new`} label="New password" {...newPasswordAttrs}
        value={v.s.newPassword} onChange={event => v.newPassword({ value: event.target.value })} disabled={v.s.confirming}
        revealed={v.s.showNewPassword} onRevealedChange={v.toggleNew}/>
      <label className="jini-field-label" htmlFor={`${fieldId}-confirm`}>Confirm new password</label>
      <SecretInput id={`${fieldId}-confirm`} label="Confirm new password" {...newPasswordAttrs}
        value={v.s.confirmPassword} onChange={event => v.confirmPassword({ value: event.target.value })} disabled={v.s.confirming}
        revealed={v.s.showConfirmPassword} onRevealedChange={v.toggleConfirm}/>
      {v.error ? <Notice tone="danger">{v.error}</Notice> : null}</> : null}
  </div>}/>;
}
