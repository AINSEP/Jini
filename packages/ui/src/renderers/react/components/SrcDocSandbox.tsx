/**
 * Renders artifact HTML inside a sandboxed, isolated-origin iframe.
 *
 * Treats `html` as hostile by construction: `sandbox="allow-scripts
 * allow-popups allow-popups-to-escape-sandbox"` deliberately omits
 * `allow-same-origin`, so the document gets a unique opaque origin with no
 * access to this page's storage/cookies/DOM even though scripts run; a
 * strict Content-Security-Policy is injected by `buildSrcDoc` (see
 * `DEFAULT_SRC_DOC_CSP`); and no bridge/postMessage listener is installed
 * ambiently — a host opts in via `options.bridges` (see `srcdoc/bridge.ts`).
 */
import { useEffect, useMemo, useRef } from 'react';
import { buildSrcDoc, type BuildSrcDocOptions } from '../../srcdoc/build.js';
import { useT } from '../i18n.js';

export interface SrcDocSandboxProps {
  /** Raw (untrusted) artifact HTML — either a full document or a fragment. */
  html: string;
  options?: BuildSrcDocOptions | undefined;
  /** Accessible iframe title. Defaults to a translated "Artifact preview". */
  title?: string | undefined;
  className?: string | undefined;
  /** Messages posted by the sandboxed document to this window (e.g. a bridge reply). Origin is intentionally not checked — see `srcdoc/build.ts`'s selection-bridge security note in `source-map.md`; sandboxing contains the blast radius, not origin checks. */
  onMessage?: ((data: unknown) => void) | undefined;
}

export function SrcDocSandbox({ html, options, title, className, onMessage }: SrcDocSandboxProps) {
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => buildSrcDoc(html, options), [html, options]);

  useEffect(() => {
    if (!onMessage) return undefined;
    const iframe = iframeRef.current;
    const handler = (event: MessageEvent) => {
      if (!iframe || event.source !== iframe.contentWindow) return;
      onMessage(event.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMessage]);

  return (
    <iframe
      ref={iframeRef}
      title={title ?? t('Artifact preview')}
      srcDoc={srcDoc}
      className={className}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  );
}
