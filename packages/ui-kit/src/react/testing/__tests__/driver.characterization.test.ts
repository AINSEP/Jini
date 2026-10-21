import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { KitProvider } from '../../KitProvider.js';
import { ConfirmDialog } from '../../confirm/ConfirmDialog.js';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createKit } from '../../kit.js';
import type { AgentAttrsPort } from '../../../attrs.js';
import type { ConformanceExpectation, KitScenario } from '../../../testing/scenarios.js';
import { kitConformanceScenarios } from '../../../testing/scenarios.js';
import { reactConformanceDriver, runKitConformance } from '../driver.js';
import type { KitConformanceDriver } from '../driver.js';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => vi.unstubAllGlobals());

function scenario(required: { expectations?: readonly ConformanceExpectation[] }, optional: Partial<KitScenario> = {}): KitScenario {
  return { id: 'probe', component: 'Button', props: {}, actions: [], expectations: required.expectations ?? [], ...optional };
}
const agent: AgentAttrsPort = ({ handle }) => ({ 'data-agent-element': handle });

async function inspect(required: { node: ReactNode; expectation: ConformanceExpectation }, optional: { focus?: boolean } = {}) {
  const kit = createKit({ components: { Button: () => required.node } });
  return reactConformanceDriver.run({ kit, agent, scenario: scenario({ expectations: [required.expectation] }, {
    actions: optional.focus ? [{ type: 'focus', selector: '#probe' }] : [],
  }) });
}

describe('React conformance expectation behavior', () => {
  it.each([
    { value: 'kept', errors: [] },
    { value: 'other', errors: ['#probe did not forward data-value=kept'] },
    { value: undefined, errors: ['#probe did not forward data-value=kept'] },
  ])('compares exact attributes: $value', async ({ value, errors }) => {
    expect(await inspect({ node: createElement('button', { id: 'probe', 'data-value': value }),
      expectation: { type: 'attribute', selector: '#probe', name: 'data-value', value: 'kept' } })).toEqual(errors);
  });

  it.each([
    { present: true, errors: ['unexpected #probe'] },
    { present: false, errors: [] },
  ])('checks absence when present=$present', async ({ present, errors }) => {
    expect(await inspect({ node: present ? createElement('button', { id: 'probe' }) : null,
      expectation: { type: 'absent', selector: '#probe' } })).toEqual(errors);
  });

  it.each(['focused', 'disabled', 'native-select', 'focusable'] as const)('reports missing elements before checking %s', async type => {
    expect(await inspect({ node: null, expectation: { type, selector: '#probe' } })).toEqual(['missing #probe']);
  });

  it('reports a missing attribute target before comparing values', async () => {
    expect(await inspect({ node: null, expectation: { type: 'attribute', selector: '#probe', name: 'title', value: 'kept' } }))
      .toEqual(['missing #probe']);
  });

  it.each([
    { focus: true, errors: [] },
    { focus: false, errors: ['#probe not focused'] },
  ])('compares document focus when focused=$focus', async ({ focus, errors }) => {
    expect(await inspect({ node: createElement('button', { id: 'probe' }), expectation: { type: 'focused', selector: '#probe' } }, { focus }))
      .toEqual(errors);
  });

  it.each([
    { disabled: true, aria: undefined, errors: [] },
    { disabled: false, aria: 'true', errors: [] },
    { disabled: false, aria: 'false', errors: ['#probe not disabled'] },
    { disabled: false, aria: undefined, errors: ['#probe not disabled'] },
  ])('accepts native or exact ARIA disabled state: $disabled/$aria', async ({ disabled, aria, errors }) => {
    expect(await inspect({ node: createElement('button', { id: 'probe', disabled, 'aria-disabled': aria }),
      expectation: { type: 'disabled', selector: '#probe' } })).toEqual(errors);
  });

  it.each([
    { tag: 'select', errors: [] },
    { tag: 'div', errors: ['Select must render HTMLSelectElement'] },
  ])('checks the actual select element type: $tag', async ({ tag, errors }) => {
    expect(await inspect({ node: createElement(tag, { id: 'probe' }), expectation: { type: 'native-select', selector: '#probe' } })).toEqual(errors);
  });

  it.each(['button', 'input', 'select', 'textarea'])('accepts %s as focusable', async tag => {
    expect(await inspect({ node: createElement(tag, { id: 'probe' }), expectation: { type: 'focusable', selector: '#probe' } })).toEqual([]);
  });

  it('accepts an explicit negative tabindex as focusable', async () => {
    expect(await inspect({ node: createElement('div', { id: 'probe', tabIndex: -1 }), expectation: { type: 'focusable', selector: '#probe' } })).toEqual([]);
  });

  it('reports an element without a focusable tag or tabindex', async () => {
    expect(await inspect({ node: createElement('div', { id: 'probe' }), expectation: { type: 'focusable', selector: '#probe' } }))
      .toEqual(['#probe is not focusable']);
  });

  it.each([
    { clicks: 0, count: 0, errors: [] },
    { clicks: 0, count: 2, errors: ['press calls: expected 2, received 0'] },
    { clicks: 2, count: 2, errors: [] },
    { clicks: 2, count: 1, errors: ['press calls: expected 1, received 2'] },
  ])('counts calls with $clicks clicks and $count expected', async ({ clicks, count, errors }) => {
    expect(await reactConformanceDriver.run({ kit: createKit({}), agent, scenario: scenario({ expectations: [{ type: 'calls', name: 'press', count }] }, {
      actions: Array.from({ length: clicks }, () => ({ type: 'click' as const, selector: 'button' })),
    }) })).toEqual(errors);
  });
});

