import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '../../../../utils/copy-to-clipboard.js';

/** Reset copied feedback for a changed snippet and clean up the feedback timer. */
export function useSnippetBlock({ snippet }: { snippet: string }, _options = {}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Reset the "Copied" badge whenever the snippet changes (e.g. the user
  // switched clients) — otherwise a stale green check sits next to a
  // snippet they haven't actually copied.
  useEffect(() => {
    setCopied(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [snippet]);

  // No `if (!snippet) return` guard here (the origin has one — see
  // `onCopy` inline in `IntegrationsSection`): the only caller is the copy
  // button below, which is already `disabled={!snippet}`, and a disabled
  // button never receives a click event at all (browsers don't dispatch
  // one, and jsdom matches — verified `fireEvent.click` on a disabled
  // button doesn't invoke its handler either). The origin's guard was a
  // dead duplicate of that same disablement; removed rather than carried
  // forward or tested around.
  async function onCopy() {
    const ok = await copyToClipboard({ text: snippet });
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return { copied, onCopy };
}
