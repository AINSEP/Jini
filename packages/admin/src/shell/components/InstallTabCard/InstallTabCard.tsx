import type { ChangeEvent, FormEvent, ReactNode, RefObject } from "react";

import type { ZipDropController } from "./use-zip-drop.hooks.js";

/**
 * @file The one "Add a …" tab card Skills, Agent Plugins and Plugins all install through (owner,
 * 2026-10-06: one pattern, modelled on Skills' "Add a skill" card). Props and JSX only; each page's
 * own hook owns its state, validation and upload.
 *
 * Shape: a `.card` with a `.card-title` ("Add a skill" / "Add a plugin"), an optional lead line,
 * then one {@link InstallTabOption} per way to install — a field row ({@link InstallTabFieldRow}),
 * a drop zone ({@link ZipDropZone}), or plain buttons.
 */
export function InstallTabCard({ titleId, title, lede, children }: { titleId: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section className="card jini-install-tab-card" aria-labelledby={titleId}>
      <h2 id={titleId} className="card-title">{title}</h2>
      {lede ? <p className="card-lead">{lede}</p> : null}
      {children}
    </section>
  );
}

/** One way to install. `badge` marks an option that is shown but not available yet ("Coming soon"). */
export function InstallTabOption({ heading, badge, hint, children }: { heading?: string; badge?: string; hint?: string; children?: ReactNode }) {
  return (
    <div className={`jini-install-tab-option${badge ? " is-soon" : ""}`}>
      {heading ? (
        <h3 className="jini-install-tab-option-heading">
          {heading}
          {badge ? <span className="jini-install-tab-badge">{badge}</span> : null}
        </h3>
      ) : null}
      {hint ? <p className="field-hint">{hint}</p> : null}
      {children}
    </div>
  );
}

/** A labelled text field with an optional button beside it — Skills' "GitHub URL" row. A form, so
 *  Enter submits the same way the button does. */
export function InstallTabFieldRow({
  inputId,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  type = "text",
  action,
  onSubmit,
  inputProps,
  actionProps,
}: {
  inputId: string;
  label?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "url";
  /** The button beside the field; omitted when another control on the card acts on it. */
  action?: { label: string; disabled?: boolean; primary?: boolean };
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** Extra attributes for the input (agent handles). */
  inputProps?: Record<string, unknown>;
  /** Extra attributes for the submit button (agent handles). */
  actionProps?: Record<string, unknown>;
}) {
  return (
    <form className="jini-install-tab-field" onSubmit={onSubmit ?? ((event) => event.preventDefault())}>
      {label ? <label className="field-label" htmlFor={inputId}>{label}</label> : null}
      <div className="jini-install-tab-field-controls">
        <input id={inputId} type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} aria-label={label ? undefined : placeholder} {...inputProps} />
        {action ? (
          <button type="submit" className={action.primary ? "btn-primary" : "btn-secondary"} disabled={action.disabled} {...actionProps}>
            {action.label}
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** A disclosure for a rarely needed way to install (Plugins' server path), closed by default so it
 *  does not compete with the upload. `hint` says what the field is in plain words. */
export function InstallTabAdvanced({ summary, hint, children, summaryProps }: { summary: string; hint: string; children: ReactNode; summaryProps?: Record<string, unknown> }) {
  return (
    <details className="jini-install-tab-advanced">
      <summary {...summaryProps}>{summary}</summary>
      <p className="field-hint">{hint}</p>
      {children}
    </details>
  );
}

/** "Choose a folder" beside "Choose a file": a hidden folder picker (`webkitdirectory`) whose files
 *  the page zips and treats as a chosen `.zip` (`use-folder-upload.hooks.ts`). */
export interface ZipDropZoneFolder {
  label: string;
  inputLabel: string;
  onChoose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Extra attributes for the choose-folder button (agent handles). */
  chooseProps?: Record<string, unknown>;
  inputProps?: Record<string, unknown>;
}

/** A styled drop target for one package file, with a "Choose a file" button opening a hidden
 *  picker — never the browser's raw file input — and, when `folder` is set, "Choose a folder". */
export function ZipDropZone({
  drop,
  glyph,
  title,
  hint,
  busy,
  chooseLabel,
  onChoose,
  inputRef,
  inputLabel,
  onFileChange,
  chooseProps,
  dropProps,
  fileProps,
  folder,
}: {
  drop: ZipDropController;
  glyph: ReactNode;
  title: string;
  hint: string;
  busy: boolean;
  chooseLabel: string;
  onChoose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  inputLabel: string;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Extra attributes for the choose button (agent handles). */
  chooseProps?: Record<string, unknown>;
  dropProps?: Record<string, unknown>;
  fileProps?: Record<string, unknown>;
  folder?: ZipDropZoneFolder;
}) {
  return (
    <>
      <div
        className={`jini-install-tab-dropzone${drop.dragging ? " is-dragging" : ""}`}
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={drop.onDrop}
        aria-busy={busy}
        {...dropProps}
      >
        <span className="jini-install-tab-dropzone-glyph">{glyph}</span>
        <p className="jini-install-tab-dropzone-title">{title}</p>
        <p className="field-hint">{hint}</p>
        <div className="jini-install-tab-dropzone-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onChoose} {...chooseProps}>
            {chooseLabel}
          </button>
          {folder ? (
            <button type="button" className="btn-secondary" disabled={busy} onClick={folder.onChoose} {...folder.chooseProps}>
              {folder.label}
            </button>
          ) : null}
        </div>
      </div>
      <input ref={inputRef} type="file" accept=".zip,application/zip" hidden aria-label={inputLabel} onChange={onFileChange} {...fileProps} />
      {folder ? (
        <input ref={folder.inputRef} type="file" multiple hidden aria-label={folder.inputLabel} onChange={folder.onFilesChange} {...folder.inputProps} {...{ webkitdirectory: "" }} />
      ) : null}
    </>
  );
}
