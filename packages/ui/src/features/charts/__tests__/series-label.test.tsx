import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createChartInteractiveRegistry } from '../react.js';
import { createChartProviderRegistry, type ChartSpec } from '../index.js';
import { InteractiveUiRegistry } from '../../interactive-ui/registry.js';

/**
 * f4 (seen on camera 2026-10-30): a Playground chart of form sign-ups showed the raw series key
 * "signups" in its legend. The provider draws `series[].label`; the assistant's wire props
 * (`recharts.bar-chart` {data, categoryKey, valueKey}) never produced one.
 */
const rows = [{ month: 'Sep', signups: 4 }, { month: 'Oct', signups: 9 }];

function renderBar(props: Record<string, unknown>) {
  const mounted: ChartSpec[] = [];
  const providers = createChartProviderRegistry({ providers: [{ id: 'recorder', kinds: ['bar'], enabled: true, load: async () => ({ mount: ({ spec }) => {
    mounted.push(spec); return { update() {}, destroy() {} };
  } }) }] });
  const entry = createChartInteractiveRegistry({ registry: new InteractiveUiRegistry({ entries: [] }), providers }).resolveById({ id: 'recharts.bar-chart' })!;
  const Component = entry.Component;
  const view = render(<Component {...props} />);
  return { mounted, view };
}

describe('chart series labels', () => {
  it('humanizes a bare value key for the legend and the data table', async () => {
    const { mounted, view } = renderBar({ data: rows, categoryKey: 'month', valueKey: 'signups' });
    await waitFor(() => expect(mounted).toHaveLength(1));
    expect(mounted[0]!.series).toEqual([{ key: 'signups', label: 'Signups' }]);
    expect([...view.container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['month', 'Signups']);
  });

  it('uses a label the assistant passed', async () => {
    const { mounted } = renderBar({ data: rows, categoryKey: 'month', valueKey: 'signups', valueLabel: 'Sign-ups' });
    await waitFor(() => expect(mounted).toHaveLength(1));
    expect(mounted[0]!.series[0]!.label).toBe('Sign-ups');
  });

  it('accepts valueLabel in the wire schema the assistant validates against', () => {
    const entry = createChartInteractiveRegistry({ registry: new InteractiveUiRegistry({ entries: [] }), providers: createChartProviderRegistry({ providers: [] }) }).resolveById({ id: 'recharts.line-chart' })!;
    const shape = (entry.propsSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).toContain('valueLabel');
  });
});
