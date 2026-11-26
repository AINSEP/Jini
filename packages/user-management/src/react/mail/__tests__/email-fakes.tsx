import type { ReactNode } from 'react';
import type {
  EmailCopy, EmailKit, EmailLoadedProps, EmailProviderChoice, EmailProviderControl, EmailProviderView, EmailRules, EmailStatusShape,
} from '../email-view.types.js';

/** Plain-element fakes: every slot renders a tagged element so a test asserts which slot rendered and with what. */
export function fakeEmailKit<S extends EmailStatusShape>(): EmailKit<S> {
  return {
    TabBar: (p) => (
      <div role="tablist" aria-label={p.ariaLabel} data-active={p.activeId}>
        {p.tabs.map((tab) => <button key={tab.id} type="button" role="tab" onClick={() => p.onChange(tab.id)}>{tab.label}</button>)}
        <button type="button" onClick={() => p.onChange('not-a-tab')}>bogus tab</button>
      </div>
    ),
    Segmented: (p) => (
      <div data-fake="Segmented" data-name={p.name}>
        {p.items.map((item) => <button key={item.key} type="button" role="radio" aria-checked={item.checked === true} onClick={item.change}>{item.label}</button>)}
      </div>
    ),
    Chip: (p) => <span data-fake="Chip" data-tone={p.tone}>{p.children}</span>,
    Section: (p) => <section aria-label={p.title}>{p.children}</section>,
    Loaded: <T,>(p: EmailLoadedProps<T>): ReactNode => (p.view.kind === 'loaded' ? <>{p.children(p.view.data)}</> : <p role="status">{p.view.kind}</p>),
    StatusFacts: (p) => <p data-fake="StatusFacts">{`facts:${JSON.stringify(p.status)}`}</p>,
  };
}

export const fakeCopy: EmailCopy = { t: ({ key }) => key, navLabel: ({ key }) => `nav:${key}` };

export function fakeRules<S extends EmailStatusShape, P extends EmailProviderView, Ch extends EmailProviderChoice>(
  overrides: Partial<EmailRules<S, P, Ch>> = {},
): EmailRules<S, P, Ch> {
  return {
    summarize: () => 'configured',
    isFullyActive: ({ provider }) => provider.lanes.length === 2,
    when: ({ iso }) => `when:${iso}`,
    providerLabel: () => (id) => `label:${id ?? 'none'}`,
    displayName: (choice) => `plugin:${choice.pluginId}`,
    ...overrides,
  };
}

export const savedProvider: EmailProviderView = {
  id: 'relay', label: 'Relay (hosted)', hosted: true, lanes: ['transactional', 'bulk'],
  credential: { required: true, saved: true, updatedAt: '2026-11-01T00:00:00Z' }, selectable: true,
  setup: { fields: [{ key: 'token', label: 'API key', type: 'secret', placeholder: 'key-…' }] },
};

export function fakeProviderControl(overrides: Partial<EmailProviderControl<EmailProviderView, EmailProviderChoice>> = {}): EmailProviderControl<EmailProviderView, EmailProviderChoice> {
  return {
    choices: [], adding: null, addError: null, addWarning: null,
    retryAdd: async () => undefined, addProvider: async () => undefined,
    view: { kind: 'loaded', data: { providers: [savedProvider], refusals: [] } }, reload: () => undefined,
    drafts: {}, setDraftField: () => undefined, busyId: null, notice: null, saveKey: async () => undefined,
    pendingSwitch: null, askSwitch: () => undefined, confirmSwitch: async () => undefined,
    ...overrides,
  };
}
