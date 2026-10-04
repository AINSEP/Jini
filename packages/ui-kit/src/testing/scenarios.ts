import type { ImplementedComponentName } from '../kit.spec.js';
export type ConformanceAction = { readonly type: 'click' | 'cancel' | 'focus' | 'key'; readonly selector: string; readonly key?: string };
export type ConformanceExpectation =
  | { readonly type: 'attribute'; readonly selector: string; readonly name: string; readonly value: string }
  | { readonly type: 'focused' | 'disabled' | 'absent' | 'native-select' | 'focusable'; readonly selector: string }
  | { readonly type: 'calls'; readonly name: string; readonly count: number };
export interface KitScenario {
  readonly id: string; readonly component: ImplementedComponentName; readonly safety?: boolean;
  readonly browserOnly?: boolean; readonly props: Readonly<Record<string, unknown>>;
  readonly actions: readonly ConformanceAction[]; readonly expectations: readonly ConformanceExpectation[];
}
/** Serializable cases can drive another framework or a real-browser fixture without importing React. */
export const kitConformanceScenarios: readonly KitScenario[] = Object.freeze([
  ...(['Button', 'IconButton', 'TextField', 'TextArea', 'Select', 'Checkbox', 'Switch', 'Dialog', 'Tabs', 'Menu', 'Toast', 'Tooltip', 'Notice', 'Spinner', 'Badge'] as const).map(component => ({
    id: `${component}:opaque-attrs`, component, props: { attrs: { 'data-agent-element': 'probe', 'data-jini-part': 'x.host.part', 'aria-description': 'opaque' } }, actions: [],
    expectations: [{ type: 'focusable' as const, selector: '[data-agent-element="probe"]' },
      { type: 'attribute' as const, selector: '[data-agent-element="probe"]', name: 'data-jini-part', value: 'x.host.part' },
      { type: 'attribute' as const, selector: '[data-agent-element="probe"]', name: 'aria-description', value: 'opaque' }],
  })),
  { id: 'Select:native-semantics', component: 'Select', props: {}, actions: [], expectations: [{ type: 'native-select', selector: '[data-jini-part="kit.select"]' }] },
  { id: 'Button:disabled-blocks-press', component: 'Button', props: { disabled: true }, actions: [{ type: 'click', selector: 'button' }], expectations: [{ type: 'calls', name: 'press', count: 0 }] },
  { id: 'ConfirmDialog:cancel-first-focus', component: 'ConfirmDialog', safety: true, props: {}, actions: [], expectations: [{ type: 'focused', selector: '[data-jini-part="confirm.cancel"]' }] },
  { id: 'ConfirmDialog:pending-blocks-every-dismissal', component: 'ConfirmDialog', safety: true, props: { pending: true },
    actions: [{ type: 'cancel', selector: '[data-jini-part="confirm.dialog"]' }, { type: 'click', selector: '[data-jini-part="confirm.dialog"]' },
      { type: 'click', selector: '[data-jini-part="confirm.cancel"]' }, { type: 'click', selector: '[data-jini-part="confirm.confirm"]' }],
    expectations: [{ type: 'calls', name: 'cancel', count: 0 }, { type: 'calls', name: 'confirm', count: 0 },
      { type: 'disabled', selector: '[data-jini-part="confirm.cancel"]' }, { type: 'disabled', selector: '[data-jini-part="confirm.confirm"]' }] },
  { id: 'ConfirmDialog:agent-confirm-withheld', component: 'ConfirmDialog', safety: true, props: { agentHandle: 'erase', agentMayConfirm: false }, actions: [],
    expectations: [{ type: 'absent', selector: '[data-agent-element="erase-confirm"]' },
      { type: 'attribute', selector: '[data-jini-part="confirm.cancel"]', name: 'data-agent-element', value: 'erase-cancel' }] },
  { id: 'ConfirmDialog:consequence-label', component: 'ConfirmDialog', safety: true, props: { agentHandle: 'erase', tone: 'danger' }, actions: [],
    expectations: [{ type: 'attribute', selector: '[data-jini-part="confirm.confirm"]', name: 'data-agent-label', value: 'Delete — Delete record?; cannot be undone' },
      { type: 'attribute', selector: '[data-jini-part="confirm.confirm"]', name: 'aria-label', value: 'Delete — Delete record?; cannot be undone' }] },
  { id: 'ConfirmDialog:browser-escape', component: 'ConfirmDialog', safety: true, browserOnly: true, props: {},
    actions: [{ type: 'key', selector: '[data-jini-part="confirm.cancel"]', key: 'Escape' }], expectations: [{ type: 'calls', name: 'cancel', count: 1 }] },
  { id: 'ConfirmDialog:browser-modal-focus', component: 'ConfirmDialog', safety: true, browserOnly: true, props: {}, actions: [],
    expectations: [{ type: 'focused', selector: '[data-jini-part="confirm.cancel"]' }] },
]);
