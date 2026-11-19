import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { agentHandleProps } from '@jini-ai/core/agent-handles';
import { Icon } from './Icon.js';
import { resolveSelectPortalContainer } from './select-popover.js';
import type { CustomSelectProps, UseCustomSelectResult } from './CustomSelect.types.js';
import type { CustomSelectMenuPosition, CustomSelectOriginTheme } from './CustomSelect.js';
import type { AgentControlProps } from '../hooks/useAgentHandle.js';

/** Inline geometry for a portalled menu once it has been measured; an inline menu is laid out by CSS. */
function customSelectMenuStyle({ portal, position }: {
  portal: boolean; position: CustomSelectMenuPosition | null;
}): CSSProperties | undefined {
  return portal && position
    ? {
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }
    : undefined;
}

/** Where an open menu renders: inline, or portalled only after its first measurement. */
function mountCustomSelectMenu({ menu, portal, position, trigger }: {
  menu: ReactNode; portal: boolean; position: CustomSelectMenuPosition | null; trigger: HTMLElement | null;
}, { container, fallbackContainer }: { container?: Element | DocumentFragment | null | undefined; fallbackContainer?: Element | DocumentFragment | null | undefined } = {}): ReactNode {
  if (!portal) return menu;
  return position ? createPortal(menu, resolveSelectPortalContainer({ trigger }, { container, fallbackContainer })) : null;
}


export function CustomSelectMenu({ state, portal, menuClassName, ariaLabel, menuHeader, originTheme, originPage, agentProps, children }: {
  state: UseCustomSelectResult; portal: boolean; menuClassName: string | undefined; ariaLabel: string;
  menuHeader: ReactNode; originTheme: CustomSelectOriginTheme; originPage: string | undefined; agentProps: AgentControlProps; children: ReactNode;
}) {
  const { menuRef, idBase, onMenuKeyDown, position } = state;
  return (
    <div
      ref={menuRef}
      id={`${idBase}-menu`}
      onKeyDown={onMenuKeyDown}
      {...originTheme}
      data-agent-page={originPage}
      data-agent-private={agentProps['data-agent-private']}
      className={[
        'jini-select-menu',
        portal ? 'portal' : 'inline',
        menuClassName,
      ].filter(Boolean).join(' ')}
      role="listbox"
      aria-label={ariaLabel}
      style={customSelectMenuStyle({ portal, position })}
    >
      {menuHeader}
      {children}
    </div>
  );
}

export function CustomSelectMarkup({ state, base, agentProps, value, ariaLabel, labelledBy, className, triggerClassName,
  disabled, title, onFocus, portal, portalContainer, overlayContainer, menu,
}: { [K in 'value' | 'ariaLabel' | 'labelledBy' | 'className' | 'triggerClassName' | 'title' | 'onFocus' | 'portalContainer']: CustomSelectProps[K] } & {
  state: UseCustomSelectResult; base: string | undefined; agentProps: AgentControlProps; disabled: boolean; portal: boolean;
  overlayContainer: HTMLElement | null; menu: ReactNode;
}) {
  const { buttonRef, open, idBase, activeOptionId, selectedLabel, toggleOpen, onButtonKeyDown, position } = state;
  return (
    <div className={['jini-select', className].filter(Boolean).join(' ')}>
      <button
        ref={buttonRef}
        {...agentHandleProps({}, { base, role: 'field', label: ariaLabel })}
        data-agent-private={agentProps['data-agent-private']}
        data-agent-page={agentProps['data-agent-page']}
        type="button"
        className={['jini-select-trigger', triggerClassName].filter(Boolean).join(' ')}
        role="combobox"
        value={value}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${idBase}-menu`}
        aria-activedescendant={activeOptionId}
        aria-describedby={labelledBy}
        aria-label={`${ariaLabel}: ${selectedLabel}`}
        disabled={disabled}
        title={title}
        onClick={toggleOpen}
        onKeyDown={onButtonKeyDown}
        onFocus={onFocus}
      >
        <span id={`${idBase}-value`} className="jini-select-value">
          {selectedLabel}
        </span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open ? mountCustomSelectMenu({ menu, portal, position, trigger: buttonRef.current }, { container: portalContainer, fallbackContainer: overlayContainer }) : null}
    </div>
  );
}
