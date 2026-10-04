import { Button, TextField, Notice } from '@jini-ai/ui-kit/react';
import { useAuthTab } from '../hooks/LoginPage.hooks.js';
export default function AuthTab(_props: { readonly params?: Readonly<Record<string, unknown>> } = {}, _optional: Record<string, never> = {}) {
  const v = useAuthTab({});
  return <form onSubmit={v.submit}><TextField label="Username" attrs={v.usernameAttrs} value={v.s.username} onValueChange={v.username}/>
    <TextField label="Password" attrs={v.passwordAttrs} type="password" value={v.s.password} onValueChange={v.password}/>
    {v.s.error ? <Notice tone="danger">{v.s.error}</Notice> : null}<Button type="submit" pending={v.s.busy}>{v.submitLabel}</Button></form>;
}
