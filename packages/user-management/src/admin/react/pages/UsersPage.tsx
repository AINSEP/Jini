import { Suspense } from 'react';
import { Button, Notice, Spinner } from '@jini-ai/ui-kit/react';
import type { UsersPageProps } from '../hooks/UsersBinding.hooks.js';
import { useUsersPage, UsersViewContext } from '../hooks/UsersPage.hooks.js';
import type { UsersView } from '../hooks/UsersPage.hooks.js';
import { usersMessagesEn as m } from '../../messages.en.js';
import { UsersConfirmation } from '../components/UsersConfirmation.js';
/** The loaded shell; UsersPage only renders it once the page view and all three lists exist. */
function UsersShell({ v, view }: { v: ReturnType<typeof useUsersPage>; view: UsersView }, _optional: Record<string, never> = {}) {
  return <UsersViewContext.Provider value={view}><div className="page">
    <header><p>People</p><h1>{m.title}</h1><p>{m.description}</p><p>{m.passwordHelp}</p></header>
    {v.readOnly ? <Notice>{m.readOnly}</Notice> : null}<Notice>{m.protected}</Notice>
    {view.state.rowError ? <Notice tone="danger">{view.state.rowError}</Notice> : null}
    {view.state.notice ? <Notice tone="success">{view.state.notice}</Notice> : null}
    <Suspense fallback={<Spinner label={m.loading}/>}>{v.content}</Suspense>
    <UsersConfirmation/>
  </div></UsersViewContext.Provider>;
}
export default function UsersPage(props: UsersPageProps, _optional: Record<string, never> = {}) {
  const v = useUsersPage(props);
  if (!v.visible) return <Notice>Users administration is unavailable.</Notice>;
  if (!v.state) return <Spinner label={m.loading}/>;
  if (v.state.error) return <Notice tone="danger">{v.state.error}<Button onPress={v.retry}>Retry</Button></Notice>;
  if (!v.view || !v.state.users || !v.state.roles || !v.state.policies) return <Spinner label={m.loading}/>;
  return <UsersShell v={v} view={v.view}/>;
}
