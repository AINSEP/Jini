import type { SiteToast as SiteToastValue } from './use-site-toast.hooks.js';

/** The toast's visible and spoken words; product copy comes from the host. */
export interface SiteToastLabels { showList: string; dismiss: string }

/** Host classes added beside the toast's own `jini-site-toast*` classes. */
export interface SiteToastClassNames { root?: string; message?: string; note?: string; items?: string; dismiss?: string }

export interface SiteToastProps {
  /** The value from the host's `useSiteToast` state; `null` renders nothing. */
  toast: SiteToastValue | null;
  onDismiss: () => void;
  labels: SiteToastLabels;
  classNames?: SiteToastClassNames;
}

const join = (own: string, host: string | undefined) => (host ? `${own} ${host}` : own);

/** The "new site" toast. It renders over a site's tab too, which is where an import lands. */
export function SiteToast({ toast, onDismiss, labels, classNames = {} }: SiteToastProps) {
  if (toast === null) return null;
  return (
    <div className={join('jini-site-toast', classNames.root)} role="status">
      <div>
        <p className={join('jini-site-toast__message', classNames.message)}>{toast.message}</p>
        {toast.note && <p className={join('jini-site-toast__note', classNames.note)}>{toast.note}</p>}
        {toast.items && (
          <details className={join('jini-site-toast__items', classNames.items)}>
            <summary>{labels.showList}</summary>
            <ul>{toast.items.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>
        )}
      </div>
      <button type="button" className={join('jini-site-toast__dismiss', classNames.dismiss)} aria-label={labels.dismiss} onClick={onDismiss}>×</button>
    </div>
  );
}
