import type { TabsProps, MenuProps, TooltipProps } from '../types.js';
import { useNativeTabs, useNativeMenu, useNativeTooltip } from './Navigation.hooks.js';
export function NativeTabs({ useNativeTabsHook = useNativeTabs, ...props }: TabsProps & { useNativeTabsHook?: typeof useNativeTabs }, _optional: Record<string, never> = {}) {
  const vm = useNativeTabsHook(props);
  return <div ref={vm.root} className={vm.className}><div className="jini-tab-bar" role="tablist" aria-label={vm.label} data-jini-part="kit.tabs">{vm.tabs}</div>{vm.panels}</div>;
}
export function NativeMenu({ useNativeMenuHook = useNativeMenu, ...props }: MenuProps & { useNativeMenuHook?: typeof useNativeMenu }, _optional: Record<string, never> = {}) {
  const vm = useNativeMenuHook(props);
  return <div className="jini-row-menu"><button {...vm.triggerProps}>
    {/* Filled dots remain crisp at the trigger's 16px size; its label names the action. */}
    <svg className="jini-icon" width="16" height="16" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><circle className="jini-icon-circle" cx="9" cy="4.5" r="1.5" /><circle className="jini-icon-circle" cx="9" cy="9" r="1.5" /><circle className="jini-icon-circle" cx="9" cy="13.5" r="1.5" /></svg>
  </button>{vm.popup}</div>;
}
export function NativeTooltip({ useNativeTooltipHook = useNativeTooltip, ...props }: TooltipProps & { useNativeTooltipHook?: typeof useNativeTooltip }, _optional: Record<string, never> = {}) {
  const vm = useNativeTooltipHook(props);
  return <span className="jini-tooltip-container"><span {...vm.triggerProps}>{vm.children}</span><span {...vm.tooltipProps}>{vm.content}</span></span>;
}
