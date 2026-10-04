import { Suspense } from 'react';
import { Button, Notice, Spinner } from '@jini-ai/ui-kit/react';
import type { UsersPageProps } from '../hooks/UsersBinding.hooks.js';
import { useUsersPage, UsersViewContext } from '../hooks/UsersPage.hooks.js';
import { usersMessagesEn as m } from '../../messages.en.js';
import { UsersConfirmation } from '../components/UsersConfirmation.js';
export default function UsersPage(props: UsersPageProps, _optional: Record<string, never> = {}) {
  const v = useUsersPage(props);
  if (!v.visible) return <Notice>Users administration is unavailable.</Notice>;
  if (!v.state) return <Spinner label={m.loading}/>;
  if (v.state.error) return <Notice tone="danger">{v.state.error}<Button onPress={v.retry}>Retry</Button></Notice>;
  if (!v.view || !v.state.users || !v.state.roles || !v.state.policies) return <Spinner label={m.loading}/>;
  return <UsersViewContext.Provider value={v.view}><div className="page">
    <header><p>People</p><h1>{m.title}</h1><p>{m.description}</p><p>{m.passwordHelp}</p></header>
    {v.readOnly ? <Notice>{m.readOnly}</Notice> : null}<Notice>{m.protected}</Notice>
    {v.state.rowError ? <Notice tone="danger">{v.state.rowError}</Notice> : null}
    {v.state.notice ? <Notice tone="success">{v.state.notice}</Notice> : null}
    <Suspense fallback={<Spinner label={m.loading}/>}>{v.content}</Suspense>
    <UsersConfirmation/>
  </div></UsersViewContext.Provider>;
}
