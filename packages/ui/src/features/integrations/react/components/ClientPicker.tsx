import { useRef, useState } from 'react';
import { agentHandleProps, agentSubHandle, buildAgentListHandles } from '@jini-ai/agentic';
import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { useDismissOnOutsideOrEscape } from '../../../../browser/useDismissOnOutsideOrEscape.js';
import type { McpClientDescriptor, McpClientId } from '../../types.js';

export interface ClientPickerProps {
  clients: readonly McpClientDescriptor[];
  selectedClientId: McpClientId;
  onSelect: (clientId: McpClientId) => void;
  /** Method sub-label shown under the selected client's name (e.g. "CLI
   *  command" / "JSON config") — purely presentational, host-supplied so it
   *  can vary by fetched install info. */
  methodLabel?: string | undefined;
  /**
   * Per-client method sub-label shown next to every entry in the dropdown
   * list (not just the selected one) — origin: `info ? c.buildMethod(info)
   * : ''` rendered for each `MCP_CLIENTS` row in `IntegrationsSection`'s
   * `ds-picker-popover`. Keyed by client id, pre-resolved text (same
   * contract as `methodLabel` — this component does not call `t()` on it).
   * A client with no entry (e.g. `methodLabels` omitted entirely, or `info`
   * not loaded yet) renders no sub-label for that row, matching the
   * original's blank-until-loaded gate.
   */
  methodLabels?: Readonly<Partial<Record<McpClientId, string>>> | undefined;
  /** This picker's own agent handle. The trigger button and each dropdown option get their own
   *  derived sub-handle — see `IntegrationsTab`'s `agentHandle` doc. */
  agentHandle?: string;
}

/**
 * Dropdown client picker. Origin: the `ds-picker` markup inline in
 * `IntegrationsSection` — closes on outside click or Escape.
 */
export function ClientPicker({ clients, selectedClientId, onSelect, methodLabel, methodLabels, agentHandle }: ClientPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = clients.find((c) => c.id === selectedClientId) ?? clients[0];
  const optionHandles = agentHandle
    ? buildAgentListHandles(agentSubHandle(agentHandle, 'option'), clients.map((c) => c.id))
    : undefined;

  // Close on outside click or Escape — routed through the shared
  // `useDismissOnOutsideOrEscape` toolbox hook (packages/ui/src/browser/)
  // instead of a hand-rolled listener pair; the origin used `mousedown`,
  // the shared hook uses `pointerdown` (matching every other real
  // popover/dropdown call site — see that hook's own doc comment), a
  // behaviorally-equivalent upgrade for this same dismiss-on-outside-click
  // pattern.
  useDismissOnOutsideOrEscape(() => setOpen(false), { enabled: open, containerRef: rootRef });

  return (
    <div className="jini-picker" ref={rootRef}>
      <button
        type="button"
        className={`jini-picker-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...agentHandleProps(agentHandle, { action: 'trigger', role: 'button', label: selected ? t(selected.label) : t('Client') })}
      >
        <span className="jini-picker-meta">
          <span className="jini-picker-title">{selected ? t(selected.label) : ''}</span>
          {methodLabel ? <span className="jini-picker-sub">{methodLabel}</span> : null}
        </span>
        <Icon name="chevron-down" size={14} className="jini-picker-chevron" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open ? (
        <div className="jini-picker-popover" role="listbox">
          <div className="jini-picker-list">
            {clients.map((client, index) => {
              const active = client.id === selectedClientId;
              return (
                <button
                  key={client.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`jini-picker-item${active ? ' active' : ''}`}
                  onClick={() => {
                    onSelect(client.id);
                    setOpen(false);
                  }}
                  {...agentHandleProps(optionHandles?.[index], { role: 'button', label: t(client.label) })}
                >
                  <span className="jini-picker-item-title">{t(client.label)}</span>
                  {methodLabels?.[client.id] ? (
                    <span className="jini-picker-item-sub">{methodLabels[client.id]}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
