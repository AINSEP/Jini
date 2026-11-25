import { useState, type ReactNode } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";

import { t } from "./email-i18n.js";
import type { LoadView } from "./hooks/email-load.hooks.js";

/**
 * @file Small pieces every Email tab shares: the status chip, the titled card, the read-state line
 * and a copy button. The segmented pill (`Segments`) is the host's, since it wraps the host's chat UI control. Markup only; type comes from the shared `.jini-*` and `.status` classes.
 */

export type Tone = "ok" | "warning" | "neutral" | "error";

export function Chip(props: { tone: Tone; children: ReactNode }) {
  // `.status-error` is the shared red chip; the others are the existing tones.
  return <span className={`status status-${props.tone}`}>{props.children}</span>;
}

/**
 * One titled card; `id` doubles as the in-page anchor within its tab. `hideTitle` drops the visible
 * heading where the selected tab or segment already says the same words (owner, 2026-10-22: "all
 * the subtabs have duplicate titles"); the title stays the region's accessible name.
 */
export function Section(props: { id: string; title: string; hideTitle?: boolean; actions?: ReactNode; children: ReactNode }) {
  const named = props.hideTitle ? { "aria-label": props.title } : { "aria-labelledby": `email-${props.id}-title` };
  return (
    <section id={props.id} className={`jini-settings-section email-section${props.hideTitle ? " email-section-untitled" : ""}`} {...named}>
      <div className="jini-settings-section-card email-card">
        {props.hideTitle && !props.actions ? null : (
          <div className="email-card-head">
            {props.hideTitle ? null : <h2 className="jini-byok-card-title" id={`email-${props.id}-title`}>{props.title}</h2>}
            {props.actions}
          </div>
        )}
        {props.children}
      </div>
    </section>
  );
}

/**
 * The loading / 403 / failed line for a read that has not loaded; renders `children(data)` once it
 * has. A failed read says so and offers Retry when given one — never an empty list.
 */
export function Loaded<T>(props: { view: LoadView<T>; locale: string; retry?: () => void; children: (data: T) => ReactNode }) {
  const { view, locale } = props;
  if (view.kind === "loaded") return <>{props.children(view.data)}</>;
  if (view.kind === "loading") return <p className="jini-field-hint" role="status">{t({ locale, key: "Loading…" })}</p>;
  if (view.kind === "forbidden") return <p className="jini-field-hint">{t({ locale, key: "You don't have permission to see this." })}</p>;
  return (
    <div className="email-row" role="alert">
      <Chip tone="warning">{t({ locale, key: "Couldn't load" })}</Chip>
      <span className="jini-field-hint">{t({ locale, key: view.message })}</span>
      {props.retry ? <button type="button" className="btn-secondary" onClick={props.retry}>{t({ locale, key: "Retry" })}</button> : null}
    </div>
  );
}

/** Copies `text`; says "Copied" for a moment. `label` names what is copied for screen readers. */
export function CopyButton(props: { text: string; label: string; locale: string; handle: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary email-copy"
      aria-label={`${t({ locale: props.locale, key: "Copy" })}: ${props.label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(props.text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }, () => {});
      }}
      {...agentHandle({ handle: props.handle }, { role: "button", label: `Copy ${props.label}` })}
    >
      {copied ? t({ locale: props.locale, key: "Copied" }) : t({ locale: props.locale, key: "Copy" })}
    </button>
  );
}

/** A local date-time for an ISO stamp; the raw text when it does not parse. Pure. */
export function when({ iso, locale }: { iso: string; locale: string }, _options = {}): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
