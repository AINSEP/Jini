import type { ButtonHTMLAttributes, ElementType } from 'react';

export function ChatCleanupDialog({ useChatCleanup, kit: { Button }, copy, onDone }: {
  useChatCleanup: () => {
    state: 'preview' | 'confirm' | 'partial' | 'expired'; previewToken?: string; count: number; bytes: number;
    kept: readonly { id: string; title: string | null; reason: string }[];
    preview: () => void; choose: () => void;
    apply: (required: { previewToken: string; confirm: true }) => Promise<{ complete: boolean }>;
  };
  kit: { Button: ElementType<ButtonHTMLAttributes<HTMLButtonElement>> };
  copy: { preview: string; confirm: string; expired: string; choose: string; partial: string; count: (required: { count: number; bytes: number }) => string };
  onDone: () => void;
}, _optional = {}) {
  const cleanup = useChatCleanup();
  return <div role="dialog">
    {cleanup.state === 'preview' ? <Button type="button" onClick={cleanup.preview}>{copy.preview}</Button> : null}
    {cleanup.state === 'expired' ? <><p>{copy.expired}</p><Button type="button" onClick={cleanup.choose}>{copy.choose}</Button></> : null}
    {cleanup.state === 'confirm' || cleanup.state === 'partial' ? <>
      <p>{copy.count({ count: cleanup.count, bytes: cleanup.bytes })}</p>
      {cleanup.state === 'partial' ? <p>{copy.partial}</p> : null}
      <ul>{cleanup.kept.map(item => <li key={item.id}>{item.title}: {item.reason}</li>)}</ul>
      <Button type="button" disabled={!cleanup.previewToken} onClick={async () => {
        if (!cleanup.previewToken) return;
        const result = await cleanup.apply({ previewToken: cleanup.previewToken, confirm: true });
        if (result.complete) onDone();
      }}>{copy.confirm}</Button>
    </> : null}
  </div>;
}
