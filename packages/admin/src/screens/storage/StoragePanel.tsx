import type { ButtonHTMLAttributes, ElementType } from 'react';

export function StoragePanel({ useStorage, kit: { Button }, copy, links }: {
  useStorage: () => {
    phase: 'load' | 'ready' | 'dry-run' | 'outcomes' | 'confirm' | 'live' | 'done';
    classes: Record<'automatic' | 'yours' | 'shown', readonly { id: string; label: string; bytes: string }[]>;
    outcomes: readonly { id: string; label: string; outcome: string }[];
    canConfirm: boolean; lastAutomaticPass?: string; freed?: string; failures?: string; notice?: string;
    dryRun: () => void; confirm: () => void; cleanup: () => void;
  };
  kit: { Button: ElementType<ButtonHTMLAttributes<HTMLButtonElement>> };
  copy: { automatic: string; yours: string; shown: string; dryRun: string; confirm: string; clean: string; lastAutomaticPass: string; freed: string; failures: string };
  links: readonly { label: string; href: string }[];
}, _optional = {}) {
  const storage = useStorage();
  // Measurement comes before offering a destructive choice so the owner can review its scope.
  return <section>
    {(['automatic', 'yours', 'shown'] as const).map(kind => <section key={kind}>
      <h2>{copy[kind]}</h2>
      <ul>{storage.classes[kind].map(item => <li key={item.id}>{item.label}: {item.bytes}</li>)}</ul>
    </section>)}
    {storage.lastAutomaticPass === undefined ? null : <p>{copy.lastAutomaticPass}: {storage.lastAutomaticPass}</p>}
    <ul>{links.map(link => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}</ul>
    {storage.notice === undefined ? null : <p role="status">{storage.notice}</p>}
    <ul>{storage.outcomes.map(item => <li key={item.id}>{item.label}: {item.outcome}</li>)}</ul>
    <StorageAction Button={Button} storage={storage} copy={copy} />
    {storage.freed === undefined ? null : <p>{copy.freed}: {storage.freed}</p>}
    {storage.failures === undefined ? null : <p role="alert">{copy.failures}: {storage.failures}</p>}
  </section>;
}

/** The one phase-gated action button (dry run, confirm, or clean), or nothing. */
function StorageAction({ Button, storage, copy }: {
  Button: ElementType<ButtonHTMLAttributes<HTMLButtonElement>>;
  storage: Pick<ReturnType<Parameters<typeof StoragePanel>[0]['useStorage']>, 'phase' | 'canConfirm' | 'dryRun' | 'confirm' | 'cleanup'>;
  copy: { dryRun: string; confirm: string; clean: string };
}) {
  if (storage.phase === 'ready') return <Button type="button" onClick={storage.dryRun}>{copy.dryRun}</Button>;
  if (storage.phase === 'outcomes' && storage.canConfirm) return <Button type="button" onClick={storage.confirm}>{copy.confirm}</Button>;
  if (storage.phase === 'confirm' && storage.canConfirm) return <Button type="button" onClick={storage.cleanup}>{copy.clean}</Button>;
  return null;
}