describe('conformance orchestration behavior', () => {
  function recordingDriver(required: { errors: readonly string[] }, _optional: Record<string, never> = {}) {
    const inputs: Parameters<KitConformanceDriver['run']>[0][] = [];
    const driver: KitConformanceDriver = { async run(input) { inputs.push(input); return required.errors; } };
    return { inputs, driver };
  }

  it.each([
    { errors: [], status: 'passed' },
    { errors: ['adapter failed'], status: 'failed' },
  ] as const)('preserves $status results, input identity and custom agent', async ({ errors, status }) => {
    const kit = createKit({});
    const item = scenario({});
    const { inputs, driver } = recordingDriver({ errors });
    const results = await runKitConformance({ kit }, { driver, agent, scenarios: [item] });
    expect(inputs).toEqual([{ kit, scenario: item, agent }]);
    expect(inputs[0]?.kit).toBe(kit);
    expect(inputs[0]?.scenario).toBe(item);
    expect(inputs[0]?.agent).toBe(agent);
    expect(results).toEqual([{ id: 'probe', status, errors }]);
    expect(results[0]?.errors).toBe(errors);
  });

  it('uses the default scenarios and default testing agent', async () => {
    const { inputs, driver } = recordingDriver({ errors: [] });
    const results = await runKitConformance({ kit: createKit({}) }, { driver });
    expect(inputs.map(input => input.scenario)).toEqual(kitConformanceScenarios.filter(item => !item.browserOnly));
    expect(results.map(result => result.id)).toEqual(kitConformanceScenarios.map(item => item.id));
    const defaultAgent = inputs[0]!.agent;
    expect(defaultAgent({ handle: 'x' })).toEqual({ 'data-agent-element': 'x', 'data-agent-role': undefined, 'data-agent-label': undefined });
    expect(defaultAgent({ handle: 'x' }, { role: 'button', label: 'Run' }))
      .toEqual({ 'data-agent-element': 'x', 'data-agent-role': 'button', 'data-agent-label': 'Run' });
  });

  it('skips browser cases without invoking the driver', async () => {
    const { inputs, driver } = recordingDriver({ errors: [] });
    const results = await runKitConformance({ kit: createKit({}) }, { driver, scenarios: [scenario({}, { browserOnly: true })] });
    expect(inputs).toEqual([]);
    expect(results).toEqual([{ id: 'probe', status: 'skipped', errors: ['requires real browser driver'] }]);
  });

  it('runs browser cases only with an opted-in custom driver', async () => {
    const { inputs, driver } = recordingDriver({ errors: [] });
    const items = [scenario({}, { browserOnly: true }), scenario({}, { id: 'second', browserOnly: false })];
    expect(await runKitConformance({ kit: createKit({}) }, { driver, includeBrowser: true, scenarios: items }))
      .toEqual(items.map(item => ({ id: item.id, status: 'passed', errors: [] })));
    expect(inputs.map(input => input.scenario)).toEqual(items);
  });

  it.each([undefined, reactConformanceDriver])('rejects browser opt-in with the React driver (%s)', async driver => {
    await expect(runKitConformance({ kit: createKit({}) }, { ...(driver === undefined ? {} : { driver }), includeBrowser: true, scenarios: [] }))
      .rejects.toThrow('Browser cases require a real browser driver');
  });

  it('filters components before browser skipping and keeps order', async () => {
    const { inputs, driver } = recordingDriver({ errors: [] });
    const items = [scenario({}, { id: 'filtered', component: 'Select', browserOnly: true }),
      scenario({}, { id: 'first' }), scenario({}, { id: 'second' })];
    expect(await runKitConformance({ kit: createKit({}) }, { driver, only: ['Button'], scenarios: items }))
      .toEqual([{ id: 'first', status: 'passed', errors: [] }, { id: 'second', status: 'passed', errors: [] }]);
    expect(inputs.map(input => input.scenario.id)).toEqual(['first', 'second']);
  });

  it('treats an empty component filter as selecting no scenarios', async () => {
    const { inputs, driver } = recordingDriver({ errors: [] });
    expect(await runKitConformance({ kit: createKit({}) }, { driver, only: [], scenarios: [scenario({})] })).toEqual([]);
    expect(inputs).toEqual([]);
  });

  it('propagates driver rejection without running later scenarios', async () => {
    const failure = new Error('driver failed');
    const inputs: string[] = [];
    const driver: KitConformanceDriver = { async run({ scenario }) { inputs.push(scenario.id); throw failure; } };
    await expect(runKitConformance({ kit: createKit({}) }, { driver, scenarios: [scenario({}), scenario({}, { id: 'later' })] }))
      .rejects.toBe(failure);
    expect(inputs).toEqual(['probe']);
  });

  it('waits for each scenario before starting the next', async () => {
    let release: () => void = () => { throw new Error('first scenario not initialized'); };
    const first = new Promise<readonly string[]>(resolve => { release = () => resolve([]); });
    const inputs: string[] = [];
    const driver: KitConformanceDriver = { run({ scenario }) {
      inputs.push(scenario.id);
      return scenario.id === 'probe' ? first : Promise.resolve([]);
    } };
    const pending = runKitConformance({ kit: createKit({}) }, { driver, scenarios: [scenario({}), scenario({}, { id: 'later' })] });
    expect(inputs).toEqual(['probe']);
    release();
    expect(await pending).toEqual([{ id: 'probe', status: 'passed', errors: [] }, { id: 'later', status: 'passed', errors: [] }]);
    expect(inputs).toEqual(['probe', 'later']);
  });

  it('rejects React execution without a DOM', async () => {
    vi.stubGlobal('document', undefined);
    await expect(reactConformanceDriver.run({ kit: createKit({}), agent, scenario: scenario({}) }))
      .rejects.toThrow('React conformance requires a DOM environment');
  });
});

