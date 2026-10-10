import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, renderHook, waitFor } from '../../__tests__/fetch-query-support.js';
import { expect, it } from 'vitest';
import { createFakeMembersPort } from '../../testing.js';
import { useMembers } from '../hooks/use-members.hooks.js';
import type { AdminMember } from '../../models.js';

it('keeps disable pending until the authoritative roster is refreshed', async () => {
  const member: AdminMember = { id: 'm1', workspaceId: 'ws1', name: 'Example', email: 'example@example.com', status: 'active',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', version: 1 };
  const port = createFakeMembersPort({}, { members: [member] });
  const { result } = renderHook(() => useMembers({ port, translate: key => key }));
  await waitFor(() => expect(result.current.members).toEqual([member]));
  let finish!: (value: { members: AdminMember[] }) => void;
  let readStarted = false;
  port.listMembers = () => { readStarted = true; return new Promise(done => { finish = done; }); };
  act(() => result.current.setConfirmingDisable(member));
  let completed = false;
  let action!: Promise<void>;
  act(() => { action = result.current.confirmDisable().then(() => { completed = true; }); });
  await waitFor(() => expect(readStarted).toBe(true));
  expect(completed).toBe(false);
  expect(result.current.stateFor({ id: 'm1' }).disabling).toBe(true);
  await act(async () => { finish({ members: [{ ...member, status: 'disabled' }] }); await action; });
  await waitFor(() => expect(result.current.members?.[0]?.status).toBe('disabled'));
  expect(result.current.stateFor({ id: 'm1' }).disabling).toBe(false);
  expect(result.current.stateFor({ id: 'm1' }).notice).toBe('Member disabled.');
});

it('keeps entity-scoped failure and superseded-spinner rationale beside their code', () => {
  const source = readFileSync(path.resolve(__dirname, '../hooks/use-members.hooks.ts'), 'utf8');
  expect(source).toContain('// Only paint the failure onto the panel that is still expanded: the observer\'s entity key\n  // selects the current row, so a late rejection for a collapsed row cannot surface here.\n  const detailError =');
  expect(source).toContain('// A superseded load leaves the spinner to its successor. Derive it from the current keyed\n  // observer instead of letting an old request\'s finally clear the new row\'s loading state.\n  const detailLoadingId =');
  expect(source).not.toContain('Read-lifecycle rationale retained from the preceding implementation');
});


it('preserves an accepted disable and its detail while the roster and detail refreshes fail', async () => {
  const member: AdminMember = { id: 'm-refresh', workspaceId: 'ws1', name: 'Example', email: 'example@example.com', status: 'active',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', version: 1 };
  const port = createFakeMembersPort({}, { members: [member] });
  const { result } = renderHook(() => useMembers({ port, translate: key => key }));
  await waitFor(() => expect(result.current.members).toEqual([member]));
  await act(async () => { await result.current.onToggleDetail(member); });
  expect(result.current.detailById[member.id]?.status).toBe('active');
  port.listMembers = async () => { throw new Error('Member roster refresh failed'); };
  port.getMember = async () => { throw new Error('Member detail refresh failed'); };
  act(() => result.current.setConfirmingDisable(member));
  await act(async () => { await result.current.confirmDisable(); });
  await waitFor(() => expect(result.current.error).toBe('Member roster refresh failed'));
  expect(result.current.stateFor({ id: member.id })).toMatchObject({ disabling: false, error: null, notice: 'Member disabled.' });
  expect(result.current.detailById[member.id]?.status).toBe('disabled');
  expect(result.current.confirmingDisable).toBeNull();
});
