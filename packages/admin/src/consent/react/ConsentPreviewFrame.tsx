import { useConsentPreviewWidth, type ConsentPreviewWidth } from './settings-panel.hooks.js';

export interface ConsentPreviewFrameProps {
  /** The engine-gated page; `null` while it loads or when the host could not render it. */
  html: string | null;
  /** Shown in place of the frame while `html` is null. */
  status?: string;
  initialWidth?: ConsentPreviewWidth;
  dictionary?: Readonly<Record<string, string>>;
}

const WIDTHS: readonly { id: ConsentPreviewWidth; label: string }[] = [{ id: 'phone', label: 'Phone' }, { id: 'desktop', label: 'Desktop' }];

/** The real rendered page with the banner, inert. The HTML is only ever the `srcdoc` of an iframe
 * with an empty `sandbox`: no scripts, forms, popups or same-origin access, and it never enters the
 * host DOM. Phone is 320px, the narrowest width the banner must still work at. */
export function ConsentPreviewFrame({ html, status = '', initialWidth = 'desktop', dictionary = {} }: ConsentPreviewFrameProps) {
  const t = (text: string) => dictionary[text] ?? text;
  const { width, setWidth } = useConsentPreviewWidth({ initial: initialWidth });
  return <section className="jini-consent-preview" aria-label={t('Banner preview')}>
    <div className="jini-consent-preview-widths" role="group" aria-label={t('Preview width')}>
      {WIDTHS.map(option => <button key={option.id} type="button" className="jini-btn-secondary" aria-pressed={width === option.id} onClick={() => setWidth(option.id)}>{t(option.label)}</button>)}
    </div>
    {html === null
      ? <p className="jini-hint jini-consent-preview-empty">{status}</p>
      : <iframe className={`jini-consent-preview-frame is-${width}`} title={t('Banner preview')} sandbox="" srcDoc={html} style={{ width: width === 'phone' ? '320px' : '100%' }} />}
  </section>;
}
