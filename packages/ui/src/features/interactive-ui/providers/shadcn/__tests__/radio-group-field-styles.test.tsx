import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroupField } from '../radio-group-field.js';

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

// A host loads "@jini-ai/ui/interactive-ui.css" (compiled from styles.css). The pin injects the owned
// stylesheet text so a markup-only class rename, or a dropped @import, turns it red.
const radioCss = read('../../../radio-group-field.css');
const entryCss = read('../../../styles.css');
const options = [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }];

describe('shadcn RadioGroupField owned layout rule', () => {
  afterEach(() => { document.head.querySelectorAll('style').forEach((node) => node.remove()); });

  it('lays each radio and label out in a centered row with a 0.5rem gap once the host supplies the stylesheet', () => {
    const style = document.createElement('style');
    style.textContent = radioCss;
    document.head.append(style);
    render(<RadioGroupField options={options} />);
    const row = screen.getByRole('radio', { name: 'Option A' }).parentElement as HTMLElement;
    expect(row).toHaveClass('jini-ui-radio-group-field-option');
    const computed = getComputedStyle(row);
    expect(computed.display).toBe('flex');
    expect(computed.alignItems).toBe('center');
    expect(computed.gap).toBe('0.5rem');
  });

  it('keeps selection working through the labelled radios', async () => {
    const onValueChange = vi.fn();
    render(<RadioGroupField options={options} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Option B' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('is part of the compiled interactive-ui entry point so hosts receive the rule', () => {
    expect(entryCss).toMatch(/@import\s+"\.\/radio-group-field\.css";/);
  });
});