describe('React conformance actions', () => {
  function keyButton(props: { onPress?: (required: Record<string, never>) => void }) {
    return createElement('button', { id: 'probe', onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') props.onPress?.({}); } }, 'probe');
  }

  it('reports an action whose target is missing and still evaluates the expectations', async () => {
    const kit = createKit({ components: { Button: () => null } });
    expect(await reactConformanceDriver.run({ kit, agent, scenario: scenario({ expectations: [{ type: 'calls', name: 'press', count: 0 }] }, {
      actions: [{ type: 'click', selector: '#nowhere' }] }) })).toEqual(['action target missing: #nowhere']);
  });

  it('dispatches key actions as keydown with the given key, and an absent key as an empty key', async () => {
    const kit = createKit({ components: { Button: keyButton } });
    expect(await reactConformanceDriver.run({ kit, agent, scenario: scenario({ expectations: [{ type: 'calls', name: 'press', count: 1 }] }, {
      actions: [{ type: 'key', selector: '#probe', key: 'Enter' }, { type: 'key', selector: '#probe' }] }) })).toEqual([]);
  });

  it('fails a run during which the kit recorded a guard fallback', async () => {
    const broken = () => createElement('div', null, 'broken confirmation');
    const kit = createKit({ components: { ConfirmDialog: broken } });
    // The same kit is live elsewhere with its development guard on; its inspection lands mid-run.
    const elsewhere = document.createElement('div'); document.body.append(elsewhere);
    const root = createRoot(elsewhere);
    await act(async () => { root.render(createElement(KitProvider, { kit, children: createElement(ConfirmDialog, { open: true, title: 'Delete?', confirmLabel: 'Delete', onCancel() {}, onConfirm() {} }) })); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const errors = await reactConformanceDriver.run({ kit, agent, scenario: scenario({ expectations: [] }, {
        actions: [{ type: 'focus', selector: 'button' }] }) });
      expect(errors).toEqual(['conformance must not trigger fallback']);
    } finally { await act(async () => root.unmount()); elsewhere.remove(); }
  });
});
