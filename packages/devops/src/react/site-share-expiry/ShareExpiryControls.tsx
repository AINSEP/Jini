import type { ButtonHTMLAttributes, ChangeEvent, ElementType, SelectHTMLAttributes } from 'react';

export function ShareExpiryControls({ useShareExpiry, kit: { Button, Select }, copy, choices, status, expiresAt, showExpired = true }: {
  useShareExpiry: () => {
    expiresInDays?: 7 | 30 | 90 | null;
    change: (required: { expiresInDays: 7 | 30 | 90 | null }) => void;
    acknowledge: () => void;
    setShowExpired: (required: { showExpired: boolean }) => void;
  };
  kit: { Button: ElementType<ButtonHTMLAttributes<HTMLButtonElement>>; Select: ElementType<SelectHTMLAttributes<HTMLSelectElement>> };
  copy: { never: string; days: (days: 7 | 30 | 90) => string; expired: string; showExpired: string; acknowledge: string };
  choices: readonly (7 | 30 | 90)[]; status: string; expiresAt?: string | null; showExpired?: boolean;
}, _optional = {}) {
  const expiry = useShareExpiry();
  // An absent recipient URL is not evidence that a link is inactive.
  return <div>
    <Select aria-label={copy.never} value={expiry.expiresInDays ?? 'never'} onChange={(event: ChangeEvent<HTMLSelectElement>) => expiry.change({ expiresInDays: event.currentTarget.value === 'never' ? null : Number(event.currentTarget.value) as 7 | 30 | 90 })}>
      <option value="never">{copy.never}</option>
      {choices.map(days => <option key={days} value={days}>{copy.days(days)}</option>)}
    </Select>
    <label><input type="checkbox" checked={showExpired} onChange={event => expiry.setShowExpired({ showExpired: event.currentTarget.checked })} />{copy.showExpired}</label>
    {status === 'expired' ? <p>{copy.expired}</p> : null}
    {expiresAt ? <time dateTime={expiresAt}>{expiresAt}</time> : null}
    <Button type="button" onClick={expiry.acknowledge}>{copy.acknowledge}</Button>
  </div>;
}
