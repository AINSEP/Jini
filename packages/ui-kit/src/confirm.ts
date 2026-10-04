import type { AgentSpec } from './attrs.js';
export type ConfirmTone = 'default' | 'warning' | 'danger';
export type DismissReason = 'cancel-button' | 'escape' | 'backdrop' | 'close';
export interface ConfirmInput {
  readonly open: boolean; readonly title: string; readonly confirmLabel: string;
  readonly cancelLabel?: string; readonly tone?: ConfirmTone; readonly pending?: boolean;
  readonly consequence?: string; readonly agentHandle?: string; readonly agentMayConfirm?: boolean;
}
export function planConfirm(required: ConfirmInput, _optional: Record<string, never> = {}) {
  const pending = required.pending === true, tone = required.tone ?? 'default';
  const consequence = required.consequence?.trim() || (tone === 'danger' ? 'cannot be undone' : tone === 'warning' ? 'changes access, but is reversible' : undefined);
  const confirmLabel = `${required.confirmLabel} — ${required.title}${consequence ? `; ${consequence}` : ''}`;
  const cancelLabel = required.cancelLabel ?? 'Cancel';
  const agent = (action: string, label: string): AgentSpec | undefined => required.agentHandle === undefined ? undefined :
    { handle: `${required.agentHandle}-${action}`, role: 'button', label };
  return Object.freeze({ initialFocus: 'cancel' as const, pending, dismissible: required.open && !pending,
    cancelDisabled: pending, confirmDisabled: pending, cancelLabel, confirmLabel, consequence,
    confirmVariant: tone === 'default' ? 'primary' as const : tone,
    cancel: agent('cancel', `${cancelLabel} — leaves "${required.title}" unconfirmed; no action taken`),
    confirm: required.agentMayConfirm === false ? undefined : agent('confirm', confirmLabel) });
}
/** Reads current policy on every invocation, so stale view callbacks cannot bypass a pending update. */
export function createConfirmController(required: {
  read: (required: Record<string, never>, optional?: Record<string, never>) => ConfirmInput;
  onConfirm: (required: Record<string, never>, optional?: Record<string, never>) => void | Promise<void>;
  onCancel: (required: Record<string, never>, optional?: Record<string, never>) => void;
}, _optional: Record<string, never> = {}) {
  let executing = false;
  return Object.freeze({
    requestDismiss(_required: { reason: DismissReason }, _optional: Record<string, never> = {}): boolean {
      if (executing || !planConfirm(required.read({})).dismissible) return false;
      required.onCancel({}); return true;
    },
    async confirm(input: { actor?: 'human' | 'agent' } = {}, _optional: Record<string, never> = {}): Promise<boolean> {
      const policy = required.read({});
      if (executing || !policy.open || policy.pending || (input.actor === 'agent' && policy.agentMayConfirm === false)) return false;
      // Set synchronously before calling the port: two clicks in one React frame must not execute twice.
      executing = true;
      try { await required.onConfirm({}); return true; } finally { executing = false; }
    },
    isExecuting(_required: Record<string, never>, _optional: Record<string, never> = {}): boolean { return executing; },
  });
}
