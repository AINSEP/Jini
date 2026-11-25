import { agentHandle } from "@jini-ai/core/agent-handles";
import type { RefObject } from "react";

/** Shared confirmation markup; each caller retains its own dialog lifecycle and copy. */
export function ConfirmActionDialog({ dialogRef, titleId, title, body, extra, onCancel, onConfirm, cancelText, confirmText, cancelHandle, cancelAgentLabel, confirmHandle, confirmAgentLabel }: {
  dialogRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  title: string;
  body: string;
  extra?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  cancelText: string;
  confirmText: string;
  cancelHandle: string;
  cancelAgentLabel: string;
  confirmHandle: string;
  confirmAgentLabel: string;
}) {
  return (
    <div className="settings-dialog-backdrop" onClick={onCancel}>
      <div ref={dialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId}>{title}</h2>
        <p>{body}</p>
        {extra ? <p>{extra}</p> : null}
        <span className="editor-actions">
          <button type="button" className="btn-secondary" autoFocus onClick={onCancel} {...agentHandle({ handle: cancelHandle }, { role: "button", label: cancelAgentLabel })}>
            {cancelText}
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm} {...agentHandle({ handle: confirmHandle }, { role: "button", label: confirmAgentLabel })}>
            {confirmText}
          </button>
        </span>
      </div>
    </div>
  );
}
