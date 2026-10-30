import { act, createElement } from 'react';
import type { ComponentType, Attributes } from 'react';
import { createRoot } from 'react-dom/client';
import { KitProvider } from '../KitProvider.js';
import * as facades from '../facade.js';
import { ConfirmDialog } from '../confirm/ConfirmDialog.js';
import { describeKit } from '../kit.js';
import type { AgentAttrsPort } from '../../attrs.js';
import type { KitScenario, ConformanceExpectation } from '../../testing/scenarios.js';
import { kitConformanceScenarios } from '../../testing/scenarios.js';
import type { ImplementedComponentName } from '../../kit-contract.js';
import type { ResolvedKit } from '../types.js';
export interface KitConformanceResult { readonly id: string; readonly status: 'passed' | 'failed' | 'skipped'; readonly errors: readonly string[] }
export interface KitConformanceDriver {
  run(required: { kit: ResolvedKit; scenario: KitScenario; agent: AgentAttrsPort }, optional?: Record<string, never>): Promise<readonly string[]>;
}
const testingAgent: AgentAttrsPort = ({ handle }, options = {}) => ({ 'data-agent-element': handle, 'data-agent-role': options.role, 'data-agent-label': options.label });
function fixture(scenario: KitScenario, calls: Record<string, number>) {
  const count = (name: string) => () => { calls[name] = (calls[name] ?? 0) + 1; };
  const common = { children: 'Example', label: 'Example', value: 'a', checked: true, message: 'Saved', content: 'Help',
    open: true, title: 'Delete record?', confirmLabel: 'Delete', body: 'Example record',
    options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
    items: scenario.component === 'Menu' ? [{ id: 'a', label: 'Alpha', onPress: count('item') }] : [{ id: 'a', label: 'Alpha', content: 'Alpha panel' }],
    onPress: count('press'), onValueChange: count('change'), onCheckedChange: count('change'), onClose: count('cancel'),
    onConfirm: count('confirm'), onCancel: count('cancel'), ...scenario.props };
  const Component = scenario.component === 'ConfirmDialog' ? ConfirmDialog : facades[scenario.component];
  // The scenario union intentionally carries framework-neutral props; the driver performs the binding.
  return createElement(Component as ComponentType<Record<string, unknown>>, common as Attributes & Record<string, unknown>);
}
function check(expectation: ConformanceExpectation, root: HTMLElement, calls: Record<string, number>): string | undefined {
  if (expectation.type === 'calls') return (calls[expectation.name] ?? 0) === expectation.count ? undefined : `${expectation.name} calls: expected ${expectation.count}, received ${calls[expectation.name] ?? 0}`;
  const element = root.querySelector<HTMLElement>(expectation.selector);
  if (expectation.type === 'absent') return element ? `unexpected ${expectation.selector}` : undefined;
  if (!element) return `missing ${expectation.selector}`;
  if (expectation.type === 'attribute') return element.getAttribute(expectation.name) === expectation.value ? undefined : `${expectation.selector} did not forward ${expectation.name}=${expectation.value}`;
  return checkElementState({ expectation, element });
}
function checkElementState({ expectation, element }: {
  expectation: Exclude<ConformanceExpectation, { type: 'calls' } | { type: 'attribute' }>;
  element: HTMLElement;
}, _optional?: Record<string, never>): string | undefined {
  switch (expectation.type) {
    case 'focused': return element === document.activeElement ? undefined : `${expectation.selector} not focused`;
    case 'disabled': return element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true' ? undefined : `${expectation.selector} not disabled`;
    case 'native-select': return element instanceof HTMLSelectElement ? undefined : 'Select must render HTMLSelectElement';
    case 'focusable': return element.matches('button,input,select,textarea,[tabindex]') ? undefined : `${expectation.selector} is not focusable`;
  }
}
export const reactConformanceDriver: KitConformanceDriver = {
  async run({ kit, scenario, agent }) {
    if (typeof document === 'undefined') throw new Error('React conformance requires a DOM environment');
    const host = document.createElement('div'), overlay = document.createElement('div'), calls: Record<string, number> = {};
    document.body.append(host, overlay);
    const root = createRoot(host), errors: string[] = [];
    const before = describeKit({ kit }).violations.length;
    try {
      // Never let the dev guard make a broken adapter pass conformance by silently substituting native.
      await act(async () => { root.render(createElement(KitProvider, { kit, agent, overlayContainer: overlay, guard: 'off', children: fixture(scenario, calls) })); });
      for (const action of scenario.actions) {
        const element = (host.querySelector(action.selector) ?? overlay.querySelector(action.selector)) as HTMLElement | null;
        if (!element) { errors.push(`action target missing: ${action.selector}`); continue; }
        await act(async () => {
          if (action.type === 'click') element.click();
          else if (action.type === 'focus') element.focus();
          else if (action.type === 'cancel') element.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
          else element.dispatchEvent(new KeyboardEvent('keydown', { key: action.key ?? '', bubbles: true, cancelable: true }));
        });
      }
      for (const expectation of scenario.expectations) {
        const scope = expectation.type === 'calls' || host.querySelector(expectation.selector) ? host : overlay;
        const error = check(expectation, scope, calls); if (error) errors.push(error);
      }
      if (describeKit({ kit }).violations.length !== before) errors.push('conformance must not trigger fallback');
    } finally {
      await act(async () => root.unmount()); host.remove(); overlay.remove();
    }
    return errors;
  },
};
function resolveConformanceDriver(required: {
  driver?: KitConformanceDriver; includeBrowser?: boolean;
}, _optional?: Record<string, never>): KitConformanceDriver {
  const driver = required.driver ?? reactConformanceDriver;
  if (required.includeBrowser && driver === reactConformanceDriver) throw new Error('Browser cases require a real browser driver');
  return driver;
}
export async function runKitConformance(required: { kit: ResolvedKit }, optional: {
  driver?: KitConformanceDriver; agent?: AgentAttrsPort; only?: readonly ImplementedComponentName[];
  scenarios?: readonly KitScenario[]; includeBrowser?: boolean;
} = {}): Promise<readonly KitConformanceResult[]> {
  const driver = resolveConformanceDriver(optional);
  const results: KitConformanceResult[] = [];
  for (const scenario of optional.scenarios ?? kitConformanceScenarios) {
    if (optional.only && !optional.only.includes(scenario.component)) continue;
    if (scenario.browserOnly && !optional.includeBrowser) {
      results.push({ id: scenario.id, status: 'skipped', errors: ['requires real browser driver'] });
    } else {
      const errors = await driver.run({ kit: required.kit, scenario, agent: optional.agent ?? testingAgent });
      results.push({ id: scenario.id, status: errors.length ? 'failed' : 'passed', errors });
    }
  }
  return results;
}
