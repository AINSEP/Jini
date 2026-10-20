import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { KitProvider } from '@jini-ai/ui-kit/react';
import { membersKitNeeds } from '../index.js';
import { MembersViewContext } from '../hooks/MembersPage.hooks.js';
import type { MembersView } from '../hooks/MembersPage.hooks.js';
import { MemberRow } from '../components/MemberRow.js';
import { createMembersController } from '../../controllers/members.controller.js';
import type { AdminMember, MemberRowState, MembersState } from '../../models.js';
import { member, memberApi } from '../../__tests__/people.fixtures.js';

afterEach(cleanup);

const quietRow: MemberRowState = { disabling: false, resending: false, error: null, notice: null };

// A real controller over the memory adapter; only the snapshot and the per-row state are pinned,
// so each test drives exactly one branch of the row's markup.
function mount({ state = {}, row = quietRow, canManage = false, subject = member }: { state?: Partial<MembersState>; row?: MemberRowState; canManage?: boolean; subject?: AdminMember } = {}) {
  const real = createMembersController({ api: memberApi() }, { permissions: ['member.manage'] });
  const toggleDetail = vi.fn(async () => {});
  const controller = { ...real, stateFor: () => row, toggleDetail };
  const view: MembersView = { controller, state: { ...real.getSnapshot({}), ...state }, canManage };
  render(<KitProvider needs={[membersKitNeeds]} guard="off"><MembersViewContext.Provider value={view}><table><tbody><MemberRow member={subject}/></tbody></table></MembersViewContext.Provider></KitProvider>);
  return { toggleDetail };
}

describe('MemberRow (pins)', () => {
  it('renders email, name, status and created date with no menu when the caller cannot manage', () => {
    mount();
    expect(screen.getByRole('button', { name: 'member@example.test' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for member/ })).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('shows an em dash for a member without a name', () => {
    mount({ subject: { ...member, name: undefined } });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the actions menu when the caller can manage', () => {
    mount({ canManage: true });
    expect(screen.getByRole('button', { name: 'Actions for member "member@example.test"' })).toBeInTheDocument();
  });

  it('shows a row error as a danger notice', () => {
    mount({ row: { ...quietRow, error: 'Resend failed.' } });
    expect(screen.getByText('Resend failed.')).toBeInTheDocument();
  });

  it('shows a row notice', () => {
    mount({ row: { ...quietRow, notice: 'Sign-in link sent.' } });
    expect(screen.getByText('Sign-in link sent.')).toBeInTheDocument();
  });

  it('toggles the detail through the email button', () => {
    const { toggleDetail } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'member@example.test' }));
    expect(toggleDetail).toHaveBeenCalledWith({ id: 'm' });
  });

  it('an expanded row with a loading detail shows the spinner', () => {
    mount({ state: { expandedId: 'm', detailLoadingId: 'm' } });
    expect(screen.getByRole('button', { name: 'member@example.test' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Loading detail…')).toBeInTheDocument();
  });

  it('an expanded row with a detail error shows that error', () => {
    mount({ state: { expandedId: 'm', detailError: 'Detail unavailable.' } });
    expect(screen.getByText('Detail unavailable.')).toBeInTheDocument();
  });

  it('an expanded row with a loaded detail lists id, verification, update time and version', () => {
    mount({ state: { expandedId: 'm', detailById: { m: { ...member, emailVerifiedAt: '2026-02-02', updatedAt: '2026-03-03', version: 7 } } } });
    const terms = screen.getAllByRole('term').map(t => t.textContent);
    expect(terms).toEqual(['ID', 'Email verified', 'Updated', 'Version']);
    expect(screen.getAllByRole('definition').map(d => d.textContent)).toEqual(['m', '2026-02-02', '2026-03-03', '7']);
  });

  it('an unverified loaded detail says not verified', () => {
    mount({ state: { expandedId: 'm', detailById: { m: member } } });
    expect(screen.getByText('not verified')).toBeInTheDocument();
  });

  it('an expanded row with no detail yet renders an empty detail cell', () => {
    mount({ state: { expandedId: 'm' } });
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.textContent).toBe('');
  });
});
