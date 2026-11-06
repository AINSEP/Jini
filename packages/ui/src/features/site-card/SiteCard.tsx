import type { HTMLAttributes, ReactNode } from "react";

/**
 * @file One site's card, shared by the desktop app's Websites grid and the web admin's Sites page
 * (owner, 2026-11-04). Layout only: a preview tile, then a head grid (name | menu, details | status),
 * then the action row, in the desktop's shape. Each host fills the slots with its own controls, so
 * what a button does stays with the host. Grid auto-placement fills the head in DOM order, so the
 * order below IS the layout and also the Tab order.
 */

export type SiteCardTone = "neutral" | "running" | "busy" | "warning" | "danger";

export interface SiteCardProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  name: string;
  /** Under the name in the same cell, e.g. a duplicate name's parent folder. */
  nameDetail?: ReactNode;
  /** The last captured picture of the site; a neutral placeholder without one. */
  previewSrc?: string | null | undefined;
  onPreviewError?: (() => void) | undefined;
  /** Beside the name, before the menu. */
  nameExtra?: ReactNode;
  /** Top-right, level with the name. */
  menu?: ReactNode;
  /** Muted line under the name. */
  details?: ReactNode;
  /** Right-aligned under the menu; usually a {@link SiteCardStatus}. */
  status?: ReactNode;
  /** Anything else the card says, on full-width lines below the head. */
  notes?: ReactNode;
  /** The row of buttons under the text. Hidden when empty. */
  actions?: ReactNode;
  /** A panel covering the card, e.g. a confirmation. */
  overlay?: ReactNode;
}

/** The placeholder keeps the tile's shape and tells nothing false about the site. @complexity O(1). */
function SiteCardTile({ previewSrc, onPreviewError }: Pick<SiteCardProps, "previewSrc" | "onPreviewError">) {
  // Decorative: the name right below already says which site this is.
  return (
    <div className="jini-site-card__tile" aria-hidden="true">
      {previewSrc ? (
        <img className="jini-site-card__preview" src={previewSrc} alt="" loading="lazy" decoding="async" onError={onPreviewError} />
      ) : (
        <svg className="jini-site-card__placeholder" viewBox="0 0 48 36" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="1" width="46" height="34" rx="4" />
          <path d="M1 9h46M7 5h.01M11 5h.01M15 5h.01M9 17h30M9 23h20" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

/** The whole card; extra attributes (click target, title, role) go on the `<article>`. @complexity O(1). */
export function SiteCard({ name, nameDetail, previewSrc, onPreviewError, nameExtra, menu, details, status, notes, actions, overlay, className, ...article }: SiteCardProps) {
  return (
    <article {...article} className={className ? `jini-site-card ${className}` : "jini-site-card"}>
      <SiteCardTile previewSrc={previewSrc} onPreviewError={onPreviewError} />
      <div className="jini-site-card__body">
        <div className="jini-site-card__head">
          <div className="jini-site-card__namewrap">
            <div className="jini-site-card__nameline">
              <h3 className="jini-site-card__name" title={name}>{name}</h3>
              {nameExtra}
            </div>
            {nameDetail}
          </div>
          <div className="jini-site-card__menu">{menu}</div>
          <div className="jini-site-card__details">{details}</div>
          <div className="jini-site-card__meta">{status}</div>
          {notes}
        </div>
        {actions}
      </div>
      {overlay}
    </article>
  );
}

/** A dot and a word, tinted by tone. @complexity O(1). */
export function SiteCardStatus({ label, tone = "neutral", title }: { label: ReactNode; tone?: SiteCardTone; title?: string | undefined }) {
  return (
    <span className={`jini-site-card__status jini-site-card__status--${tone}`} title={title}>
      <span className="jini-site-card__status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
