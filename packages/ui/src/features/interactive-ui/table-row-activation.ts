import type { KeyboardEvent } from 'react';

export type DataTableRowClick = (row: Record<string, unknown>, index: number) => void;

/** Props that make a table row act as a button when the host wires `onRowClick`. Enter/Space fire only for the row itself, never for a control inside it. */
export function clickableRowProps(
  { row, index }: { row: Record<string, unknown>; index: number },
  { onRowClick }: { onRowClick?: DataTableRowClick | undefined } = {},
): { onClick?: () => void; role?: 'button'; tabIndex?: number; onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void } {
  if (!onRowClick) return {};
  return {
    onClick: () => onRowClick(row, index), role: 'button', tabIndex: 0,
    onKeyDown: (event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRowClick(row, index); } },
  };
}
