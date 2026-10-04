import { Suspense } from 'react';
import { Button, Notice, Spinner, Tabs } from '@jini-ai/ui-kit/react';
import type { RolesPageProps } from '../hooks/RolesBinding.hooks.js';
import { RolesViewContext, useRolesPage } from '../hooks/RolesPage.hooks.js';
import { DestructiveDialog } from '../components/DestructiveDialog.js';
import { rolesMessagesEn as m } from '../../messages.en.js';
export default function RolesPage(props: RolesPageProps, _optional: Record<string, never> = {}) {
    const v = useRolesPage(props);
    if (v.hidden)
        return <Notice>Roles administration is unavailable.</Notice>;
    if (!v.state)
        return <Spinner label={m.loading}/>;
    if (v.state.error)
        return <Notice tone="danger">{v.state.error}<Button onPress={v.retry}>Retry</Button></Notice>;
    if (!v.view || !v.state.roles || !v.state.policies)
        return <Spinner label={m.loading}/>;
    return <RolesViewContext.Provider value={v.view}>
    <div className="page"><header><p>{m.people}</p><h1>{m.title}</h1><p>{m.description}</p></header>
      {!v.canManage ? <Notice>{m.readOnly}</Notice> : null}
      {/* Shared row errors and confirmation belong to the shell, because both tabs own writes. */}
      {v.state.rowError ? <Notice tone="danger">{v.state.rowError}</Notice> : null}
      {v.noTabs ? <Notice>No roles tabs are enabled.</Notice> : <Suspense fallback={<Spinner label={m.loading}/>}>
        <Tabs label={m.title} value={v.tab} items={v.items} onValueChange={v.changeTab}/>
      </Suspense>}
      <DestructiveDialog {...v.confirm}/>
    </div>
  </RolesViewContext.Provider>;
}
