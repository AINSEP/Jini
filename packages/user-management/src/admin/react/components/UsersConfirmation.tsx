import { ConfirmDialog, TextField, Button, Notice } from '@jini-ai/ui-kit/react';
import { useUsersConfirmation, newPasswordAttrs } from '../hooks/UsersTab.hooks.js';
/** Kept mounted independently of row menus. Confirmation and cancellation share ui-kit's guards. */
export function UsersConfirmation(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const v = useUsersConfirmation({});
  return <ConfirmDialog {...v.confirm} body={<div><p>{v.s.pending?.user.username}</p><p>{v.copy.body}</p>
    {v.reset ? <><TextField label="New password" type={v.newType} attrs={newPasswordAttrs} value={v.s.newPassword} onValueChange={v.newPassword} disabled={v.s.confirming}/>
      <Button onPress={v.toggleNew} attrs={{ 'aria-pressed': v.s.showNewPassword }}>{v.newLabel}</Button>
      <TextField label="Confirm new password" type={v.confirmType} attrs={newPasswordAttrs} value={v.s.confirmPassword} onValueChange={v.confirmPassword} disabled={v.s.confirming}/>
      <Button onPress={v.toggleConfirm} attrs={{ 'aria-pressed': v.s.showConfirmPassword }}>{v.confirmLabel}</Button>
      {v.error ? <Notice tone="danger">{v.error}</Notice> : null}</> : null}
  </div>}/>;
}
