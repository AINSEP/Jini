import { Notice } from '@jini-ai/ui-kit/react';
import { useMembersView } from '../hooks/MembersPage.hooks.js';
import { MemberRow } from '../components/MemberRow.js';
export default function MembersTab(_props: { readonly params?: Readonly<Record<string, unknown>> } = {}, _optional: Record<string, never> = {}) {
  const v = useMembersView({});
  return <section aria-label="Members">{v.state.members?.length === 0 ? <Notice>No members yet. Registered members will show up here.</Notice> : <table><thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
    <tbody>{v.state.members?.map(member => <MemberRow key={member.id} member={member}/>)}</tbody></table>}</section>;
}
