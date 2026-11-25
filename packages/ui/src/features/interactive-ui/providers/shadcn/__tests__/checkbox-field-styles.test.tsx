import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheckboxField } from '../checkbox-field.js';

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

// The host contract: a host loads "@jini-ai/ui/interactive-ui.css", which is compiled from styles.css.
// The pin injects the package's own owned stylesheet text, not Tailwind output, so renaming
// the class in markup without renaming the selector (or vice versa) turns it red.
const checkboxFieldCss = read('../../../checkbox-field.css');
const entryCss = read('../../../styles.css');

const mountStyle = (): HTMLStyleElement => {
  const style = document.createElement('style');
  style.textContent = checkboxFieldCss;
  document.head.append(style);
  return style;
};

describe('shadcn CheckboxField owned layout rule', () => {
  afterEach(() => {
    document.head.querySelectorAll('style').forEach((node) => node.remove());
  });

  it('lays the checkbox and label out in a centered row with a 0.5rem gap once the host supplies the stylesheet', () => {
    mountStyle();
    render(<CheckboxField label="Accept terms" />);
    const row = screen.getByRole('checkbox', { name: 'Accept terms' }).parentElement as HTMLElement;
    expect(row).toHaveClass('jini-ui-checkbox-field');
    const computed = getComputedStyle(row);
    expect(computed.display).toBe('flex');
    expect(computed.alignItems).toBe('center');
    expect(computed.gap).toBe('0.5rem');
  });

  it('keeps the accessible interaction intact inside the styled row', () => {
    mountStyle();
    render(<CheckboxField label="Accept terms" disabled />);
    expect(screen.getByRole('checkbox', { name: 'Accept terms' })).toBeDisabled();
  });

  it('is part of the compiled interactive-ui entry point so hosts receive the rule', () => {
    expect(entryCss).toMatch(/@import\s+"\.\/checkbox-field\.css";/);
  });

  it('does not rely on Tailwind utilities for the row', () => {
    render(<CheckboxField label="Accept terms" />);
    const row = screen.getByRole('checkbox').parentElement as HTMLElement;
    expect(row.className).toBe('jini-ui-checkbox-field');
  });
});
