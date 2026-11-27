import { fireEvent, render, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PublishContentReportRow } from '../../../publish/content/ui/PublishContentReportRow.js';
import type { PublishReportRow } from '../../../publish/content/ui/index.js';

type RowView = Parameters<typeof PublishContentReportRow>[0]['view'];

const page: PublishReportRow = {
  key: 'page:incoming', entityId: 'incoming', entityType: 'page', entityTypeLabel: 'Page', entityLabel: 'Travel guide',
  outcome: 'created', disposition: 'publish', dispositionLabel: 'Will publish', selectable: true, reason: null,
  appliesOnExecute: true, overwritable: false, retiresLabel: null, referencedByLabels: [],
  includedFor: [], usedByNote: null, trashes: false,
};

function fixture() {
  const onToggleRow = vi.fn();
  const onToggleOverwrite = vi.fn();
  const view: RowView = { showOverwriteColumn: true, selectedKeys: new Set(['page:incoming']), selectionEnabled: true,
    onToggleRow, carriedAlongKeys: new Set(), overwriteOfferKeys: new Set(), overwriteKeys: new Set(), onToggleOverwrite };
  const t = (key: string) => key === 'Publish' ? 'Publier' : key;
  return { onToggleRow, onToggleOverwrite, view, t };
}

it('binds the publish checkbox to the current row and disables it once selection is locked', () => {
  const f = fixture();
  const row = (view: RowView) => <table><tbody><PublishContentReportRow row={page} view={view} t={f.t} /></tbody></table>;
  const screen = render(row(f.view));
  const controls = within(screen.getByRole('row'));
  expect(screen.getByRole('row')).toHaveAttribute('data-entity-id', 'incoming');
  expect(controls.getByRole('cell', { name: 'Travel guide' })).toHaveAttribute('title', 'Travel guide');
  expect(controls.getByText('Will publish')).toHaveClass('status-active');
  const publish = controls.getByRole('checkbox', { name: 'Publier page Travel guide' });
  expect(publish).toBeChecked();
  fireEvent.click(publish);
  expect(f.onToggleRow).toHaveBeenCalledExactlyOnceWith({ key: 'page:incoming' });
  screen.rerender(row({ ...f.view, selectionEnabled: false, selectedKeys: new Set(), showOverwriteColumn: false }));
  expect(publish).not.toBeChecked();
  expect(publish).toBeDisabled();
  fireEvent.click(publish);
  expect(f.onToggleRow).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('cell')).toHaveLength(4);
});

it('shows dependency reasons on read-only carried rows and scopes overwrite to the offered conflict', () => {
  const f = fixture();
  const carried: PublishReportRow = { ...page, key: 'media:asset', entityId: 'asset', entityType: 'media', entityTypeLabel: 'Media',
    entityLabel: 'Coast photo', selectable: false, includedFor: ['page:incoming'], usedByNote: 'Used by Travel guide' };
  const clash: PublishReportRow = { ...page, key: 'page:clash', entityId: 'clash', entityLabel: 'About',
    outcome: 'blocked', disposition: 'skipped', dispositionLabel: 'Skipped', selectable: false, appliesOnExecute: false,
    overwritable: true, reason: 'Another page owns this address.', retiresLabel: 'Old about page', referencedByLabels: ['Main menu'] };
  const view: RowView = { ...f.view, carriedAlongKeys: new Set(['media:asset']), overwriteOfferKeys: new Set(['page:clash']) };
  const table = (state: RowView) => <table><tbody>
    <PublishContentReportRow row={carried} view={state} t={f.t} />
    <PublishContentReportRow row={clash} view={state} t={f.t} />
  </tbody></table>;
  const screen = render(table(view));
  const dependency = within(screen.getByRole('row', { name: /Coast photo/ }));
  const included = dependency.getByRole('checkbox', { name: 'Publier media Coast photo' });
  expect(included).toBeChecked();
  expect(included).toBeDisabled();
  expect(dependency.getByText('Used by Travel guide')).toBeVisible();
  expect(dependency.queryByRole('checkbox', { name: /Overwrite/ })).toBeNull();
  const conflict = within(screen.getByRole('row', { name: /Another page owns this address/ }));
  expect(conflict.queryByRole('checkbox', { name: /Publier/ })).toBeNull();
  const overwrite = conflict.getByRole('checkbox', { name: 'Overwrite on live: Old about page' });
  expect(overwrite).not.toBeChecked();
  expect(overwrite).toHaveAttribute('title', 'Old about page moves to Trash. Menu links follow: Main menu');
  fireEvent.click(overwrite);
  expect(f.onToggleOverwrite).toHaveBeenCalledExactlyOnceWith('page:clash');
  screen.rerender(table({ ...view, overwriteKeys: new Set(['page:clash']), carriedAlongKeys: new Set() }));
  expect(overwrite).toBeChecked();
  expect(included).not.toBeChecked();
});
