import { Suspense } from 'react';
import { Notice, Spinner, Button } from '@jini-ai/ui-kit/react';
import type { MembersPageProps } from '../hooks/MembersBinding.hooks.js';
import { MembersViewContext, useMembersPage } from '../hooks/MembersPage.hooks.js';
import { membersMessagesEn as m } from '../../messages.en.js';
import { MembersConfirmation } from '../components/MembersConfirmation.js';
export default function MembersPage(props: MembersPageProps, _optional: Record<string, never> = {}) {
  const v = useMembersPage(props);
  if (!v.visible) return <Notice>Members administration is unavailable.</Notice>;
  if (!v.state) return <Spinner label={m.loading}/>;
  if (v.state.error) return <Notice tone="danger">{v.state.error}<Button onPress={v.retry}>Retry</Button></Notice>;
  if (!v.view || !v.state.members) return <Spinner label={m.loading}/>;
  return <MembersViewContext.Provider value={v.view}><div className="page"><header><p>People</p><h1>{m.title}</h1><p>{m.description}</p></header>
    {!v.canManage ? <Notice>{m.readOnly}</Notice> : null}<Suspense fallback={<Spinner label={m.loading}/>}>{v.content}</Suspense><MembersConfirmation/>
  </div></MembersViewContext.Provider>;
}
