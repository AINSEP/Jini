import { useEffect, useState } from 'react';

export type HtmlPreviewPort = (input: { source: string }, options: { signal: AbortSignal }) => Promise<string>;
export interface HtmlPreviewState { document: string; loading: boolean; error: string | null }

/** Debounces an unsaved source through the host's renderer; cleanup cancels timers and ignores
 * responses even when the transport cannot abort. No rendering policy belongs to this hook.
 * @returns The last successful document and one-line request state.
 * @complexity O(1) per source change, excluding the injected renderer's cost.
 */
export function useDebouncedHtmlPreview(
  { source, render }: { source: string; render: HtmlPreviewPort },
  { revision = '', delayMs = 400 }: { revision?: string; delayMs?: number } = {},
): HtmlPreviewState {
  // `settled` names the source+revision the stored result belongs to, so `loading` and a stale
  // error are derived during render. Setting state from the effect on every keystroke left a
  // pending update after each commit, and ~50 fast keystrokes then tripped React's nested-update
  // limit, which dropped that keystroke from the host's controlled input.
  const key = JSON.stringify([source, revision]);
  const [state, setState] = useState<{ document: string; error: string | null; settled: string | null }>({ document: '', error: null, settled: null });
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // Promise.resolve also maps a synchronously throwing host adapter to the error state.
      void Promise.resolve().then(() => render({ source }, { signal: controller.signal })).then(
        document => { if (current) setState({ document, error: null, settled: key }); },
        () => { if (current) setState(previous => ({ ...previous, error: 'Preview unavailable.', settled: key })); },
      );
    }, delayMs);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [key, source, render, delayMs]);
  const settled = state.settled === key;
  return { document: state.document, loading: !settled, error: settled ? state.error : null };
}
